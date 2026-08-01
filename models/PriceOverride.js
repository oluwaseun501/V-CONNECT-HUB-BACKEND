const mongoose = require("mongoose");

const priceOverrideSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
    },

    service: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    country: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    // ← NEW: the computed base price at the time the override was saved
    basePrice: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// One override per provider + service + country
priceOverrideSchema.index(
  { provider: 1, service: 1, country: 1 },
  { unique: true }
);

module.exports = mongoose.model("PriceOverride", priceOverrideSchema);