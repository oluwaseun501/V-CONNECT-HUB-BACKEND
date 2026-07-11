const PriceOverride = require('../models/PriceOverride');

const getOverrides = async (req, res) => {
  try {
    const overrides = await PriceOverride.find().sort({ service: 1, country: 1 });
    res.json(overrides);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const upsertOverride = async (req, res) => {
  try {
    const { service, country, price } = req.body;
    if (!service || !country || price == null) {
      return res.status(400).json({ message: 'service, country and price are required' });
    }
    const override = await PriceOverride.findOneAndUpdate(
      { service: service.toLowerCase(), country: country.toLowerCase() },
      { price },
      { upsert: true, new: true }
    );
    res.json(override);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteOverride = async (req, res) => {
  try {
    await PriceOverride.findByIdAndDelete(req.params.id);
    res.json({ message: 'Override deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getOverrides, upsertOverride, deleteOverride };