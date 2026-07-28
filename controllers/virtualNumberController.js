const VirtualOrder = require('../models/VirtualOrder');
const Provider = require('../models/Provider');
const PriceOverride = require('../models/PriceOverride');
const SiteConfig = require('../models/SiteConfig');
const User = require('../models/User');

const {
    debitWallet,
    creditWallet
} = require('../services/walletService');

const {
    getAvailableCountries,
    getAvailableProducts,
    purchaseNumber,
    checkOrder,
    cancelOrder,
    finishOrder
} = require('../services/fivesimService');


// ============================================================
// GET AVAILABLE COUNTRIES
// ============================================================
const listCountries = async (req, res) => {
    try {
        const countries = await getAvailableCountries();

        res.status(200).json(countries);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};


// ============================================================
// GET AVAILABLE PRODUCTS / SERVICES
// ============================================================
const listProducts = async (req, res) => {
    try {
        const {
            country,
            operator = 'virtual'
        } = req.params;

        // Get active provider
        const provider = await Provider.findOne({
            isActive: true
        });

        const markupPercent =
            provider?.markupPercent ?? 0;

        // Get exchange rate
        const siteConfig =
            await SiteConfig.findOne();

        const usdToNgn =
            siteConfig?.usdToNgn ?? 1600;

        // Get price overrides for country
        const overrides =
            await PriceOverride.find({
                country: country.toLowerCase()
            });

        // Create override map
        const overrideMap = {};

        overrides.forEach((override) => {
            overrideMap[
                override.service.toLowerCase()
            ] = override.price;
        });

        // Get products from 5sim
        const products =
            await getAvailableProducts(
                country,
                operator
            );

        const normalized = {};

        for (
            const [service, operators]
            of Object.entries(products)
        ) {
            if (
                !operators ||
                typeof operators !== 'object'
            ) {
                continue;
            }

            normalized[service] = {};

            for (
                const [op, data]
                of Object.entries(operators)
            ) {
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

                // Use price override if available
                if (
                    overridePrice != null
                ) {
                    finalPrice =
                        overridePrice;
                } else {
                    // Normal price
                    finalPrice =
                        parseFloat(
                            (
                                rawPrice *
                                usdToNgn *
                                (
                                    1 +
                                    markupPercent /
                                    100
                                )
                            ).toFixed(2)
                        );
                }

                normalized[service][op] = {
                    ...data,
                    Price: finalPrice
                };
            }
        }

        res.status(200).json(
            normalized
        );

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};


// ============================================================
// BUY VIRTUAL NUMBER
// ============================================================
const buyNumber = async (req, res) => {
    let orderData = null;
    let walletDebited = false;

    try {
        const {
            country,
            operator = 'virtual',
            product
        } = req.body;

        // ========================================================
        // VALIDATE REQUEST
        // ========================================================
        if (
            !country ||
            !product
        ) {
            return res.status(400).json({
                message:
                    'country and product are required'
            });
        }


        // ========================================================
        // GET PROVIDER SETTINGS
        // ========================================================
        const provider =
            await Provider.findOne({
                isActive: true
            });

        const markupPercent =
            provider?.markupPercent ?? 0;


        // ========================================================
        // GET EXCHANGE RATE
        // ========================================================
        const siteConfig =
            await SiteConfig.findOne();

        const usdToNgn =
            siteConfig?.usdToNgn ?? 1600;


        // ========================================================
        // GET PRICE OVERRIDE
        // ========================================================
        const override =
            await PriceOverride.findOne({
                service:
                    product.toLowerCase(),

                country:
                    country.toLowerCase()
            });


        // ========================================================
        // PRE-CHECK USER WALLET
        // ========================================================
        // We cannot know the exact 5sim price until we reserve
        // the number, so this is only an early balance check.
        //
        // We use the configured override if available.
        // Otherwise, we use the available product price from 5sim.
        //
        // This prevents obvious insufficient-balance purchases
        // before calling purchaseNumber().
        // ========================================================

        const user =
            await User.findById(
                req.user._id
            ).select('balance');

        if (!user) {
            return res.status(404).json({
                message:
                    'User account not found'
            });
        }


        // ========================================================
        // GET ESTIMATED PRODUCT PRICE
        // ========================================================
        let estimatedPrice = 0;

        if (override) {

            // If admin has manually set a price,
            // use that as the estimated customer price.
            estimatedPrice =
                Number(
                    override.price
                );

        } else {

            // Get available products from 5sim
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
                            Number(markupPercent) /
                            100
                        )
                    ).toFixed(2)
                );
        }


        // ========================================================
        // PRE-CHECK WALLET BALANCE
        // ========================================================
        if (
            estimatedPrice > 0 &&
            Number(user.balance) <
            estimatedPrice
        ) {
            return res.status(400).json({
                message:
                    'Insufficient wallet balance'
            });
        }


        // ========================================================
        // PURCHASE / RESERVE NUMBER FROM 5SIM
        // ========================================================
        orderData =
            await purchaseNumber(
                country,
                operator,
                product
            );


        // ========================================================
        // GET ACTUAL 5SIM PROVIDER PRICE
        // ========================================================
        const basePrice =
            orderData.price ??
            orderData.Price ??
            0;

        if (
            !basePrice ||
            Number(basePrice) <= 0
        ) {

            // If 5sim returned an invalid price,
            // cancel the reserved order.
            try {
                if (orderData?.id) {
                    await cancelOrder(
                        orderData.id
                    );
                }
            } catch (_) {}

            return res.status(400).json({
                message:
                    'Unable to determine provider price'
            });
        }


        // ========================================================
        // CALCULATE ACTUAL PROVIDER COST IN NGN
        // ========================================================
        const providerCostNgn =
            parseFloat(
                (
                    Number(basePrice) *
                    Number(usdToNgn)
                ).toFixed(2)
            );


        // ========================================================
        // CALCULATE FINAL CUSTOMER PRICE
        // ========================================================
        let finalPrice;

        if (override) {

            // Use admin price override
            finalPrice =
                Number(
                    override.price
                );

        } else {

            // Use provider cost + markup
            finalPrice =
                parseFloat(
                    (
                        Number(basePrice) *
                        Number(usdToNgn) *
                        (
                            1 +
                            Number(markupPercent) /
                            100
                        )
                    ).toFixed(2)
                );
        }


        // ========================================================
        // PREVENT LOSS-MAKING PURCHASE
        // ========================================================
        // Customer price cannot be below actual provider cost.
        // Markup can be reduced by price override,
        // but the platform must not sell below cost.
        // ========================================================
        const minimumPrice =
            providerCostNgn;

        if (
            finalPrice <
            minimumPrice
        ) {

            try {
                await cancelOrder(
                    orderData.id
                );
            } catch (_) {}

            console.warn(
                `[buyNumber] GUARD blocked: ` +
                `finalPrice ₦${finalPrice} < ` +
                `providerCost ₦${providerCostNgn} ` +
                `[${product}/${country}]`
            );

            return res.status(400).json({
                message:
                    'This service is temporarily unavailable. Please contact support.'
            });
        }


        // ========================================================
        // FINAL WALLET BALANCE CHECK
        // ========================================================
        // The actual price may differ from the estimated price,
        // so check the wallet again before debit.
        // ========================================================
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
                    'User account not found'
            });
        }


        if (
            Number(latestUser.balance) <
            finalPrice
        ) {

            // Cancel reserved 5sim number
            try {
                await cancelOrder(
                    orderData.id
                );
            } catch (cancelError) {
                console.error(
                    '[buyNumber] Failed to cancel 5sim order:',
                    cancelError.message
                );
            }

            return res.status(400).json({
                message:
                    'Insufficient wallet balance'
            });
        }


        // ========================================================
        // DEBIT WALLET
        // ========================================================
        try {

            await debitWallet(
                req.user._id,
                finalPrice,
                `Virtual number — ${product} (${country})`
            );

            walletDebited = true;

        } catch (debitError) {

            // ====================================================
            // WALLET DEBIT FAILED
            // ====================================================
            // Automatically cancel the 5sim order so the user
            // does not lose the reserved number.
            // ====================================================

            console.error(
                '[buyNumber] Wallet debit failed:',
                debitError.message
            );

            try {

                await cancelOrder(
                    orderData.id
                );

                console.log(
                    `[buyNumber] 5sim order ${orderData.id} ` +
                    `cancelled after wallet debit failure`
                );

            } catch (cancelError) {

                console.error(
                    '[buyNumber] CRITICAL: Failed to cancel 5sim order:',
                    cancelError.message
                );
            }

            return res.status(400).json({
                message:
                    'Unable to complete purchase. Your wallet was not charged.'
            });
        }


        // ========================================================
        // SAVE ORDER TO DATABASE
        // ========================================================
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
                        orderData.operator,

                    product,

                    price:
                        finalPrice,

                    status:
                        orderData.status
                            ?.toUpperCase() ||
                        'PENDING',

                    expiresAt:
                        orderData.expires
                            ? new Date(
                                orderData.expires
                            )
                            : undefined
                });


            // ====================================================
            // SUCCESS
            // ====================================================
            return res.status(201).json({
                message:
                    'Number purchased successfully',

                order
            });

        } catch (databaseError) {

            // ====================================================
            // DATABASE SAVE FAILED AFTER WALLET DEBIT
            // ====================================================
            // The user has already been charged, so refund them.
            // Also cancel the 5sim order.
            // ====================================================

            console.error(
                '[buyNumber] Failed to save order:',
                databaseError.message
            );


            // Cancel 5sim order
            try {

                await cancelOrder(
                    orderData.id
                );

            } catch (cancelError) {

                console.error(
                    '[buyNumber] Failed to cancel 5sim order after DB failure:',
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

                    // VERY IMPORTANT:
                    // If refund fails, this should be logged
                    // and handled manually.
                    console.error(
                        '[buyNumber] CRITICAL: Refund failed:',
                        refundError.message
                    );
                }
            }


            return res.status(500).json({
                message:
                    'Purchase could not be completed. Your wallet has been refunded.'
            });
        }


    } catch (error) {

        // ========================================================
        // UNEXPECTED ERROR
        // ========================================================
        console.error(
            '[buyNumber] Unexpected error:',
            error
        );


        // If a 5sim order was reserved but something failed,
        // attempt to cancel it.
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
                    '[buyNumber] Failed to cancel 5sim order:',
                    cancelError.message
                );
            }
        }


        res.status(500).json({
            message:
                error.message ||
                'Something went wrong while purchasing the number'
        });
    }
};


// ============================================================
// CHECK SMS / ORDER STATUS
// ============================================================
const checkSms = async (req, res) => {
    try {

        const {
            orderId
        } = req.params;

        const order =
            await VirtualOrder.findOne({
                orderId:
                    Number(orderId),

                user:
                    req.user._id
            });

        if (!order) {
            return res.status(404).json({
                message:
                    'Order not found'
            });
        }

        const result =
            await checkOrder(
                Number(orderId)
            );

        order.status =
            result.status?.toUpperCase() ||
            order.status;

        if (
            result.sms?.length
        ) {
            order.sms =
                result.sms;
        }

        await order.save();

        res.status(200).json({
            orderId:
                order.orderId,

            phone:
                order.phone,

            status:
                order.status,

            sms:
                order.sms
        });

    } catch (error) {

        res.status(500).json({
            message:
                error.message
        });
    }
};


// ============================================================
// CANCEL NUMBER ORDER
// ============================================================
const cancelNumberOrder = async (req, res) => {
    try {

        const {
            orderId
        } = req.params;

        const order =
            await VirtualOrder.findOne({
                orderId:
                    Number(orderId),

                user:
                    req.user._id
            });

        if (!order) {
            return res.status(404).json({
                message:
                    'Order not found'
            });
        }

        const liveOrder =
            await checkOrder(
                Number(orderId)
            );

        const liveStatus =
            liveOrder.status?.toUpperCase();

        order.status =
            liveStatus ||
            order.status;

        if (
            liveOrder.sms?.length
        ) {
            order.sms =
                liveOrder.sms;
        }

        await order.save();

        if (
            order.status !==
            'PENDING'
        ) {
            return res.status(400).json({
                message:
                    'Cannot cancel — SMS already received or order no longer pending'
            });
        }

        await cancelOrder(
            Number(orderId)
        );

        order.status =
            'CANCELED';

        await order.save();

        await creditWallet(
            req.user._id,
            order.price,
            `Refund — cancelled number (${order.product})`
        );

        res.status(200).json({
            message:
                'Order cancelled and refunded',

            orderId:
                order.orderId
        });

    } catch (error) {

        res.status(500).json({
            message:
                error.message
        });
    }
};


// ============================================================
// FINISH NUMBER ORDER
// ============================================================
const finishNumberOrder = async (req, res) => {
    try {

        const {
            orderId
        } = req.params;

        const order =
            await VirtualOrder.findOne({
                orderId:
                    Number(orderId),

                user:
                    req.user._id
            });

        if (!order) {
            return res.status(404).json({
                message:
                    'Order not found'
            });
        }

        await finishOrder(
            Number(orderId)
        );

        order.status =
            'FINISHED';

        await order.save();

        res.status(200).json({
            message:
                'Order finished',

            orderId:
                order.orderId
        });

    } catch (error) {

        res.status(500).json({
            message:
                error.message
        });
    }
};


// ============================================================
// GET MY ORDERS
// ============================================================
const getMyOrders = async (req, res) => {
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
            (
                page - 1
            ) * limit;

        const orders =
            await VirtualOrder
                .find({
                    user:
                        req.user._id
                })
                .sort({
                    createdAt:
                        -1
                })
                .skip(skip)
                .limit(limit);

        const total =
            await VirtualOrder.countDocuments({
                user:
                    req.user._id
            });

        res.status(200).json({
            orders,
            total,
            page,
            pages:
                Math.ceil(
                    total /
                    limit
                )
        });

    } catch (error) {

        res.status(500).json({
            message:
                error.message
        });
    }
};


// ============================================================
// GET SINGLE ORDER BY ID
// ============================================================
const getOrderById = async (req, res) => {
    try {

        const order =
            await VirtualOrder.findOne({
                _id:
                    req.params.id,

                user:
                    req.user._id
            });

        if (!order) {
            return res.status(404).json({
                message:
                    'Order not found'
            });
        }

        res.status(200).json(
            order
        );

    } catch (error) {

        res.status(500).json({
            message:
                error.message
        });
    }
};


// ============================================================
// EXPORT CONTROLLERS
// ============================================================
module.exports = {
    listCountries,
    listProducts,
    buyNumber,
    checkSms,
    cancelNumberOrder,
    finishNumberOrder,
    getMyOrders,
    getOrderById
};