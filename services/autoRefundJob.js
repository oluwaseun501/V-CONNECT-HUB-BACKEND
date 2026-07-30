/**
 * services/autoRefundJob.js
 *
 * Runs every 1 minute (was 5).
 * Finds PENDING/RECEIVED virtual-number orders older than 15 minutes
 * with no SMS, checks real status from 5sim, then:
 *   • RECEIVED / FINISHED on 5sim → update DB only, no refund.
 *   • Still PENDING on 5sim      → cancel with 5sim + refund wallet.
 *   • 5sim check fails           → treat as TIMEOUT + refund wallet.
 *
 * Changes from previous version:
 *   1. Interval reduced from 5 min → 1 min (refund within ~1 min of expiry)
 *   2. isRunning guard added — prevents two scans overlapping under load
 *   3. Now uses refundService.refundOrder() for idempotency + audit trail
 */

const VirtualOrder                  = require('../models/VirtualOrder');
const { refundOrder }               = require('./refundService');
const { checkOrder, cancelOrder }   = require('./fivesimService');

const EXPIRY_MS    = 15 * 60 * 1000; // 15-minute activation window
const JOB_INTERVAL =  1 * 60 * 1000; // scan every 1 minute

// Prevents two runs overlapping if DB / 5sim is slow
let isRunning = false;

/**
 * Process one batch of expired PENDING orders.
 * Safe to call manually (e.g. from a test or admin route).
 */
async function processExpiredOrders() {
  if (isRunning) return;
  isRunning = true;

  try {
    const cutoff = new Date(Date.now() - EXPIRY_MS);

    // PENDING or RECEIVED orders older than 15 min with no SMS stored
    const expiredOrders = await VirtualOrder.find({
      status:    { $in: ['PENDING', 'RECEIVED'] },
      createdAt: { $lt: cutoff },
      'sms.0':   { $exists: false },
    }).lean();

    if (!expiredOrders.length) return;

    console.log(`[autoRefund] Found ${expiredOrders.length} expired order(s) to process`);

    for (const order of expiredOrders) {
      try {
        // ── 1. Get real status from 5sim ─────────────────────────────
        let liveStatus = null;
        let liveSms    = [];

        try {
          const live = await checkOrder(order.orderId);
          liveStatus = live.status?.toUpperCase() || null;
          liveSms    = live.sms || [];
        } catch (checkErr) {
          // 5sim check failed — treat as timed-out, still refund
          console.warn(
            `[autoRefund] Could not check order ${order.orderId}: ${checkErr.message}`
          );
        }

        // ── 2. OTP actually arrived on 5sim — update only, no refund ─
        if (liveStatus === 'RECEIVED' || liveStatus === 'FINISHED') {
          await VirtualOrder.updateOne(
            { _id: order._id },
            { status: liveStatus, ...(liveSms.length ? { sms: liveSms } : {}) }
          );
          console.log(
            `[autoRefund] Order ${order.orderId} already ${liveStatus} — skipping refund`
          );
          continue;
        }

        // ── 3. Cancel with 5sim (best-effort) ────────────────────────
        let finalStatus = liveStatus || 'TIMEOUT';

        if (!liveStatus || liveStatus === 'PENDING') {
          try {
            await cancelOrder(order.orderId);
            finalStatus = 'CANCELED';
          } catch {
            // 5sim may reject if already expired on their side — fine
            finalStatus = 'TIMEOUT';
          }
        }

        // ── 4. Update order status in DB ──────────────────────────────
        await VirtualOrder.updateOne(
          { _id: order._id },
          {
            status: finalStatus,
            ...(liveSms.length ? { sms: liveSms } : {}),
          }
        );

        // ── 5. Refund via refundService (idempotent + sets audit flags) ─
        // refundOrder uses a findOneAndUpdate { refunded: false } lock so
        // it is safe to retry and will never double-credit the wallet.
        const refunded = await refundOrder(
          order,
          `Auto-refund — expired number (${order.product}, ${order.country})`
        );

        if (refunded) {
          console.log(
            `[autoRefund] Refunded ₦${order.price} to user ${order.user} ` +
            `for order ${order.orderId} [${finalStatus}]`
          );
        } else {
          // refunded: true was already set — this order was somehow
          // processed before (e.g. manual admin refund). Log and move on.
          console.warn(
            `[autoRefund] Order ${order.orderId} already marked as refunded — skipping wallet credit`
          );
        }

      } catch (err) {
        // Never let one order crash the whole job
        console.error(
          `[autoRefund] Error processing order ${order.orderId}:`, err.message
        );
      }
    }
  } catch (err) {
    console.error('[autoRefund] Scan error:', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the background job.
 * Call once at server startup — runs immediately then every JOB_INTERVAL ms.
 * Returns the interval ID so you can clearInterval(id) in tests.
 */
function startAutoRefundJob() {
  console.log('[autoRefund] Auto-refund job started (interval: 1 min)');

  // Run once immediately so orders that expired during downtime/restart
  // get refunded right away without waiting a full minute.
  processExpiredOrders().catch((err) =>
    console.error('[autoRefund] Initial run error:', err.message)
  );

  return setInterval(() => {
    processExpiredOrders().catch((err) =>
      console.error('[autoRefund] Job error:', err.message)
    );
  }, JOB_INTERVAL);
}

module.exports = { startAutoRefundJob, processExpiredOrders };
