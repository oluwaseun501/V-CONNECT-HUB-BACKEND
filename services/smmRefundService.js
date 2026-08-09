const BoostOrder = require('../models/BoostOrder');
const { creditWallet } = require('./walletService');

/**
 * Refunds a boost order at most once.
 *
 * The atomic refunded:false -> true claim prevents two polling/admin requests
 * from crediting the same customer's wallet twice.
 */
async function refundBoostOrder(orderOrId, description) {
    const orderId = orderOrId?._id || orderOrId;

    const claimed = await BoostOrder.findOneAndUpdate(
        {
            _id: orderId,
            refunded: { $ne: true },
        },
        {
            $set: {
                refunded: true,
                refundedAt: new Date(),
                refundAmount: orderOrId?.amount,
            },
        },
        { new: true }
    );

    if (!claimed) return false;

    try {
        await creditWallet(
            claimed.user,
            claimed.amount,
            description || `Refund - SMM order ${claimed._id}`
        );
        return true;
    } catch (error) {
        await BoostOrder.updateOne(
            { _id: claimed._id, refunded: true },
            {
                $set: { refunded: false },
                $unset: { refundedAt: 1, refundAmount: 1 },
            }
        );
        throw error;
    }
}

module.exports = { refundBoostOrder };