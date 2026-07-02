const User = require('../models/User');
const Transaction = require('../models/Transaction');
const generateReference = require('../utils/generateReference');

const debitWallet = async (userId, amount, description) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.balance < amount) throw new Error('Insufficient wallet balance');

    user.balance -= amount;
    await user.save();

    await Transaction.create({
        user: userId,
        reference: generateReference(),
        type: 'debit',
        amount,
        description,
        status: 'successful'
    });
};

const creditWallet = async (userId, amount, description) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.balance += amount;
    await user.save();

    await Transaction.create({
        user: userId,
        reference: generateReference(),
        type: 'credit',
        amount,
        description,
        status: 'successful'
    });
};

module.exports = { debitWallet, creditWallet };
