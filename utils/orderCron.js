const cron = require('node-cron');
const VirtualOrder = require('../models/VirtualOrder');
const { checkOrder } = require('../services/fivesimService');
const { creditWallet } = require('../services/walletService');

const startOrderCron = () => {
    // Runs every 2 minutes
    cron.schedule('*/2 * * * *', async () => {
        try {
            const now = new Date();

            // Find PENDING orders that have passed their expiry time
            const expiredOrders = await VirtualOrder.find({
                status: 'PENDING',
                expiresAt: { $lte: now }
            });

            for (const order of expiredOrders) {
                try {
                    // Check live status from 5sim
                    const liveOrder = await checkOrder(order.orderId);
                    const liveStatus = liveOrder.status?.toUpperCase();

                    if (liveStatus === 'TIMEOUT' || liveStatus === 'CANCELED') {
                        order.status = liveStatus;
                        if (liveOrder.sms?.length) order.sms = liveOrder.sms;
                        await order.save();

                        // Refund wallet
                        await creditWallet(
                            order.user,
                            order.price,
                            `Refund — expired number (${order.product})`
                        );

                        console.log(`Refunded order ${order.orderId} — status: ${liveStatus}`);
                    } else if (liveStatus && liveStatus !== 'PENDING') {
                        // Update status even if no refund needed (e.g. RECEIVED, FINISHED)
                        order.status = liveStatus;
                        if (liveOrder.sms?.length) order.sms = liveOrder.sms;
                        await order.save();
                    }
                } catch (err) {
                    console.error(`Cron: failed to check order ${order.orderId}:`, err.message);
                }
            }
        } catch (err) {
            console.error('Cron job error:', err.message);
        }
    });

    console.log('Order cron job started');
};

module.exports = { startOrderCron };