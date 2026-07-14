const mongoose = require('mongoose');

const smmServiceSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'SMMProvider', required: true },
    serviceId: { type: Number, required: true }, // ID from provider
    name: { type: String, required: true },
    category: { type: String },
    providerPrice: { type: Number, required: true }, // original price per 1000
    customPrice: { type: Number }, // your override price
    minOrder: { type: Number },
    maxOrder: { type: Number },
    isEnabled: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SMMService', smmServiceSchema);