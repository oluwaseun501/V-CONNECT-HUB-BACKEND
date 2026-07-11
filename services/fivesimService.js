const Provider = require('../models/Provider');

async function getActiveProvider() {
  const provider = await Provider.findOne({ isActive: true });
  if (!provider) throw new Error('No active provider set. Go to Admin → API Providers and set one as active.');
  return provider;
}

const getAvailableCountries = async () => {
  const { baseUrl } = await getActiveProvider();
  const res = await fetch(`${baseUrl}/guest/countries`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Failed to fetch countries from provider');
  return res.json();
};

const getAvailableProducts = async (country, operator = 'any') => {
  const { baseUrl, apiKey } = await getActiveProvider();

  const headers = { Accept: 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/guest/products/${country}/${operator}`, { headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch products from provider (${res.status}): ${body}`);
  }

  const raw = await res.json();

  // 5sim returns { service: { operatorName: { Price, Qty } } } for specific operators
  // but { service: { Price, Qty, Category } } for 'any' (flat, no operator level).
  // Normalise both into { service: { operatorName: { Price, Qty } } }.
  const normalised = {};
  for (const [service, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;

    // Detect flat format: has a numeric Price directly on the value
    const isFlat = typeof value.Price === 'number' || typeof value.price === 'number';

    if (isFlat) {
      // Wrap it so the caller's inner loop works uniformly
      normalised[service] = { [operator]: value };
    } else {
      normalised[service] = value;
    }
  }

  return normalised;
};

const purchaseNumber = async (country, operator, product) => {
  const { baseUrl, apiKey } = await getActiveProvider();
  const res = await fetch(`${baseUrl}/user/buy/activation/${country}/${operator}/${product}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Provider error (${res.status}): ${err || 'no details'}`);
  }
  return res.json();
};

const checkOrder = async (orderId) => {
  const { baseUrl, apiKey } = await getActiveProvider();
  const res = await fetch(`${baseUrl}/user/check/${orderId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to check order');
  return res.json();
};

const cancelOrder = async (orderId) => {
  const { baseUrl, apiKey } = await getActiveProvider();
  const res = await fetch(`${baseUrl}/user/cancel/${orderId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to cancel order');
  return res.json();
};

const finishOrder = async (orderId) => {
  const { baseUrl, apiKey } = await getActiveProvider();
  const res = await fetch(`${baseUrl}/user/finish/${orderId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to finish order');
  return res.json();
};

module.exports = { getAvailableCountries, getAvailableProducts, purchaseNumber, checkOrder, cancelOrder, finishOrder };