const crypto = require('crypto');
const axios = require('axios');

const PAYSTACK_BASE = 'https://api.paystack.co';

const getHeaders = () => ({
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
});

const initializePaystackTransaction = async ({ email, amount, reference, callbackUrl }) => {
    const { data } = await axios.post(`${PAYSTACK_BASE}/transaction/initialize`, {
        email,
        amount: amount * 100,
        reference,
        callback_url: callbackUrl
    }, { headers: getHeaders() });

    if (!data.status) throw new Error(data.message || 'Paystack init failed');
    return { authorizationUrl: data.data.authorization_url, reference: data.data.reference };
};

const verifyPaystackTransaction = async (reference) => {
    const { data } = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
        headers: getHeaders()
    });

    if (!data.status) throw new Error(data.message || 'Paystack verify failed');
    return {
        status: data.data.status,
        amount: data.data.amount / 100,
        email: data.data.customer.email
    };
};

const verifyPaystackWebhook = (signature, rawBody) => {
    const secret = process.env.PAYSTACK_SECRET_KEY || '';
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    return hash === signature;
};

module.exports = { initializePaystackTransaction, verifyPaystackTransaction, verifyPaystackWebhook };