const VirtualOrder = require('../models/VirtualOrder');
const { creditWallet } = require('./walletService');

async function refundOrder(order, reason) {

    const locked = await VirtualOrder.findOneAndUpdate(
        {
            _id: order._id,
            refunded: false
        },
        {
            refunded: true,
            refundedAt: new Date()
        },
        {
            new: true
        }
    );

    if (!locked) {
        return false;
    }

    await creditWallet(
        locked.user,
        locked.price,
        reason
    );

    return true;
}

module.exports = {
    refundOrder
};