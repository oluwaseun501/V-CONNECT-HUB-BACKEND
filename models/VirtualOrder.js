const mongoose = require('mongoose');

const virtualOrderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: Number, required: true, unique: true },
    phone: { type: String, required: true },
    country: { type: String, required: true },
    operator: { type: String, required: true },
    product: { type: String, required: true },
    price: { type: Number, required: true },
    status: {
        type: String,
        enum: ['PENDING', 'RECEIVED', 'CANCELED', 'TIMEOUT', 'FINISHED', 'BANNED'],
        default: 'PENDING'
    },
    sms: [{
        sender: String,
        text: String,
        date: String
    }],
    expiresAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('VirtualOrder', virtualOrderSchema);
