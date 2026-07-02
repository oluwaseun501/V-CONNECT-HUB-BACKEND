const FIVESIM_BASE = 'https://5sim.net/v1';

const getHeaders = () => ({
    Authorization: `Bearer ${process.env.FIVESIM_API_KEY}`,
    Accept: 'application/json'
});

const getAvailableCountries = async () => {
    const res = await fetch(`${FIVESIM_BASE}/guest/countries`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Failed to fetch countries from 5sim');
    return res.json();
};

const getAvailableProducts = async (country, operator = 'any') => {
    const res = await fetch(`${FIVESIM_BASE}/guest/products/${country}/${operator}`, {
        headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error('Failed to fetch products from 5sim');
    return res.json();
};

const purchaseNumber = async (country, operator, product) => {
    const res = await fetch(`${FIVESIM_BASE}/user/buy/activation/${country}/${operator}/${product}`, {
        method: 'GET',
        headers: getHeaders()
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`5sim error (${res.status}): ${err || 'no details'}`);
    }
    return res.json();
};

const checkOrder = async (orderId) => {
    const res = await fetch(`${FIVESIM_BASE}/user/check/${orderId}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to check order from 5sim');
    return res.json();
};

const cancelOrder = async (orderId) => {
    const res = await fetch(`${FIVESIM_BASE}/user/cancel/${orderId}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to cancel order');
    return res.json();
};

const finishOrder = async (orderId) => {
    const res = await fetch(`${FIVESIM_BASE}/user/finish/${orderId}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to finish order');
    return res.json();
};

module.exports = { getAvailableCountries, getAvailableProducts, purchaseNumber, checkOrder, cancelOrder, finishOrder };
