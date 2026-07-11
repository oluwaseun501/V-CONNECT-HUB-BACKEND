const mongoose = require('mongoose');

const priceOverrideSchema = new mongoose.Schema({
  service: { type: String, required: true, lowercase: true, trim: true },
  country: { type: String, required: true, lowercase: true, trim: true },
  price:   { type: Number, required: true, min: 0 },
}, { timestamps: true });

// One override per service+country combo
priceOverrideSchema.index({ service: 1, country: 1 }, { unique: true });

module.exports = mongoose.model('PriceOverride', priceOverrideSchema);