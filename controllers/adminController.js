const User = require('../models/User');
const Transaction = require('../models/Transaction');
const VirtualOrder = require('../models/VirtualOrder');
const { creditWallet, debitWallet } = require('../services/walletService');

const getDashboardStats = async (req, res) => {
    try {
        const [totalUsers, totalTransactions, totalOrders, recentOrders, recentUsers] = await Promise.all([
            User.countDocuments(),
            Transaction.countDocuments(),
            VirtualOrder.countDocuments(),
            VirtualOrder.find().sort({ createdAt: -1 }).limit(5).populate('user', 'name email'),
            User.find().sort({ createdAt: -1 }).limit(5).select('-password -transactionPin')
        ]);

        const revenueAgg = await Transaction.aggregate([
            { $match: { type: 'debit', status: 'successful', description: { $regex: /virtual number/i } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalRevenue = revenueAgg[0]?.total ?? 0;

        res.status(200).json({ totalUsers, totalTransactions, totalOrders, totalRevenue, recentOrders, recentUsers });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search;
        const skip = (page - 1) * limit;

        const filter = {};
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const [users, total] = await Promise.all([
            User.find(filter).select('-password -transactionPin').sort({ createdAt: -1 }).skip(skip).limit(limit),
            User.countDocuments(filter)
        ]);

        res.status(200).json({ users, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -transactionPin');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const [transactions, orders] = await Promise.all([
            Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(10),
            VirtualOrder.find({ user: user._id }).sort({ createdAt: -1 }).limit(10)
        ]);

        res.status(200).json({ user, transactions, orders });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateUser = async (req, res) => {
    try {
        const { isAdmin, isEmailVerified } = req.body;
        const update = {};
        if (isAdmin !== undefined) update.isAdmin = isAdmin;
        if (isEmailVerified !== undefined) update.isEmailVerified = isEmailVerified;

        const user = await User.findByIdAndUpdate(req.params.id, update, { new: true })
            .select('-password -transactionPin');

        if (!user) return res.status(404).json({ message: 'User not found' });
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const fundUserWallet = async (req, res) => {
    try {
        const { amount, description } = req.body;
        if (!amount || Number(amount) <= 0) return res.status(400).json({ message: 'Valid amount required' });

        await creditWallet(req.params.id, Number(amount), description || 'Admin wallet credit');
        const user = await User.findById(req.params.id).select('name email balance');
        res.status(200).json({ message: 'Wallet funded', user });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const debitUserWallet = async (req, res) => {
    try {
        const { amount, description } = req.body;
        if (!amount || Number(amount) <= 0) return res.status(400).json({ message: 'Valid amount required' });

        await debitWallet(req.params.id, Number(amount), description || 'Admin wallet debit');
        const user = await User.findById(req.params.id).select('name email balance');
        res.status(200).json({ message: 'Wallet debited', user });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getAllTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const [transactions, total] = await Promise.all([
            Transaction.find().sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'name email'),
            Transaction.countDocuments()
        ]);

        res.status(200).json({ transactions, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getAllOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const filter = {};
        if (req.query.status) filter.status = req.query.status.toUpperCase();

        const [orders, total] = await Promise.all([
            VirtualOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'name email'),
            VirtualOrder.countDocuments(filter)
        ]);

        res.status(200).json({ orders, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getDashboardStats, getAllUsers, getUserById, updateUser, deleteUser,
    fundUserWallet, debitUserWallet, getAllTransactions, getAllOrders
};
