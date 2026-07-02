const VirtualOrder = require('../models/VirtualOrder');
const { debitWallet, creditWallet } = require('../services/walletService');
const {
    getAvailableCountries,
    getAvailableProducts,
    purchaseNumber,
    checkOrder,
    cancelOrder,
    finishOrder
} = require('../services/fivesimService');

const listCountries = async (req, res) => {
    try {
        const countries = await getAvailableCountries();
        res.status(200).json(countries);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const listProducts = async (req, res) => {
    try {
        const { country, operator = 'any' } = req.params;
        const products = await getAvailableProducts(country, operator);
        res.status(200).json(products);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const buyNumber = async (req, res) => {
    try {
        const { country, operator = 'any', product } = req.body;
        if (!country || !product) {
            return res.status(400).json({ message: 'country and product are required' });
        }

        const orderData = await purchaseNumber(country, operator, product);
        await debitWallet(req.user._id, orderData.price, `Virtual number — ${product} (${country})`);

        const order = await VirtualOrder.create({
            user: req.user._id,
            orderId: orderData.id,
            phone: orderData.phone,
            country,
            operator: orderData.operator,
            product,
            price: orderData.price,
            status: orderData.status?.toUpperCase() || 'PENDING',
            expiresAt: orderData.expires ? new Date(orderData.expires) : undefined
        });

        res.status(201).json({ message: 'Number purchased successfully', order });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const checkSms = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await VirtualOrder.findOne({ orderId: Number(orderId), user: req.user._id });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const result = await checkOrder(Number(orderId));
        order.status = result.status?.toUpperCase() || order.status;
        if (result.sms?.length) order.sms = result.sms;
        await order.save();

        res.status(200).json({ orderId: order.orderId, phone: order.phone, status: order.status, sms: order.sms });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const cancelNumberOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await VirtualOrder.findOne({ orderId: Number(orderId), user: req.user._id });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Check live status from 5sim — prevent refund if SMS already received
        const liveOrder = await checkOrder(Number(orderId));
        const liveStatus = liveOrder.status?.toUpperCase();
        order.status = liveStatus || order.status;
        if (liveOrder.sms?.length) order.sms = liveOrder.sms;
        await order.save();

        if (order.status !== 'PENDING') {
            return res.status(400).json({ message: 'Cannot cancel — SMS already received or order no longer pending' });
        }

        await cancelOrder(Number(orderId));
        order.status = 'CANCELED';
        await order.save();

        await creditWallet(req.user._id, order.price, `Refund — cancelled number (${order.product})`);

        res.status(200).json({ message: 'Order cancelled and refunded', orderId: order.orderId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const finishNumberOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await VirtualOrder.findOne({ orderId: Number(orderId), user: req.user._id });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        await finishOrder(Number(orderId));
        order.status = 'FINISHED';
        await order.save();
        res.status(200).json({ message: 'Order finished', orderId: order.orderId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getMyOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const orders = await VirtualOrder.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit);
        const total = await VirtualOrder.countDocuments({ user: req.user._id });
        res.status(200).json({ orders, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getOrderById = async (req, res) => {
    try {
        const order = await VirtualOrder.findOne({ _id: req.params.id, user: req.user._id });
        if (!order) return res.status(404).json({ message: 'Order not found' });
        res.status(200).json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { listCountries, listProducts, buyNumber, checkSms, cancelNumberOrder, finishNumberOrder, getMyOrders, getOrderById };
