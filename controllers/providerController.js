const Provider = require("../models/Provider");

const maskProvider = (provider) => {
  const data = provider.toObject();

  return {
    ...data,
    apiKey: data.apiKey
      ? "••••••" + data.apiKey.slice(-6)
      : "",
  };
};

const getAllProviders = async (req, res) => {
  try {
    const providers = await Provider.find().sort({ createdAt: -1 });

    res.status(200).json(providers.map(maskProvider));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const addProvider = async (req, res) => {
  try {
    const {
      name,
      baseUrl,
      apiKey,
      markupPercent,
      notes,
    } = req.body;

    if (!name || !baseUrl || !apiKey) {
      return res.status(400).json({
        message: "name, baseUrl and apiKey are required",
      });
    }

    const provider = await Provider.create({
      name,
      baseUrl,
      apiKey,
      markupPercent,
      notes,
    });

    res.status(201).json({
      message: "Provider added",
      provider: maskProvider(provider),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: "A provider with that name already exists",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

const updateProvider = async (req, res) => {
  try {
    const {
      name,
      baseUrl,
      apiKey,
      markupPercent,
      notes,
    } = req.body;

    const update = {};

    if (name) update.name = name;
    if (baseUrl) update.baseUrl = baseUrl;
    if (apiKey) update.apiKey = apiKey;
    if (markupPercent !== undefined) {
      update.markupPercent = markupPercent;
    }
    if (notes !== undefined) update.notes = notes;

    const provider = await Provider.findByIdAndUpdate(
      req.params.id,
      update,
      {
        new: true,
        runValidators: true,
      },
    );

    if (!provider) {
      return res.status(404).json({
        message: "Provider not found",
      });
    }

    res.status(200).json({
      message: "Provider updated",
      provider: maskProvider(provider),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const setActiveProvider = async (req, res) => {
  try {
    const provider = await Provider.findById(req.params.id);

    if (!provider) {
      return res.status(404).json({
        message: "Provider not found",
      });
    }

    // Toggle only the selected provider.
    // This allows multiple providers to be active at the same time.
    provider.isActive = !provider.isActive;
    await provider.save();

    res.status(200).json({
      message: `Provider ${
        provider.isActive ? "enabled" : "disabled"
      } successfully`,
      provider: maskProvider(provider),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteProvider = async (req, res) => {
  try {
    const provider = await Provider.findByIdAndDelete(req.params.id);

    if (!provider) {
      return res.status(404).json({
        message: "Provider not found",
      });
    }

    res.status(200).json({
      message: "Provider deleted",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAllProviders,
  addProvider,
  updateProvider,
  setActiveProvider,
  deleteProvider,
};