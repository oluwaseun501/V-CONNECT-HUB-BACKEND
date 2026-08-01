const PriceOverride = require("../models/PriceOverride");

const getOverrides = async (req, res) => {
  try {
    const overrides = await PriceOverride.find()
      .sort({ provider: 1, service: 1, country: 1 });

    res.json(overrides);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

const upsertOverride = async (req, res) => {
  try {

const {
  service,
  country,
  price,
  provider,
  basePrice,          
} = req.body;

if (!service || !country || price == null || !provider) {
  return res.status(400).json({
    message: "service, country, price and provider are required",
  });
}
    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({
        message: "price must be a valid non-negative number",
      });
    }

    const normalizedService = service.toLowerCase().trim();
    const normalizedCountry = country.toLowerCase().trim();

    
const override = await PriceOverride.findOneAndUpdate(
  { provider, service: normalizedService, country: normalizedCountry },
  {
    provider,
    service: normalizedService,
    country: normalizedCountry,
    price: numericPrice,
    basePrice: basePrice != null ? Number(basePrice) : 0,   // ← NEW
  },
  { upsert: true, new: true, runValidators: true }
);
    res.json(override);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

const deleteOverride = async (req, res) => {
  try {
    await PriceOverride.findByIdAndDelete(req.params.id);

    res.json({
      message: "Override deleted",
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

module.exports = {
  getOverrides,
  upsertOverride,
  deleteOverride,
};