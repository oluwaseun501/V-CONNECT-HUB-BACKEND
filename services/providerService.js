// ============================================================
// PATCH — activateProvider handler
// Find this function in your providerController.js (or wherever
// your admin provider routes live) and replace the entire
// function body with this version.
//
// OLD: deactivates ALL providers, then activates one
// NEW: toggles the clicked provider on/off independently
//      so multiple providers can be active at the same time
// ============================================================

const activateProvider = async (req, res) => {
  try {
    const provider = await Provider.findById(req.params.id);

    if (!provider) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    // Toggle: active → disabled, inactive → enabled
    provider.isActive = !provider.isActive;
    await provider.save();

    return res.status(200).json({
      message: `Provider ${provider.isActive ? 'enabled' : 'disabled'} successfully`,
      provider,
    });
  } catch (error) {
    console.error('[activateProvider]', error);
    res.status(500).json({ message: error.message });
  }
};
