const VirtualOrder = require('../models/VirtualOrder');
const Provider = require('../models/Provider');
const PriceOverride = require('../models/PriceOverride');
const SiteConfig = require('../models/SiteConfig');
const User = require('../models/User');

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
  checkOrder,
  cancelOrder,
  finishOrder,
} = require('../services/fivesimService');


// ============================================================
// CONSTANTS
// ============================================================

// Every purchased number gets a 15-minute window
const ORDER_EXPIRY_MS =
  15 * 60 * 1000;


// ============================================================
// GET AVAILABLE COUNTRIES
// ============================================================
const listCountries = async (
  req,
  res
) => {
  try {
    const countries =
      await getAvailableCountries();

    res.status(200).json(
      countries
    );
  } catch (error) {
    console.error(
      '[listCountries]',
      error
    );

    res.status(500).json({
      message:
        error.message,
    });
  }
};


// ============================================================
// GET AVAILABLE PRODUCTS / SERVICES
// ============================================================
const listProducts = async (
  req,
  res
) => {
  try {
    const {
      country,
      operator = 'virtual',
    } = req.params;

    const provider =
      await Provider.findOne({
        isActive: true,
      });

    const markupPercent =
      provider?.markupPercent ?? 0;

    const siteConfig =
      await SiteConfig.findOne();

    const usdToNgn =
      siteConfig?.usdToNgn ?? 1600;

    const overrides =
      await PriceOverride.find({
        country:
          country.toLowerCase(),
      });

    const overrideMap = {};

    overrides.forEach(
      (override) => {
        overrideMap[
          override.service.toLowerCase()
        ] = override.price;
      }
    );

    const products =
      await getAvailableProducts(
        country,
        operator
      );

    const normalized = {};

    for (const [
      service,
      operators,
    ] of Object.entries(products)) {
      if (
        !operators ||
        typeof operators !== 'object'
      ) {
        continue;
      }

      normalized[service] = {};

      for (const [
        op,
        data,
      ] of Object.entries(
        operators
      )) {
        const rawPrice =
          data?.Price ??
          data?.price ??
          data?.cost ??
          0;

        const overridePrice =
          overrideMap[
            service.toLowerCase()
          ];

        let finalPrice;

        if (
          overridePrice != null
        ) {
          finalPrice =
            overridePrice;
        } else {
          finalPrice =
            parseFloat(
              (
                Number(rawPrice) *
                Number(usdToNgn) *
                (
                  1 +
                  Number(
                    markupPercent
                  ) / 100
                )
              ).toFixed(2)
            );
        }

        normalized[service][op] = {
          ...data,
          Price: finalPrice,
        };
      }
    }

    res.status(200).json(
      normalized
    );

  } catch (error) {
    console.error(
      '[listProducts]',
      error
    );

    res.status(500).json({
      message:
        error.message,
    });
  }
};


// ============================================================
// BUY VIRTUAL NUMBER
// ============================================================
const buyNumber = async (
  req,
  res
) => {
  let orderData = null;
  let walletDebited = false;

  try {
    const {
      country,
      operator = 'virtual',
      product,
    } = req.body;

    // --------------------------------------------------------
    // VALIDATE REQUEST
    // --------------------------------------------------------
    if (
      !country ||
      !product
    ) {
      return res.status(400).json({
        message:
          'country and product are required',
      });
    }

    // --------------------------------------------------------
    // PROVIDER SETTINGS
    // --------------------------------------------------------
    const provider =
      await Provider.findOne({
        isActive: true,
      });

    const markupPercent =
      provider?.markupPercent ?? 0;

    // --------------------------------------------------------
    // EXCHANGE RATE
    // --------------------------------------------------------
    const siteConfig =
      await SiteConfig.findOne();

    const usdToNgn =
      siteConfig?.usdToNgn ?? 1600;

    // --------------------------------------------------------
    // PRICE OVERRIDE
    // --------------------------------------------------------
    const override =
      await PriceOverride.findOne({
        service:
          product.toLowerCase(),

        country:
          country.toLowerCase(),
      });

    // --------------------------------------------------------
    // GET USER
    // --------------------------------------------------------
    const user =
      await User.findById(
        req.user._id
      ).select('balance');

    if (!user) {
      return res.status(404).json({
        message:
          'User account not found',
      });
    }

    // --------------------------------------------------------
    // ESTIMATE PRICE
    // --------------------------------------------------------
    let estimatedPrice = 0;

    if (override) {
      estimatedPrice =
        Number(
          override.price
        );
    } else {
      const products =
        await getAvailableProducts(
          country,
          operator
        );

      const serviceData =
        products?.[product];

      let rawPrice = 0;

      if (
        serviceData &&
        typeof serviceData === 'object'
      ) {
        const operatorData =
          serviceData?.[operator];

        rawPrice =
          operatorData?.Price ??
          operatorData?.price ??
          operatorData?.cost ??
          0;
      }

      estimatedPrice =
        parseFloat(
          (
            Number(rawPrice) *
            Number(usdToNgn) *
            (
              1 +
              Number(
                markupPercent
              ) / 100
            )
          ).toFixed(2)
        );
    }

    // --------------------------------------------------------
    // EARLY WALLET CHECK
    // --------------------------------------------------------
    if (
      estimatedPrice > 0 &&
      Number(user.balance) <
        estimatedPrice
    ) {
      return res.status(400).json({
        message:
          'Insufficient wallet balance',
      });
    }

    // --------------------------------------------------------
    // PURCHASE FROM PROVIDER
    // --------------------------------------------------------
    orderData =
      await purchaseNumber(
        country,
        operator,
        product
      );

    // --------------------------------------------------------
    // PROVIDER COST
    // --------------------------------------------------------
    const basePrice =
      orderData.price ??
      orderData.Price ??
      0;

    if (
      !basePrice ||
      Number(basePrice) <= 0
    ) {
      try {
        if (orderData?.id) {
          await cancelOrder(
            orderData.id
          );
        }
      } catch (cancelError) {
        console.error(
          '[buyNumber] Failed to cancel invalid order:',
          cancelError.message
        );
      }

      return res.status(400).json({
        message:
          'Unable to determine provider price',
      });
    }

    // --------------------------------------------------------
    // PROVIDER COST IN NGN
    // --------------------------------------------------------
    const providerCostNgn =
      parseFloat(
        (
          Number(basePrice) *
          Number(usdToNgn)
        ).toFixed(2)
      );

    // --------------------------------------------------------
    // FINAL CUSTOMER PRICE
    // --------------------------------------------------------
    let finalPrice;

    if (override) {
      finalPrice =
        Number(
          override.price
        );
    } else {
      finalPrice =
        parseFloat(
          (
            Number(basePrice) *
            Number(usdToNgn) *
            (
              1 +
              Number(
                markupPercent
              ) / 100
            )
          ).toFixed(2)
        );
    }

    // --------------------------------------------------------
    // PREVENT LOSS
    // --------------------------------------------------------
    if (
      finalPrice <
      providerCostNgn
    ) {
      try {
        await cancelOrder(
          orderData.id
        );
      } catch (cancelError) {
        console.error(
          '[buyNumber] Failed to cancel loss-making order:',
          cancelError.message
        );
      }

      return res.status(400).json({
        message:
          'This service is temporarily unavailable. Please contact support.',
      });
    }

    // --------------------------------------------------------
    // FINAL BALANCE CHECK
    // --------------------------------------------------------
    const latestUser =
      await User.findById(
        req.user._id
      ).select('balance');

    if (!latestUser) {
      try {
        await cancelOrder(
          orderData.id
        );
      } catch (_) {}

      return res.status(404).json({
        message:
          'User account not found',
      });
    }

    if (
      Number(latestUser.balance) <
      finalPrice
    ) {
      try {
        await cancelOrder(
          orderData.id
        );
      } catch (cancelError) {
        console.error(
          '[buyNumber] Failed to cancel order:',
          cancelError.message
        );
      }

      return res.status(400).json({
        message:
          'Insufficient wallet balance',
      });
    }

    // --------------------------------------------------------
    // DEBIT WALLET
    // --------------------------------------------------------
    try {
      await debitWallet(
        req.user._id,
        finalPrice,
        `Virtual number — ${product} (${country})`
      );

      walletDebited = true;

    } catch (debitError) {
      console.error(
        '[buyNumber] Wallet debit failed:',
        debitError.message
      );

      try {
        await cancelOrder(
          orderData.id
        );
      } catch (cancelError) {
        console.error(
          '[buyNumber] Failed to cancel provider order:',
          cancelError.message
        );
      }

      return res.status(400).json({
        message:
          'Unable to complete purchase. Your wallet was not charged.',
      });
    }

    // --------------------------------------------------------
    // CREATE 15-MINUTE EXPIRY
    // --------------------------------------------------------
    const purchasedAt =
      new Date();

    const expiresAt =
      new Date(
        purchasedAt.getTime() +
          ORDER_EXPIRY_MS
      );

    // --------------------------------------------------------
    // SAVE ORDER
    // --------------------------------------------------------
    try {
      const order =
        await VirtualOrder.create({
          user:
            req.user._id,

          orderId:
            orderData.id,

          phone:
            orderData.phone,

          country,

          operator:
            orderData.operator ||
            operator,

          product,

          price:
            finalPrice,

          status:
            orderData.status
              ?.toUpperCase() ||
            'PENDING',

          expiresAt,

          sms: [],
        });

      return res.status(201).json({
        message:
          'Number purchased successfully',

        order,
      });

    } catch (databaseError) {
      console.error(
        '[buyNumber] Failed to save order:',
        databaseError.message
      );

      // Cancel provider order
      try {
        await cancelOrder(
          orderData.id
        );
      } catch (cancelError) {
        console.error(
          '[buyNumber] Failed to cancel provider order after DB failure:',
          cancelError.message
        );
      }

      // Refund wallet
      if (walletDebited) {
        try {
await creditWallet(
    req.user._id,
    finalPrice,
    `Refund — failed virtual number order (${product})`
);
          console.log(
            `[buyNumber] User refunded ₦${finalPrice}`
          );

        } catch (refundError) {
          console.error(
            '[buyNumber] CRITICAL: Refund failed:',
            refundError.message
          );
        }
      }

      return res.status(500).json({
        message:
          'Purchase could not be completed. Your wallet has been refunded.',
      });
    }

  } catch (error) {
    console.error(
      '[buyNumber] Unexpected error:',
      error
    );

    // If provider order exists and wallet
    // has NOT been debited, cancel it.
    if (
      orderData?.id &&
      !walletDebited
    ) {
      try {
        await cancelOrder(
          orderData.id
        );
      } catch (cancelError) {
        console.error(
          '[buyNumber] Failed to cancel provider order:',
          cancelError.message
        );
      }
    }

    return res.status(500).json({
      message:
        error.message ||
        'Something went wrong while purchasing the number',
    });
  }
};


// ============================================================
// CHECK SMS / ORDER STATUS
// ============================================================
const checkSms = async (
  req,
  res
) => {
  try {
    const {
      orderId,
    } = req.params;

    const order =
      await VirtualOrder.findOne({
        orderId:
          Number(orderId),

        user:
          req.user._id,
      });

    if (!order) {
      return res.status(404).json({
        message:
          'Order not found',
      });
    }

    // --------------------------------------------------------
    // IF ALREADY IN A TERMINAL STATE
    // --------------------------------------------------------
    if (
      order.status ===
        'TIMEOUT' ||
      order.status ===
        'CANCELED' ||
      order.status ===
        'FINISHED' ||
      order.status ===
        'BANNED'
    ) {
      return res.status(200).json({
        orderId:
          order.orderId,

        phone:
          order.phone,

        status:
          order.status,

        sms:
          order.sms,

        expiresAt:
          order.expiresAt,
      });
    }

    // --------------------------------------------------------
    // CHECK PROVIDER
    // --------------------------------------------------------
    const result =
      await checkOrder(
        Number(orderId)
      );
      

    // --------------------------------------------------------
    // UPDATE STATUS
    // --------------------------------------------------------
    if (result.status) {
      order.status =
        result.status.toUpperCase();
    }

    order.providerStatus =
    result.status?.toUpperCase() || order.providerStatus;

order.lastCheckedAt = new Date();

    // --------------------------------------------------------
    // FIX: update SMS and mark modified so Mongoose
    // always writes the change to the database.
    // Without markModified, Mongoose can silently skip
    // saving a reassigned subdocument array.
    // --------------------------------------------------------
   if (Array.isArray(result.sms) && result.sms.length > 0) {

    order.sms = mapSms(result.sms);

    order.markModified("sms");
}

    // --------------------------------------------------------
    // OUR 15-MINUTE EXPIRY FALLBACK
    // --------------------------------------------------------
    // Only mark TIMEOUT if:
    // 1. The provider still says PENDING
    // 2. The 15-minute window has passed
    // 3. No SMS has arrived
    // --------------------------------------------------------
    if (
      order.status ===
        'PENDING' &&
      order.expiresAt &&
      Date.now() >=
        new Date(
          order.expiresAt
        ).getTime() &&
      order.sms.length === 0
    ) {
      order.status =
        'TIMEOUT';
    }

    await order.save();

    // --------------------------------------------------------
    // AUTO-REFUND: issue immediately when the order ends
    // with no SMS — whether 5sim cancelled early OR our own
    // 15-min timeout fired.  Covers the gap where the job
    // only scans PENDING orders older than 15 min but misses
    // orders that 5sim terminates before that window is up.
    // --------------------------------------------------------
    const terminalStates = [
    "TIMEOUT",
    "CANCELED",
    "BANNED"
];

if (
    terminalStates.includes(order.status) &&
    order.sms.length === 0
) {

    await refundOrder(
        order,
        `Auto-refund — expired number (${order.product}, ${order.country})`
    );
}
    return res.status(200).json({
      orderId:
        order.orderId,

      phone:
        order.phone,

      status:
        order.status,

      sms:
        order.sms,

      // Include expiresAt so the frontend
      // can always display the correct timer
      expiresAt:
        order.expiresAt,
    });

  } catch (error) {
    console.error(
      '[checkSms]',
      error
    );

    res.status(500).json({
      message:
        error.message,
    });
  }
};


// ============================================================
// CANCEL NUMBER ORDER
// ============================================================
const cancelNumberOrder = async (
  req,
  res
) => {
  try {
    const {
      orderId,
    } = req.params;

    const order =
      await VirtualOrder.findOne({
        orderId:
          Number(orderId),

        user:
          req.user._id,
      });

    if (!order) {
      return res.status(404).json({
        message:
          'Order not found',
      });
    }

    // Only pending orders can be cancelled
    if (
      order.status !==
      'PENDING'
    ) {
      return res.status(400).json({
        message:
          'Cannot cancel — order is no longer pending',
      });
    }

    const liveOrder =
      await checkOrder(
        Number(orderId)
      );

    const liveStatus =
      liveOrder.status
        ?.toUpperCase();

    if (liveStatus) {
      order.status =
        liveStatus;
    }

if (Array.isArray(liveOrder.sms) && liveOrder.sms.length > 0) {
    order.sms = mapSms(liveOrder.sms);
    order.markModified("sms");
}
    // Provider already received SMS
    if (
      order.status ===
        'RECEIVED' ||
      order.sms.length > 0
    ) {
      await order.save();

      return res.status(400).json({
        message:
          'Cannot cancel — SMS has already been received',
      });
    }

    // Already expired
    if (
      order.status ===
      'TIMEOUT'
    ) {
      await order.save();

      return res.status(400).json({
        message:
          'Cannot cancel — order has expired',
      });
    }

    // Cancel provider order
    await cancelOrder(
      Number(orderId)
    );

    order.status =
      'CANCELED';

    await order.save();

    // Refund customer
    await refundOrder(
    order,
    `Refund — cancelled number (${order.product})`
);
    return res.status(200).json({
      message:
        'Order cancelled and refunded',

      orderId:
        order.orderId,
    });

  } catch (error) {
    console.error(
      '[cancelNumberOrder]',
      error
    );

    res.status(500).json({
      message:
        error.message,
    });
  }
};


// ============================================================
// FINISH NUMBER ORDER
// ============================================================
const finishNumberOrder = async (
  req,
  res
) => {
  try {
    const {
      orderId,
    } = req.params;

    const order =
      await VirtualOrder.findOne({
        orderId:
          Number(orderId),

        user:
          req.user._id,
      });

    if (!order) {
      return res.status(404).json({
        message:
          'Order not found',
      });
    }

    if (
    order.status === "FINISHED"
) {
    return res.status(400).json({
        message: "Order already finished"
    });
}

if (
    order.status === "CANCELED" ||
    order.status === "TIMEOUT" ||
    order.status === "BANNED"
) {
    return res.status(400).json({
        message: "Cannot finish an expired order"
    });
}

    await finishOrder(
      Number(orderId)
    );

    order.status =
      'FINISHED';

    await order.save();

    return res.status(200).json({
      message:
        'Order finished',

      orderId:
        order.orderId,
    });

  } catch (error) {
    console.error(
      '[finishNumberOrder]',
      error
    );

    res.status(500).json({
      message:
        error.message,
    });
  }
};


// ============================================================
// GET MY ORDERS
// ============================================================
const getMyOrders = async (
  req,
  res
) => {
  try {
    const page =
      parseInt(
        req.query.page
      ) || 1;

    const limit =
      parseInt(
        req.query.limit
      ) || 20;

    const skip =
      (page - 1) *
      limit;

    const orders =
      await VirtualOrder
        .find({
          user:
            req.user._id,
        })
        .sort({
          createdAt:
            -1,
        })
        .skip(skip)
        .limit(limit);

    const total =
      await VirtualOrder.countDocuments({
        user:
          req.user._id,
      });

    return res.status(200).json({
      orders,
      total,
      page,
      pages:
        Math.ceil(
          total /
            limit
        ),
    });

  } catch (error) {
    console.error(
      '[getMyOrders]',
      error
    );

    res.status(500).json({
      message:
        error.message,
    });
  }
};


// ============================================================
// GET SINGLE ORDER BY DATABASE ID
// ============================================================
const getOrderById = async (
  req,
  res
) => {
  try {
    const order =
      await VirtualOrder.findOne({
        _id:
          req.params.id,

        user:
          req.user._id,
      });

    if (!order) {
      return res.status(404).json({
        message:
          'Order not found',
      });
    }

    return res.status(200).json(
      order
    );

  } catch (error) {
    console.error(
      '[getOrderById]',
      error
    );

    res.status(500).json({
      message:
        error.message,
    });
  }
};


// ============================================================
// EXPORT
// ============================================================
module.exports = {
  listCountries,
  listProducts,
  buyNumber,
  checkSms,
  cancelNumberOrder,
  finishNumberOrder,
  getMyOrders,
  getOrderById,
};
