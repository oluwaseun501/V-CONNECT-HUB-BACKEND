const cron = require('node-cron');
const VirtualOrder = require('../models/VirtualOrder');
const { checkOrder } = require('../services/fivesimService');
const { creditWallet } = require('../services/walletService');


const startOrderCron = () => {

    // ============================================================
    // EVERY 2 MINUTES — handle expired orders + refunds
    // ============================================================
    cron.schedule('*/2 * * * *', async () => {
        try {
            const now = new Date();

            // Find PENDING orders that have passed their expiry time
            const expiredOrders = await VirtualOrder.find({
                status: 'PENDING',
                expiresAt: { $lte: now },
            });

            for (const order of expiredOrders) {
                try {
                    const liveOrder = await checkOrder(order.orderId);
                    const liveStatus = liveOrder.status?.toUpperCase();

                    // Save any SMS that arrived
                    if (liveOrder.sms?.length) {
                        order.sms = liveOrder.sms;
                    }

                    if (
                        liveStatus === 'TIMEOUT' ||
                        liveStatus === 'CANCELED'
                    ) {
                        order.status = liveStatus;
                        await order.save();

                        // Refund wallet
                        await creditWallet(
                            order.user,
                            order.price,
                            `Auto-refund — expired number (${order.product})`
                        );

                        console.log(
                            `[Cron] Refunded order ${order.orderId} — status: ${liveStatus}`
                        );

                    } else if (liveStatus && liveStatus !== 'PENDING') {
                        // RECEIVED / FINISHED — update status, no refund
                        order.status = liveStatus;
                        await order.save();

                        console.log(
                            `[Cron] Updated expired order ${order.orderId} — status: ${liveStatus}`
                        );

                    } else {
                        // Still PENDING after expiry — force TIMEOUT and refund
                        order.status = 'TIMEOUT';
                        await order.save();

                        await creditWallet(
                            order.user,
                            order.price,
                            `Auto-refund — expired number (${order.product})`
                        );

                        console.log(
                            `[Cron] Force-timeout + refunded order ${order.orderId}`
                        );
                    }

                } catch (err) {
                    console.error(
                        `[Cron] Failed to process expired order ${order.orderId}:`,
                        err.message
                    );
                }
            }

        } catch (err) {
            console.error('[Cron] Expired order job error:', err.message);
        }
    });


    // ============================================================
    // EVERY 30 SECONDS — poll ACTIVE orders for incoming SMS
    // ============================================================
    // This ensures SMS codes that arrive on 5sim are saved to the
    // database quickly, even if the user's browser tab is closed
    // or the frontend polling fails for any reason.
    // ============================================================
    cron.schedule('*/30 * * * * *', async () => {
        try {
            const now = new Date();

            // Active = PENDING and not yet expired
            const activeOrders = await VirtualOrder.find({
                status: 'PENDING',
                expiresAt: { $gt: now },
            });

            for (const order of activeOrders) {
                try {
                    const liveOrder = await checkOrder(order.orderId);
                    const liveStatus = liveOrder.status?.toUpperCase();

                    let changed = false;

                    // Save SMS if new ones arrived
                    if (
                        Array.isArray(liveOrder.sms) &&
                        liveOrder.sms.length > 0 &&
                        liveOrder.sms.length !== order.sms.length
                    ) {
                        order.sms = liveOrder.sms;
                        changed = true;
                    }

                    // Update status if provider changed it
                    if (liveStatus && liveStatus !== order.status) {
                        order.status = liveStatus;
                        changed = true;

                        console.log(
                            `[Cron] Active order ${order.orderId} status → ${liveStatus}`
                        );
                    }

                    if (changed) {
                        await order.save();
                    }

                } catch (err) {
                    console.error(
                        `[Cron] Failed to poll active order ${order.orderId}:`,
                        err.message
                    );
                }
            }

        } catch (err) {
            console.error('[Cron] Active order poll error:', err.message);
        }
    });


    console.log('[Cron] Order cron jobs started');
};

module.exports = { startOrderCron };
