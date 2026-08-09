const mongoose = require('mongoose');

const boostOrderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SMMProvider',
        required: false,
    },
    service: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SMMService',
        required: true,
    },
    link: {
        type: String,
        required: true,
        trim: true,
    },
    quantity: {
        type: Number,
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    providerOrderId: {
        type: String,
    },
    providerCanCancel: {
        type: Boolean,
        default: false,
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'partial', 'failed', 'cancelled'],
        default: 'pending',
    },
    remains: {
        type: Number,
    },
    startCount: {
        type: Number,
    },
    delivered: {
        type: Number,
    },
    progressPercent: {
        type: Number,
        min: 0,
        max: 100,
    },
    providerCharge: {
        type: Number,
    },
    providerCurrency: {
        type: String,
    },
    lastProviderStatus: {
        type: String,
    },
    lastStatusCheckAt: {
        type: Date,
    },
    cancelRequestedAt: {
        type: Date,
    },
    cancellationSource: {
        type: String,
        enum: ['user', 'admin'],
    },
    refunded: {
        type: Boolean,
        default: false,
    },
    refundedAt: {
        type: Date,
    },
    refundAmount: {
        type: Number,
    },
}, { timestamps: true });

module.exports = mongoose.model('BoostOrder', boostOrderSchema);