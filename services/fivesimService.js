const Provider = require('../models/Provider');

// ============================================================
// URL BUILDER — laomao uses query params, 5sim uses REST paths
// ============================================================
const laomaoUrl = (baseUrl, apiKey, action, extra = {}) => {
  const params = new URLSearchParams({ api_key: apiKey, action, ...extra });
  return `${baseUrl}?${params.toString()}`;
};

const is5sim    = (url = '') => url.includes('5sim');
const isLaomao  = (url = '') => url.includes('laomao');

// ============================================================
// PER-PROVIDER CACHES (country & service name maps)
// ============================================================
const _cache = {
  countryNameToId:  {},
  serviceCodeToName:{},
};

function countryCache(baseUrl)  { return (_cache.countryNameToId[baseUrl]  ||= {}); }
function serviceCache(baseUrl)  { return (_cache.serviceCodeToName[baseUrl] ||= {}); }


// ============================================================
// GET ALL PROVIDERS — sorted: active first, then inactive
// ============================================================
async function getAllProviders() {
  const providers = await Provider.find({}).sort({ isActive: -1 });
  if (!providers.length) throw new Error('No providers configured. Go to Admin → API Providers.');
  return providers;
}

async function getActiveProvider() {
  const provider = await Provider.findOne({ isActive: true });
  if (!provider) throw new Error('No active provider set. Go to Admin → API Providers.');
  return provider;
}


// ============================================================
// LAOMAO — load country + service name maps into cache
// ============================================================
async function laomaoLoadCountries(baseUrl, apiKey) {
  const cache = countryCache(baseUrl);
  if (Object.keys(cache).length > 0) return cache;

  try {
    const res  = await fetch(laomaoUrl(baseUrl, apiKey, 'getCountries'));
    if (!res.ok) return cache;
    const raw  = await res.json();
    const items = Array.isArray(raw) ? raw : Object.values(raw);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const name = (item.eng || item.name || String(item.id || '')).toLowerCase().trim();
      if (name) cache[name] = item.id;
    }
  } catch (_) {}

  return cache;
}

async function laomaoLoadServices(baseUrl, apiKey) {
  const cache = serviceCache(baseUrl);
  if (Object.keys(cache).length > 0) return cache;

  try {
    const res  = await fetch(laomaoUrl(baseUrl, apiKey, 'getServicesList'));
    if (!res.ok) return cache;
    const data = await res.json();
    for (const svc of (data?.services || [])) {
      if (svc.code && svc.name) cache[svc.code.toLowerCase()] = svc.name.toLowerCase();
    }
  } catch (_) {}

  return cache;
}


// ============================================================
// LAOMAO — fetch countries in 5sim-compatible shape
// ============================================================
async function laomaoGetCountries(provider) {
  const { baseUrl, apiKey } = provider;
  const res = await fetch(laomaoUrl(baseUrl, apiKey, 'getCountries'));
  if (!res.ok) throw new Error(`Laomao countries error (${res.status})`);
  const raw   = await res.json();
  const items = Array.isArray(raw) ? raw : Object.values(raw);
  const result = {};
  const cache  = countryCache(baseUrl);
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const name = (item.eng || item.name || String(item.id || '')).toLowerCase().trim();
    if (!name) continue;
    result[name]  = { id: item.id, name: item.eng || name };
    cache[name]   = item.id;
  }
  return result;
}

async function laomaoGetProducts(provider, country, operator = 'any') {
  const { baseUrl, apiKey } = provider;
  const nameToId = await laomaoLoadCountries(baseUrl, apiKey);
  const countryId = nameToId[country.toLowerCase()] ?? country;
  const svcMap    = await laomaoLoadServices(baseUrl, apiKey);

  const res = await fetch(laomaoUrl(baseUrl, apiKey, 'getPrices', { country: countryId }));
  if (!res.ok) throw new Error(`Laomao prices error (${res.status})`);
  const raw = await res.json();

  const normalised = {};
  for (const countryData of Object.values(raw)) {
    if (!countryData || typeof countryData !== 'object') continue;
    for (const [code, info] of Object.entries(countryData)) {
      if (!info || typeof info !== 'object') continue;
      const name = svcMap[code.toLowerCase()] || code.toLowerCase();
      normalised[name] = {
        [operator]: { Price: parseFloat(info.cost) || 0, Qty: parseInt(info.count) || 0, _code: code },
      };
    }
  }
  return normalised;
}

async function laomaoGetNumber(provider, country, operator, product) {
  const { baseUrl, apiKey } = provider;
  const nameToId = await laomaoLoadCountries(baseUrl, apiKey);
  const svcMap   = await laomaoLoadServices(baseUrl, apiKey);

  const countryId   = nameToId[country.toLowerCase()] ?? country;
  const serviceCode = Object.entries(svcMap).find(([, n]) => n === product.toLowerCase())?.[0] || product;

  let cost = 0;
  try {
    const pr = await fetch(laomaoUrl(baseUrl, apiKey, 'getPrices', { service: serviceCode, country: countryId }));
    if (pr.ok) {
      const pj = await pr.json();
      for (const cd of Object.values(pj)) {
        if (cd?.[serviceCode]?.cost) { cost = parseFloat(cd[serviceCode].cost) || 0; break; }
      }
    }
  } catch (_) {}

  const res  = await fetch(laomaoUrl(baseUrl, apiKey, 'getNumber', { service: serviceCode, country: countryId, maxPrice: 9999 }));
  const text = await res.text();

  if (text.includes('NO_NUMBERS'))  throw new NoNumbersError('laomao');
  if (text.includes('NO_BALANCE'))  throw new Error('Insufficient balance on Laomao provider. Please contact support.');
  if (text.includes('BAD_SERVICE')) throw new NoNumbersError('laomao');
  if (text.includes('BAD_KEY'))     throw new Error('Invalid Laomao API key. Check Admin → API Providers.');
  if (!res.ok) throw new Error(`Laomao error (${res.status}): ${text}`);

  if (text.startsWith('ACCESS_NUMBER:')) {
    const parts = text.split(':');
    return { id: parseInt(parts[1], 10), phone: parts[2], product, country, operator: 'virtual', status: 'PENDING', price: cost, _provider: 'laomao' };
  }
  throw new Error(`Unexpected Laomao response: ${text}`);
}

async function laomaoGetStatus(provider, orderId) {
  const { baseUrl, apiKey } = provider;
  const res  = await fetch(laomaoUrl(baseUrl, apiKey, 'getStatus', { id: orderId }));
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(`Laomao status error (${res.status}): ${text}`);

  if (text === 'STATUS_WAIT_CODE') return { status: 'PENDING', sms: [] };
  if (text === 'STATUS_CANCEL')    return { status: 'CANCELED', sms: [] };
   if (text.startsWith('STATUS_OK:') || text.startsWith('STATUS_WAIT_RETRY:')) {
    const code = text.slice(text.indexOf(':') + 1).trim();
    return { status: 'RECEIVED', sms: [{ created_at: new Date().toISOString(), date: Math.floor(Date.now() / 1000), sender: '', text: code, code }] };
  }
  if (text.includes('NO_ACTIVATION')) throw new Error(`Activation not found: ${orderId}`);
  throw new Error(`Unexpected Laomao response: ${text}`);
}

async function laomaoSetStatus(provider, orderId, status) {
  const { baseUrl, apiKey } = provider;
  const res  = await fetch(laomaoUrl(baseUrl, apiKey, 'setStatus', { status, id: orderId }));
  const text = await res.text();
  if (!res.ok) throw new Error(`Laomao setStatus error (${res.status}): ${text}`);
  return { raw: text, success: text.includes('ACCESS') };
}


// ============================================================
// 5SIM — REST-based adapter
// ============================================================
function fivesimHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
}

async function fivesimGetCountries(provider) {
  const { baseUrl, apiKey } = provider;
  const res = await fetch(`${baseUrl}/guest/countries`, { headers: fivesimHeaders(apiKey) });
  if (!res.ok) throw new Error(`5sim countries error (${res.status})`);
  return res.json();
}

async function fivesimGetProducts(provider, country, operator = 'any') {
  const { baseUrl, apiKey } = provider;
  const res = await fetch(`${baseUrl}/guest/products/${country}/${operator}`, { headers: fivesimHeaders(apiKey) });
  if (!res.ok) throw new Error(`5sim products error (${res.status})`);
  const raw = await res.json();
  const normalised = {};
  for (const [service, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const isFlat = typeof value.Price === 'number' || typeof value.price === 'number';
    normalised[service] = isFlat ? { [operator]: value } : value;
  }
  return normalised;
}

async function fivesimGetNumber(provider, country, operator, product) {
  const { baseUrl, apiKey } = provider;
  const res  = await fetch(`${baseUrl}/user/buy/activation/${country}/${operator}/${product}`, { headers: fivesimHeaders(apiKey) });
  const text = await res.text();

  if (text.includes('no free phones') || text.includes('not enough')) throw new NoNumbersError('5sim');
  if (text.includes('no money')) throw new Error('Insufficient balance on 5sim provider. Please contact support.');
  if (!res.ok) throw new Error(`5sim error (${res.status}): ${text}`);

  try { return { ...JSON.parse(text), _provider: '5sim' }; }
  catch { throw new Error(`Unexpected 5sim response: ${text}`); }
}

async function fivesimGetStatus(provider, orderId) {
  const { baseUrl, apiKey } = provider;
  const res  = await fetch(`${baseUrl}/user/check/${orderId}`, { headers: fivesimHeaders(apiKey) });
  const text = await res.text();
  if (!res.ok) throw new Error(`5sim check error (${res.status}): ${text}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Unexpected 5sim response: ${text}`); }
}

async function fivesimCancel(provider, orderId) {
  const { baseUrl, apiKey } = provider;
  const res  = await fetch(`${baseUrl}/user/cancel/${orderId}`, { headers: fivesimHeaders(apiKey) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function fivesimFinish(provider, orderId) {
  const { baseUrl, apiKey } = provider;
  const res  = await fetch(`${baseUrl}/user/finish/${orderId}`, { headers: fivesimHeaders(apiKey) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}


// ============================================================
// NoNumbersError — signals "try next provider" in fallback
// ============================================================
class NoNumbersError extends Error {
  constructor(providerName) {
    super(`No numbers available on ${providerName}`);
    this.isNoNumbers = true;
  }
}


// ============================================================
// ROUTER — picks the right adapter based on baseUrl
// ============================================================
function adapterFor(provider) {
  if (isLaomao(provider.baseUrl)) return 'laomao';
  if (is5sim(provider.baseUrl))   return '5sim';
  return '5sim';
}


// ============================================================
// PUBLIC API
// ============================================================

// Countries — accepts an optional provider object.
const getAvailableCountries = async (provider) => {
  if (!provider) provider = await getActiveProvider();
  if (adapterFor(provider) === 'laomao') return laomaoGetCountries(provider);
  return fivesimGetCountries(provider);
};

// Products — same pattern: optional provider, falls back to active.
const getAvailableProducts = async (country, operator = 'any', provider) => {
  if (!provider) provider = await getActiveProvider();
  if (adapterFor(provider) === 'laomao') return laomaoGetProducts(provider, country, operator);
  return fivesimGetProducts(provider, country, operator);
};

// Buy from ALL active providers — tries in order, falls back on "no numbers"
const purchaseNumber = async (country, operator, product) => {
  const providers = await getAllProviders();
  let lastError;

  for (const provider of providers) {
    try {
      let result;
      if (adapterFor(provider) === 'laomao') {
        result = await laomaoGetNumber(provider, country, operator, product);
      } else {
        result = await fivesimGetNumber(provider, country, operator, product);
      }
      result._providerBaseUrl = provider.baseUrl; // ← track which provider fulfilled it
      return result;
    } catch (err) {
      if (err.isNoNumbers) {
        console.log(`[purchaseNumber] No numbers on ${provider.baseUrl} — trying next provider`);
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('No numbers available on any configured provider.');
};

// Buy from a SPECIFIC provider — used when the user explicitly chose one on the frontend.
// If the chosen provider has no numbers, throws immediately (no silent fallback)
// so the user can try the other provider themselves.
const purchaseNumberFromProvider = async (country, operator, product, providerId) => {
  const provider = await Provider.findById(providerId);

  if (!provider) {
    throw new Error('Selected provider not found. Please try again.');
  }
  if (!provider.isActive) {
    throw new Error('Selected provider is no longer active. Please choose another option.');
  }

  let result;
  if (adapterFor(provider) === 'laomao') {
    result = await laomaoGetNumber(provider, country, operator, product);
  } else {
    result = await fivesimGetNumber(provider, country, operator, product);
  }
  result._providerBaseUrl = provider.baseUrl; // ← track which provider fulfilled it
  return result;
};

// Check SMS — route to the provider that owns this order
const checkOrder = async (orderId, providerBaseUrl) => {
  let provider;
  if (providerBaseUrl) {
    provider = await Provider.findOne({ baseUrl: providerBaseUrl });
  }
  if (!provider) provider = await getActiveProvider();

  if (adapterFor(provider) === 'laomao') return laomaoGetStatus(provider, orderId);
  return fivesimGetStatus(provider, orderId);
};

// Cancel — same routing logic as checkOrder
const cancelOrder = async (orderId, providerBaseUrl) => {
  let provider;
  if (providerBaseUrl) provider = await Provider.findOne({ baseUrl: providerBaseUrl });
  if (!provider) provider = await getActiveProvider();

  if (adapterFor(provider) === 'laomao') return laomaoSetStatus(provider, orderId, 8);
  return fivesimCancel(provider, orderId);
};

// Finish — same routing logic
const finishOrder = async (orderId, providerBaseUrl) => {
  let provider;
  if (providerBaseUrl) provider = await Provider.findOne({ baseUrl: providerBaseUrl });
  if (!provider) provider = await getActiveProvider();

  if (adapterFor(provider) === 'laomao') return laomaoSetStatus(provider, orderId, 6);
  return fivesimFinish(provider, orderId);
};


module.exports = {
  getAvailableCountries,
  getAvailableProducts,
  purchaseNumber,
  purchaseNumberFromProvider,  
  checkOrder,
  cancelOrder,
  finishOrder,
};
