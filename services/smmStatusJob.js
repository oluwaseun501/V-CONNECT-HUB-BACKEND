const BoostOrder = require('../models/BoostOrder');
const SMMProvider = require('../models/SMMProvider');
const {
    providerRequest,
    isProviderUnavailable,
} = require('./smmProviderApi');
const { applyProviderStatus } = require('../controllers/boostingController');

const JOB_INTERVAL_MS = 60 * 1000;
const BATCH_SIZE = 100;

let isRunning = false;

async function processSMMStatuses() {
    if (isRunning) return;
    isRunning = true;

    try {
        const orders = await BoostOrder.find({
            status: { $in: ['pending', 'processing'] },
            providerOrderId: { $exists: true, $nin: [null, ''] },
        })
            .sort({ lastStatusCheckAt: 1, createdAt: 1 })
            .limit(BATCH_SIZE)
            .lean();

        if (!orders.length) return;

        const grouped = new Map();
        for (const order of orders) {
            const providerId = String(order.provider || '');
            if (!grouped.has(providerId)) grouped.set(providerId, []);
            grouped.get(providerId).push(order);
        }

        for (const [providerId, providerOrders] of grouped) {
            const provider = providerId
                ? await SMMProvider.findById(providerId).lean()
                : await SMMProvider.findOne({ isActive: true }).lean();

            if (!provider) continue;

            const response = await providerRequest(provider, {
                key: provider.apiKey,
                action: 'status',
                orders: providerOrders.map((order) => order.providerOrderId).join(','),
            });

            if (isProviderUnavailable(response) || !response.data ||
                Array.isArray(response.data)) {
                continue;
            }

            for (const order of providerOrders) {
                const status = response.data[order.providerOrderId];
                if (!status || status.error) continue;

                const current = await BoostOrder.findById(order._id)
                    .populate('service', 'name category canCancel');
                if (!current || !['pending', 'processing'].includes(current.status)) {
                    continue;
                }

                await applyProviderStatus(current, status);
            }
        }
    } catch (error) {
        console.error('[smmStatus] Scan error:', error.message);
    } finally {
        isRunning = false;
    }
}

function startSMMStatusJob() {
    console.log('[smmStatus] SMM status polling started (interval: 1 min)');
    processSMMStatuses().catch((error) =>
        console.error('[smmStatus] Initial run error:', error.message)
    );

    return setInterval(() => {
        processSMMStatuses().catch((error) =>
            console.error('[smmStatus] Job error:', error.message)
        );
    }, JOB_INTERVAL_MS);
}

module.exports = {
    startSMMStatusJob,
    processSMMStatuses,
};