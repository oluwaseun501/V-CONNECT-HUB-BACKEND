const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    baseUrl: { type: String, required: true },
    apiKey: { type: String, required: true },
    isActive: { type: Boolean, default: false },
    markupPercent: { type: Number, default: 0 },
    notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Provider', providerSchema);
