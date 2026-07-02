const axios = require('axios');

const KORAPAY_BASE = 'https://api.korapay.com/merchant/api/v1';

const getHeaders = () => ({
    Authorization: `Bearer ${process.env.KORAPAY_SECRET_KEY}`,
    'Content-Type': 'application/json'
});

const initializeKorapayTransaction = async ({ email, amount, reference, callbackUrl }) => {
    const res = await axios.post(`${KORAPAY_BASE}/charges/initialize`, {
        amount,
        currency: 'NGN',
        reference,
        customer: { email },
        redirect_url: callbackUrl,
        channels: ['card', 'bank_transfer']
    }, { headers: getHeaders() });

    const data = res.data?.data;
    if (!data?.checkout_url) throw new Error('Failed to initialize Korapay transaction');
    return { checkoutUrl: data.checkout_url, reference: data.reference };
};

const verifyKorapayTransaction = async (reference) => {
    const res = await axios.get(`${KORAPAY_BASE}/charges/${reference}`, { headers: getHeaders() });
    const data = res.data?.data;
    if (!data) throw new Error('Failed to verify Korapay transaction');
    return {
        status: data.status,          // 'success' | 'failed' | 'pending'
        amount: data.amount,
        email: data.customer?.email,
        reference: data.reference
    };
};

module.exports = { initializeKorapayTransaction, verifyKorapayTransaction };