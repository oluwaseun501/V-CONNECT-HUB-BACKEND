const mongoose = require('mongoose');

const smmServiceSchema = new mongoose.Schema({
    provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SMMProvider',
        required: true,
    },
    serviceId: {
        type: Number,
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    category: {
        type: String,
    },
    providerPrice: {
        type: Number,
        required: true,
    },
    customPrice: {
        type: Number,
    },
    priceSource: {
        type: String,
        enum: ['markup', 'manual'],
        default: 'markup',
    },
    minOrder: {
        type: Number,
    },
    maxOrder: {
        type: Number,
    },
    canCancel: {
        type: Boolean,
        default: false,
    },
    isEnabled: {
        type: Boolean,
        default: true,
    },
}, { timestamps: true });

smmServiceSchema.index(
    { provider: 1, serviceId: 1 },
    { unique: true }
);

module.exports = mongoose.model('SMMService', smmServiceSchema);