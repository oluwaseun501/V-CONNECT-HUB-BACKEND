const VirtualOrder = require('../models/VirtualOrder');
const Provider = require('../models/Provider');
const PriceOverride = require('../models/PriceOverride');
const SiteConfig = require('../models/SiteConfig');
const User = require('../models/User');
const ServiceBlock = require('../models/MyServiceBlock'); // ← NEW

const {
    debitWallet,
    creditWallet,
} = require("../services/walletService");

const {
  refundOrder,
} = require('../services/refundService');

const mapSms = require('../utils/smsMapper');

const {
  getAvailableCountries,
  getAvailableProducts,
  purchaseNumber,
  purchaseNumberFromProvider,
  checkOrder,
  cancelOrder,
  finishOrder,
} = require('../services/fivesimService');


// ============================================================
// CONSTANTS
// ============================================================

const ORDER_EXPIRY_MS = 15 * 60 * 1000;


// ============================================================
// NORMALIZE 5SIM STATUS → OUR ENUM
// ============================================================
function normalize5simStatus(raw) {
  if (!raw) return null;
  const s = raw.toUpperCase();
  const map = {
    'STATUS_WAIT_CODE':   'PENDING',
    'STATUS_WAIT_RETRY':  'PENDING',
    'STATUS_WAIT_RESEND': 'PENDING',
    'STATUS_OK':          'RECEIVED',
    'STATUS_CANCEL':      'CANCELED',
    'STATUS_TIMEOUT':     'TIMEOUT',
  };
  return map[s] ?? s;
}


// ============================================================
// LIST ACTIVE PROVIDERS  (public — returns name + id only)
// ============================================================
const listProviders = async (req, res) => {
  try {
    const providers = await Provider.find({ isActive: true })
      .select('_id name isActive');
    res.status(200).json(providers);
  } catch (error) {
    console.error('[listProviders]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// GET DISABLED SERVICES  (admin — query by country + provider)
// ============================================================
const getDisabledServices = async (req, res) => {
  try {
    const query = {};
    if (req.query.country)  query.country  = req.query.country.toLowerCase();
    if (req.query.provider) query.provider = req.query.provider;

    const blocks = await ServiceBlock.find(query);
    res.status(200).json(blocks);
  } catch (error) {
    console.error('[getDisabledServices]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// TOGGLE SERVICE DISABLED  (admin — enable or disable a service)
// ============================================================
const toggleServiceDisabled = async (req, res) => {
  try {
    const { service, country, provider, disabled } = req.body;

    if (!service || !country || !provider) {
      return res.status(400).json({ message: 'service, country and provider are required' });
    }

    if (disabled) {
      // Upsert — create the block if it doesn't exist yet
      await ServiceBlock.findOneAndUpdate(
        {
          service:  service.toLowerCase(),
          country:  country.toLowerCase(),
          provider,
        },
        {
          service:  service.toLowerCase(),
          country:  country.toLowerCase(),
          provider,
        },
        { upsert: true, new: true }
      );
    } else {
      // Remove the block — service becomes visible again
      await ServiceBlock.findOneAndDelete({
        service:  service.toLowerCase(),
        country:  country.toLowerCase(),
        provider,
      });
    }

    res.status(200).json({
      message: disabled ? 'Service hidden from users' : 'Service restored for users',
    });
  } catch (error) {
    console.error('[toggleServiceDisabled]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// GET AVAILABLE COUNTRIES
// ============================================================
const listCountries = async (req, res) => {
  try {
    let provider;

    if (req.query.provider) {
      provider = await Provider.findById(req.query.provider);
    }

    if (!provider) {
      provider = await Provider.findOne({ isActive: true });
    }

    if (!provider) {
      return res.status(400).json({ message: 'No active provider found' });
    }

    const countries = await getAvailableCountries(provider);
    res.status(200).json(countries);
  } catch (error) {
    console.error('[listCountries]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// GET AVAILABLE PRODUCTS / SERVICES
// ── Now filters out admin-disabled services before responding
// ============================================================
const listProducts = async (req, res) => {
  try {
    const {
      country,
      operator = 'virtual',
    } = req.params;

    const includeHidden = req.query.includeHidden === 'true';

    let provider;
    if (req.query.provider) {
      provider = await Provider.findById(req.query.provider);
    }
    if (!provider) {
      provider = await Provider.findOne({ isActive: true });
    }
    if (!provider) {
      return res.status(400).json({ message: 'No active provider found' });
    }

    const markupPercent = provider?.markupPercent ?? 0;

    const siteConfig = await SiteConfig.findOne();
    const usdToNgn = siteConfig?.usdToNgn ?? 1600;

const normalizedCountry = country.toLowerCase().trim();

const overrides = await PriceOverride.find({
  provider: provider._id,
  country: normalizedCountry,
});

const overrideMap = {};

overrides.forEach((override) => {
  overrideMap[override.service.toLowerCase().trim()] = Number(
    override.price,
  );
});
    // ── NEW: build a set of disabled service names for this country+provider ──
    const blockedDocs = await ServiceBlock.find({
      country:  country.toLowerCase(),
      provider: provider._id,
    });
    const blockedSet = new Set(blockedDocs.map(b => b.service.toLowerCase()));

    const products = await getAvailableProducts(country, operator, provider);

    const normalized = {};

    for (const [service, operators] of Object.entries(products)) {
      if (!operators || typeof operators !== 'object') continue;

      // ── NEW: skip services the admin has disabled ──
     if (!includeHidden && blockedSet.has(service.toLowerCase())) continue;

      normalized[service] = {};

      for (const [op, data] of Object.entries(operators)) {
        const rawPrice =
          data?.Price ??
          data?.price ??
          data?.cost ??
          0;
const overridePrice =
  overrideMap[service.toLowerCase().trim()];

const basePrice = parseFloat(
  (
    Number(rawPrice) *
    Number(usdToNgn) *
    (1 + Number(markupPercent) / 100)
  ).toFixed(2)
);

const finalPrice =
  overridePrice != null
    ? Number(overridePrice)
    : basePrice;

normalized[service][op] = {
  ...data,

  // Price before the admin override
  BasePrice: basePrice,

  // Price shown to users and used for purchase
  Price: finalPrice,
  isHidden: blockedSet.has(service.toLowerCase()),
};
      }
    }

    res.status(200).json(normalized);

  } catch (error) {
    console.error('[listProducts]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// BUY VIRTUAL NUMBER
// ============================================================

  
 const buyNumber = async (req, res) => {
  let orderData = null;
  let walletDebited = false;

  try {
   const { product, country, operator = 'virtual' } = req.body;
const preferredProviderId = req.body.provider || req.body.preferredProviderId;
    const includeHidden = req.query.includeHidden === 'true';

    if (!country || !product) {
      return res.status(400).json({
        message: 'country and product are required',
      });
    }

    const provider = preferredProviderId
      ? await Provider.findById(preferredProviderId)
      : await Provider.findOne({ isActive: true });

      if (!provider) {
  return res.status(400).json({
    message: "Selected provider was not found or is inactive",
  });
}
    const markupPercent = provider?.markupPercent ?? 0;

    const siteConfig = await SiteConfig.findOne();
    const usdToNgn = siteConfig?.usdToNgn ?? 1600;

const override = await PriceOverride.findOne({
  provider: provider._id,
  service: product.toLowerCase().trim(),
  country: country.toLowerCase().trim(),
});
    const user = await User.findById(req.user._id).select('balance');

    if (!user) {
      return res.status(404).json({ message: 'User account not found' });
    }

    let estimatedPrice = 0;

    if (override) {
      estimatedPrice = Number(override.price);
    } else {
      const products = await getAvailableProducts(country, operator, provider || undefined);

      const serviceData = products?.[product];
      let rawPrice = 0;

      if (serviceData && typeof serviceData === 'object') {
        const operatorData = serviceData?.[operator];
        rawPrice =
          operatorData?.Price ??
          operatorData?.price ??
          operatorData?.cost ??
          0;
      }

      estimatedPrice = parseFloat(
        (
          Number(rawPrice) *
          Number(usdToNgn) *
          (1 + Number(markupPercent) / 100)
        ).toFixed(2)
      );
    }

    if (estimatedPrice > 0 && Number(user.balance) < estimatedPrice) {
      return res.status(400).json({ message: 'Insufficient wallet balance' });
    }

    if (preferredProviderId) {
      orderData = await purchaseNumberFromProvider(country, operator, product, preferredProviderId);
    } else {
      orderData = await purchaseNumber(country, operator, product);
    }

    const basePrice = orderData.price ?? orderData.Price ?? 0;

    if (!basePrice || Number(basePrice) <= 0) {
      try {
        if (orderData?.id) {
          await cancelOrder(orderData.id);
        }
      } catch (cancelError) {
        console.error('[buyNumber] Failed to cancel invalid order:', cancelError.message);
      }

      return res.status(400).json({ message: 'Unable to determine provider price' });
    }

    const providerCostNgn = parseFloat(
      (Number(basePrice) * Number(usdToNgn)).toFixed(2)
    );

    let finalPrice;

    if (override) {
      finalPrice = Number(override.price);
    } else {
      finalPrice = parseFloat(
        (
          Number(basePrice) *
          Number(usdToNgn) *
          (1 + Number(markupPercent) / 100)
        ).toFixed(2)
      );
    }

    if (finalPrice < providerCostNgn) {
      try {
        await cancelOrder(orderData.id);
      } catch (cancelError) {
        console.error('[buyNumber] Failed to cancel loss-making order:', cancelError.message);
      }

      return res.status(400).json({
        message: 'This service is temporarily unavailable. Please contact support.',
      });
    }

    const latestUser = await User.findById(req.user._id).select('balance');

    if (!latestUser) {
      try { await cancelOrder(orderData.id); } catch (_) {}
      return res.status(404).json({ message: 'User account not found' });
    }

    if (Number(latestUser.balance) < finalPrice) {
      try {
        await cancelOrder(orderData.id);
      } catch (cancelError) {
        console.error('[buyNumber] Failed to cancel order:', cancelError.message);
      }
      return res.status(400).json({ message: 'Insufficient wallet balance' });
    }

    try {
      await debitWallet(
        req.user._id,
        finalPrice,
        `Virtual number — ${product} (${country})`
      );
      walletDebited = true;
    } catch (debitError) {
      console.error('[buyNumber] Wallet debit failed:', debitError.message);
      try { await cancelOrder(orderData.id); } catch (cancelError) {
        console.error('[buyNumber] Failed to cancel provider order:', cancelError.message);
      }
      return res.status(400).json({
        message: 'Unable to complete purchase. Your wallet was not charged.',
      });
    }

    const purchasedAt = new Date();
    const expiresAt = new Date(purchasedAt.getTime() + ORDER_EXPIRY_MS);

    try {
      const order = await VirtualOrder.create({
        user:     req.user._id,
        orderId:  orderData.id,
        phone:    orderData.phone,
        country,
        operator: orderData.operator || operator,
        product,
        price:    finalPrice,
        status:   normalize5simStatus(orderData.status) || 'PENDING',
        expiresAt,
        sms: [],
      });

      return res.status(201).json({
        message: 'Number purchased successfully',
        order,
      });

    } catch (databaseError) {
      console.error('[buyNumber] Failed to save order:', databaseError.message);

      try { await cancelOrder(orderData.id); } catch (cancelError) {
        console.error('[buyNumber] Failed to cancel provider order after DB failure:', cancelError.message);
      }

      if (walletDebited) {
        try {
          await creditWallet(
            req.user._id,
            finalPrice,
            `Refund — failed virtual number order (${product})`
          );
          console.log(`[buyNumber] User refunded ₦${finalPrice}`);
        } catch (refundError) {
          console.error('[buyNumber] CRITICAL: Refund failed:', refundError.message);
        }
      }

      return res.status(500).json({
        message: 'Purchase could not be completed. Your wallet has been refunded.',
      });
    }

  } catch (error) {
    console.error('[buyNumber] Unexpected error:', error);

    if (orderData?.id && !walletDebited) {
      try { await cancelOrder(orderData.id); } catch (cancelError) {
        console.error('[buyNumber] Failed to cancel provider order:', cancelError.message);
      }
    }

    return res.status(500).json({
      message: 'Service temporarily unavailable. Please try again or contact support.',
    });
  }
};


// ============================================================
// CHECK SMS / ORDER STATUS
// ============================================================
const checkSms = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await VirtualOrder.findOne({
      orderId: Number(orderId),
      user:    req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (['TIMEOUT', 'CANCELED', 'FINISHED', 'BANNED'].includes(order.status)) {
      return res.status(200).json({
        orderId:   order.orderId,
        phone:     order.phone,
        status:    order.status,
        sms:       order.sms,
        expiresAt: order.expiresAt,
      });
    }

    const result = await checkOrder(Number(orderId));

    if (result.status) {
      order.status = normalize5simStatus(result.status);
    }

    order.providerStatus = result.status?.toUpperCase() || order.providerStatus;
    order.lastCheckedAt  = new Date();

    if (Array.isArray(result.sms) && result.sms.length > 0) {
      order.sms = mapSms(result.sms);
      order.markModified('sms');
    }

    if (
      order.status === 'PENDING' &&
      order.expiresAt &&
      Date.now() >= new Date(order.expiresAt).getTime() &&
      order.sms.length === 0
    ) {
      order.status = 'TIMEOUT';
    }

    await order.save();

    const terminalStates = ['TIMEOUT', 'CANCELED', 'BANNED'];

    if (terminalStates.includes(order.status) && order.sms.length === 0) {
      await refundOrder(
        order,
        `Auto-refund — expired number (${order.product}, ${order.country})`
      );
    }

    return res.status(200).json({
      orderId:   order.orderId,
      phone:     order.phone,
      status:    order.status,
      sms:       order.sms,
      expiresAt: order.expiresAt,
    });

  } catch (error) {
    console.error('[checkSms]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// CANCEL NUMBER ORDER
// ============================================================
const cancelNumberOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await VirtualOrder.findOne({
      orderId: Number(orderId),
      user:    req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status !== 'PENDING') {
      return res.status(400).json({ message: 'Cannot cancel — order is no longer pending' });
    }

    const liveOrder = await checkOrder(Number(orderId));
    const liveStatus = normalize5simStatus(liveOrder.status);

    if (liveStatus) {
      order.status = liveStatus;
    }

    if (Array.isArray(liveOrder.sms) && liveOrder.sms.length > 0) {
      order.sms = mapSms(liveOrder.sms);
      order.markModified('sms');
    }

    if (order.status === 'RECEIVED' || order.sms.length > 0) {
      await order.save();
      return res.status(400).json({ message: 'Cannot cancel — SMS has already been received' });
    }

    if (order.status === 'TIMEOUT') {
      await order.save();
      return res.status(400).json({ message: 'Cannot cancel — order has expired' });
    }

    await cancelOrder(Number(orderId));
    order.status = 'CANCELED';
    await order.save();

    await refundOrder(order, `Refund — cancelled number (${order.product})`);

    return res.status(200).json({
      message: 'Order cancelled and refunded',
      orderId: order.orderId,
    });

  } catch (error) {
    console.error('[cancelNumberOrder]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// FINISH NUMBER ORDER
// ============================================================
const finishNumberOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await VirtualOrder.findOne({
      orderId: Number(orderId),
      user:    req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status === 'FINISHED') {
      return res.status(400).json({ message: 'Order already finished' });
    }

    if (['CANCELED', 'TIMEOUT', 'BANNED'].includes(order.status)) {
      return res.status(400).json({ message: 'Cannot finish an expired order' });
    }

    await finishOrder(Number(orderId));
    order.status = 'FINISHED';
    await order.save();

    return res.status(200).json({
      message: 'Order finished',
      orderId: order.orderId,
    });

  } catch (error) {
    console.error('[finishNumberOrder]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// GET MY ORDERS
// ============================================================
const getMyOrders = async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const orders = await VirtualOrder
      .find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await VirtualOrder.countDocuments({ user: req.user._id });

    return res.status(200).json({
      orders,
      total,
      page,
      pages: Math.ceil(total / limit),
    });

  } catch (error) {
    console.error('[getMyOrders]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// GET SINGLE ORDER BY DATABASE ID
// ============================================================
const getOrderById = async (req, res) => {
  try {
    const order = await VirtualOrder.findOne({
      _id:  req.params.id,
      user: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    return res.status(200).json(order);

  } catch (error) {
    console.error('[getOrderById]', error);
    res.status(500).json({ message: error.message });
  }
};


// ============================================================
// EXPORT
// ============================================================
module.exports = {
  listProviders,
  getDisabledServices,       // ← NEW
  toggleServiceDisabled,     // ← NEW
  listCountries,
  listProducts,
  buyNumber,
  checkSms,
  cancelNumberOrder,
  finishNumberOrder,
  getMyOrders,
  getOrderById,
};
