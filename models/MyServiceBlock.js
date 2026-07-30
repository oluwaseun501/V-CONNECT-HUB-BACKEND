// NEW FILE — place in your models/ folder as models/ServiceBlock.js
// Stores services that the admin has disabled for users.

const mongoose = require('mongoose');

const ServiceBlockSchema = new mongoose.Schema(
  {
    service:  { type: String, required: true, lowercase: true, trim: true },
    country:  { type: String, required: true, lowercase: true, trim: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
  },
  { timestamps: true }
);

// Unique per service + country + provider combo
ServiceBlockSchema.index(
  { service: 1, country: 1, provider: 1 },
  { unique: true }
);

module.exports = mongoose.model('ServiceBlock', ServiceBlockSchema);
