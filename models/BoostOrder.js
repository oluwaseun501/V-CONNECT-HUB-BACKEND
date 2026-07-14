const mongoose = require('mongoose');

const boostOrderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'SMMService', required: true },
    link: { type: String, required: true },
    quantity: { type: Number, required: true },
    amount: { type: Number, required: true },
    providerOrderId: { type: String },
    status: { type: String, default: 'pending' }, // pending, processing, completed, failed, cancelled
    remains: { type: Number },
    startCount: { type: Number }
}, { timestamps: true });

module.exports = mongoose.model('BoostOrder', boostOrderSchema);