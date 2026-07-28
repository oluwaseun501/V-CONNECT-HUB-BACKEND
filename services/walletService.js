const User = require('../models/User');
const Transaction = require('../models/Transaction');
const generateReference = require('../utils/generateReference');


// ============================================================
// DEBIT WALLET
// ============================================================
const debitWallet = async (
    userId,
    amount,
    description
) => {

    // Validate amount
    if (
        !amount ||
        Number(amount) <= 0
    ) {
        throw new Error(
            'Invalid debit amount'
        );
    }

    const debitAmount =
        Number(amount);

    // Atomically deduct balance only if
    // the user has enough money.
    //
    // This prevents two simultaneous purchases
    // from spending the same wallet balance.
    const user = await User.findOneAndUpdate(
        {
            _id: userId,

            // Important:
            // Only update the user if their balance
            // is greater than or equal to the amount.
            balance: {
                $gte: debitAmount
            }
        },
        {
            $inc: {
                balance: -debitAmount
            }
        },
        {
            new: true
        }
    );

    // If no user was returned, either:
    // 1. The user does not exist
    // 2. The user does not have enough balance
    if (!user) {

        const existingUser =
            await User.exists({
                _id: userId
            });

        if (!existingUser) {
            throw new Error(
                'User not found'
            );
        }

        throw new Error(
            'Insufficient wallet balance'
        );
    }

    // Create transaction record
    try {

        await Transaction.create({
            user: userId,

            reference:
                generateReference(),

            type: 'debit',

            amount:
                debitAmount,

            description,

            status:
                'successful'
        });

    } catch (transactionError) {

        // ====================================================
        // TRANSACTION CREATION FAILED
        // ====================================================
        // The wallet was already debited, so we must reverse
        // the balance to prevent the user losing money without
        // a transaction record.
        // ====================================================

        try {

            await User.findByIdAndUpdate(
                userId,
                {
                    $inc: {
                        balance:
                            debitAmount
                    }
                }
            );

        } catch (refundError) {

            console.error(
                '[debitWallet] CRITICAL: Failed to reverse wallet debit:',
                refundError.message
            );
        }

        throw new Error(
            'Wallet debit failed. Please try again.'
        );
    }

    return user;
};


// ============================================================
// CREDIT WALLET
// ============================================================
const creditWallet = async (
    userId,
    amount,
    description
) => {

    // Validate amount
    if (
        !amount ||
        Number(amount) <= 0
    ) {
        throw new Error(
            'Invalid credit amount'
        );
    }

    const creditAmount =
        Number(amount);

    // Atomically increase wallet balance
    const user =
        await User.findByIdAndUpdate(
            userId,
            {
                $inc: {
                    balance:
                        creditAmount
                }
            },
            {
                new: true
            }
        );

    if (!user) {
        throw new Error(
            'User not found'
        );
    }

    // Create credit transaction
    try {

        await Transaction.create({
            user: userId,

            reference:
                generateReference(),

            type: 'credit',

            amount:
                creditAmount,

            description,

            status:
                'successful'
        });

    } catch (transactionError) {

        // ====================================================
        // TRANSACTION CREATION FAILED
        // ====================================================
        // The wallet was already credited, so reverse the
        // balance increase.
        // ====================================================

        try {

            await User.findByIdAndUpdate(
                userId,
                {
                    $inc: {
                        balance:
                            -creditAmount
                    }
                }
            );

        } catch (rollbackError) {

            console.error(
                '[creditWallet] CRITICAL: Failed to reverse wallet credit:',
                rollbackError.message
            );
        }

        throw new Error(
            'Wallet credit failed. Please try again.'
        );
    }

    return user;
};


module.exports = {
    debitWallet,
    creditWallet
};