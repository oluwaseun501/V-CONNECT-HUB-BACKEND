const Transaction = require('../models/Transaction');
const User = require('../models/User');
const generateReference = require('../utils/generateReference');
const { debitWallet, creditWallet } = require('../services/walletService');
const { initializePaystackTransaction, verifyPaystackTransaction, verifyPaystackWebhook } = require('../services/paystackService');
const { initializeKorapayTransaction, verifyKorapayTransaction } = require('../services/korapayService');

const transferFunds = async (req, res) => {
    try {
        const { recipientEmail: email, amount } = req.body;

        if (!email || !amount) {
            return res.status(400).json({ message: 'Please provide email and amount' });
        }

        const receiver = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });

        if (!receiver) {
            return res.status(404).json({ message: 'Receiver not found' });
        }

        if (receiver._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ message: 'You cannot transfer to yourself' });
        }

        await debitWallet(req.user._id, Number(amount), `Transfer to ${receiver.email}`);
await creditWallet(receiver._id, Number(amount), `Transfer from ${req.user.email}`);

// Mark both transactions as transfer type so they show correctly in admin
await Transaction.updateOne(
    { user: req.user._id, description: `Transfer to ${receiver.email}`, status: 'successful' },
    { $set: { type: 'transfer' } }
);
await Transaction.updateOne(
    { user: receiver._id, description: `Transfer from ${req.user.email}`, status: 'successful' },
    { $set: { type: 'transfer' } }
);

        return res.status(200).json({ message: 'Transfer successful' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const initiateFunding = async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount || Number(amount) < 100) {
            return res.status(400).json({ message: 'Minimum amount is ₦100' });
        }

        const user = await User.findById(req.user._id);
        const reference = generateReference();

        const { authorizationUrl } = await initializePaystackTransaction({
            email: user.email,
            amount: Number(amount),
            reference,
            callbackUrl: `${process.env.FRONTEND_URL}/wallet/verify?reference=${reference}`
        });

        // Save pending transaction
        await Transaction.create({
            user: user._id,
            reference,
            type: 'credit',
            amount: Number(amount),
            description: 'Wallet Funding via Paystack',
            status: 'pending'
        });

        res.status(200).json({
            message: 'Click the payment link to complete your funding',
            reference,
            amount: Number(amount),
            authorizationUrl
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const verifyFunding = async (req, res) => {
    try {
        const { reference } = req.params;

        const result = await verifyPaystackTransaction(reference);

        if (result.status !== 'success') {
            return res.status(400).json({ message: 'Payment not successful' });
        }

        // Prevent double crediting
        const existing = await Transaction.findOne({ reference, status: 'successful' });
        if (existing) {
            return res.status(200).json({ message: 'Already credited' });
        }

        const user = await User.findOne({ email: result.email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.balance = Number(user.balance) + Number(result.amount);
        await user.save();

        await Transaction.findOneAndUpdate({ reference }, { status: 'successful' });

        res.status(200).json({ message: 'Wallet funded successfully', balance: user.balance });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const initiateKorapayFunding = async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || Number(amount) < 100) {
            return res.status(400).json({ message: 'Minimum amount is ₦100' });
        }

        const user = await User.findById(req.user._id);
        const reference = generateReference();

        const { checkoutUrl } = await initializeKorapayTransaction({
            email: user.email,
            amount: Number(amount),
            reference,
            callbackUrl: `${process.env.FRONTEND_URL}/wallet/verify?reference=${reference}&provider=korapay`
        });

        await Transaction.create({
            user: user._id,
            reference,
            type: 'credit',
            amount: Number(amount),
            description: 'Wallet Funding via Korapay',
            status: 'pending'
        });

        res.status(200).json({
            message: 'Click the payment link to complete your funding',
            reference,
            amount: Number(amount),
            checkoutUrl
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const verifyKorapayFunding = async (req, res) => {
    try {
        const { reference } = req.params;

        const result = await verifyKorapayTransaction(reference);

        if (result.status !== 'success') {
            return res.status(400).json({ message: 'Payment not successful' });
        }

        const existing = await Transaction.findOne({ reference, status: 'successful' });
        if (existing) {
            return res.status(200).json({ message: 'Already credited' });
        }

        const user = await User.findOne({ email: result.email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.balance = Number(user.balance) + Number(result.amount);
        await user.save();

        await Transaction.findOneAndUpdate({ reference }, { status: 'successful' });

        res.status(200).json({ message: 'Wallet funded successfully', balance: user.balance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const korapayWebhook = async (req, res) => {
    try {
        // Verify signature — same pattern as Paystack
        const signature = req.headers['x-korapay-signature'];
        const rawBody = req.body;

        const hash = require('crypto')
            .createHmac('sha256', process.env.KORAPAY_SECRET_KEY)
            .update(rawBody)
            .digest('hex');

        if (hash !== signature) {
            return res.status(400).json({ message: 'Invalid signature' });
        }

        res.status(200).json({ message: 'Webhook received' });

        const payload = JSON.parse(rawBody.toString());
        const { event, data } = payload;

        if (event !== 'charge.success') return;

        const existing = await Transaction.findOne({ reference: data.reference, status: 'successful' });
        if (existing) return;

        const user = await User.findOne({ email: data.customer?.email });
        if (!user) return;

        user.balance = Number(user.balance) + Number(data.amount);
        await user.save();

        await Transaction.findOneAndUpdate(
            { reference: data.reference },
            { status: 'successful' }
        );
    } catch (error) {
        console.error('Korapay webhook error:', error.message);
    }
};

const paystackWebhook = async (req, res) => {
    try {
        const signature = req.headers['x-paystack-signature'];
        const rawBody = req.body;

        if (!verifyPaystackWebhook(signature, rawBody)) {
            return res.status(400).json({ message: 'Invalid signature' });
        }

        res.status(200).json({ message: 'Webhook received' });

        const payload = JSON.parse(rawBody.toString());
        const { event, data } = payload;

        if (event !== 'charge.success') return;

        // Prevent double crediting
        const existing = await Transaction.findOne({ reference: data.reference, status: 'successful' });
        if (existing) return;

        const user = await User.findOne({ email: data.customer.email });
        if (!user) return;

        const amount = data.amount / 100;
        user.balance = Number(user.balance) + amount;
        await user.save();

        await Transaction.findOneAndUpdate(
            { reference: data.reference },
            { status: 'successful' }
        );

    } catch (error) {
        console.error('Webhook error:', error.message);
    }
};

const getTransactionHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const transactions = await Transaction.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Transaction.countDocuments({ user: req.user._id });

        res.status(200).json({ transactions, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const lookupUser = async (req, res) => {
    try {
        const email = (req.query.email || '').trim();
        if (!email) return res.status(400).json({ message: 'Email is required' });

        const user = await User.findOne({
            email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
        });

        if (!user) return res.status(404).json({ message: 'No account found with this email.' });

        // Don't expose sensitive fields — return only what the sender needs to see
        res.json({ name: user.name, email: user.email });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    transferFunds, initiateFunding, verifyFunding, paystackWebhook, getTransactionHistory,
    initiateKorapayFunding, verifyKorapayFunding, korapayWebhook, lookupUser
};
