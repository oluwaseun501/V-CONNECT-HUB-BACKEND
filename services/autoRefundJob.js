/**
 * autoRefundJob.js
 * ─────────────────────────────────────────────────────────────
 * Runs every 5 minutes.
 * Finds PENDING virtual-number orders older than 15 minutes,
 * checks their real status from 5sim, and:
 *   • If 5sim already received/finished → update DB, no refund.
 *   • Otherwise → cancel with 5sim, mark CANCELED/TIMEOUT, and
 *     credit the user's wallet with the full order price.
 * ─────────────────────────────────────────────────────────────
 * Usage (in your server.js / app.js):
 *
 *   const { startAutoRefundJob } = require('./services/autoRefundJob');
 *   startAutoRefundJob();
 */

const VirtualOrder  = require('../models/VirtualOrder');
const { creditWallet }         = require('./walletService');
const { checkOrder, cancelOrder } = require('./fivesimService');

const EXPIRY_MS      = 15 * 60 * 1000; // 15 minutes — same window as 5sim
const JOB_INTERVAL   =  5 * 60 * 1000; // run every 5 minutes

/**
 * Process one batch of expired PENDING orders.
 * Safe to call manually (e.g. from a test or admin route).
 */
async function processExpiredOrders() {
  const cutoff = new Date(Date.now() - EXPIRY_MS);

  // Find PENDING or RECEIVED orders older than the cutoff with no SMS received.
  // RECEIVED with no SMS means 5sim changed the status on their side but no code
  // was actually delivered — these need to be refunded too.
  const expiredOrders = await VirtualOrder.find({
    status:    { $in: ['PENDING', 'RECEIVED'] },
    createdAt: { $lt: cutoff },
    'sms.0':   { $exists: false },   // no SMS entries stored
  }).lean();

  if (!expiredOrders.length) return;

  console.log(`[autoRefund] Found ${expiredOrders.length} expired PENDING order(s) to process`);

  for (const order of expiredOrders) {
    try {
      // ── 1. Get the real status from 5sim ──────────────────────
      let liveStatus = null;
      let liveSms    = [];

      try {
        const live = await checkOrder(order.orderId);
        liveStatus = live.status?.toUpperCase() || null;
        liveSms    = live.sms || [];
      } catch (checkErr) {
        // 5sim check failed — treat as timed-out so we still refund
        console.warn(`[autoRefund] Could not check order ${order.orderId}: ${checkErr.message}`);
      }

      // ── 2. If OTP was actually received, just update — no refund ─
      if (liveStatus === 'RECEIVED' || liveStatus === 'FINISHED') {
        await VirtualOrder.updateOne(
          { _id: order._id },
          { status: liveStatus, ...(liveSms.length ? { sms: liveSms } : {}) }
        );
        console.log(`[autoRefund] Order ${order.orderId} already ${liveStatus} — skipping refund`);
        continue;
      }

      // ── 3. Try to cancel with 5sim (best-effort) ─────────────────
      let finalStatus = liveStatus || 'TIMEOUT';

      if (!liveStatus || liveStatus === 'PENDING') {
        try {
          await cancelOrder(order.orderId);
          finalStatus = 'CANCELED';
        } catch {
          // 5sim may reject cancel if already expired on their side — that's fine
          finalStatus = 'TIMEOUT';
        }
      }

      // ── 4. Update DB ──────────────────────────────────────────────
      await VirtualOrder.updateOne(
        { _id: order._id },
        {
          status: finalStatus,
          ...(liveSms.length ? { sms: liveSms } : {}),
        }
      );

      // ── 5. Refund the user's wallet ───────────────────────────────
      await creditWallet(
        order.user,
        order.price,
        `Auto-refund — expired number (${order.product}, ${order.country})`
      );

      console.log(
        `[autoRefund] Refunded ₦${order.price} to user ${order.user} ` +
        `for order ${order.orderId} [${finalStatus}]`
      );
    } catch (err) {
      // Never let one order crash the whole job
      console.error(`[autoRefund] Error processing order ${order.orderId}:`, err.message);
    }
  }
}

/**
 * Start the background job.
 * Call once at server startup — it runs immediately then every JOB_INTERVAL ms.
 * Returns the interval ID so you can clearInterval(id) in tests.
 */
function startAutoRefundJob() {
  console.log('[autoRefund] Auto-refund job started (interval: 5 min)');

  // Run once right away so numbers that were already expired before restart
  // get refunded immediately without waiting 5 minutes.
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
