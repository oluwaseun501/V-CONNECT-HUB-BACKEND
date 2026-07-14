const mongoose = require('mongoose');

const smmProviderSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    apiUrl: { type: String, required: true },
    apiKey: { type: String, required: true },
    markupPercent: { type: Number, default: 0 },
    isActive: { type: Boolean, default: false },
    notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('SMMProvider', smmProviderSchema);