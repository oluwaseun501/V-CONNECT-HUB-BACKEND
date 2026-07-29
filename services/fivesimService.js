const Provider = require('../models/Provider');


// ============================================================
// GET ACTIVE PROVIDER
// ============================================================
async function getActiveProvider() {
  const provider = await Provider.findOne({
    isActive: true,
  });

  if (!provider) {
    throw new Error(
      'No active provider set. Go to Admin → API Providers and set one as active.'
    );
  }

  return provider;
}


// ============================================================
// GET AVAILABLE COUNTRIES
// ============================================================
const getAvailableCountries = async () => {
  const { baseUrl } = await getActiveProvider();

  const res = await fetch(
    `${baseUrl}/guest/countries`,
    {
      headers: {
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `Failed to fetch countries from provider (${res.status}): ${body}`
    );
  }

  return res.json();
};


// ============================================================
// GET AVAILABLE PRODUCTS / SERVICES
// ============================================================
const getAvailableProducts = async (
  country,
  operator = 'any'
) => {
  const {
    baseUrl,
    apiKey,
  } = await getActiveProvider();

  const headers = {
    Accept: 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(
    `${baseUrl}/guest/products/${country}/${operator}`,
    {
      headers,
    }
  );

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `Failed to fetch products from provider (${res.status}): ${body}`
    );
  }

  const raw = await res.json();

  /*
    5sim can return:

    {
      service: {
        operatorName: {
          Price,
          Qty
        }
      }
    }

    OR:

    {
      service: {
        Price,
        Qty,
        Category
      }
    }

    We normalize both formats.
  */

  const normalised = {};

  for (const [
    service,
    value,
  ] of Object.entries(raw)) {
    if (
      !value ||
      typeof value !== 'object'
    ) {
      continue;
    }

    const isFlat =
      typeof value.Price === 'number' ||
      typeof value.price === 'number';

    if (isFlat) {
      normalised[service] = {
        [operator]: value,
      };
    } else {
      normalised[service] = value;
    }
  }

  return normalised;
};


// ============================================================
// PURCHASE / RESERVE NUMBER
// ============================================================
const purchaseNumber = async (
  country,
  operator,
  product
) => {
  const {
    baseUrl,
    apiKey,
  } = await getActiveProvider();

  const res = await fetch(
    `${baseUrl}/user/buy/activation/${country}/${operator}/${product}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    }
  );

  const text = await res.text();

  // No numbers available
  if (
    text === 'no free phones' ||
    text.includes('no free phones')
  ) {
    throw new Error(
      'No numbers available for this selection. Please try a different country or service.'
    );
  }

  // Product out of stock
  if (
    text === 'not enough product' ||
    text.includes('not enough')
  ) {
    throw new Error(
      'This number type is out of stock. Please try another.'
    );
  }

  // Provider wallet has insufficient funds
  if (
    text === 'no money' ||
    text.includes('no money')
  ) {
    throw new Error(
      'Insufficient balance on the provider. Please contact support.'
    );
  }

  if (!res.ok) {
    throw new Error(
      `Provider error (${res.status}): ${
        text || 'no details'
      }`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Unexpected response from provider: ${text}`
    );
  }
};


// ============================================================
// CHECK ORDER / SMS
// ============================================================
const checkOrder = async (
  orderId
) => {
  const {
    baseUrl,
    apiKey,
  } = await getActiveProvider();

  const res = await fetch(
    `${baseUrl}/user/check/${orderId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `Failed to check order (${res.status}): ${body}`
    );
  }

  return res.json();
};


// ============================================================
// CANCEL ORDER
// ============================================================
const cancelOrder = async (
  orderId
) => {
  const {
    baseUrl,
    apiKey,
  } = await getActiveProvider();

  const res = await fetch(
    `${baseUrl}/user/cancel/${orderId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `Failed to cancel order (${res.status}): ${body}`
    );
  }

  return res.json();
};


// ============================================================
// FINISH ORDER
// ============================================================
const finishOrder = async (
  orderId
) => {
  const {
    baseUrl,
    apiKey,
  } = await getActiveProvider();

  const res = await fetch(
    `${baseUrl}/user/finish/${orderId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `Failed to finish order (${res.status}): ${body}`
    );
  }

  return res.json();
};


module.exports = {
  getAvailableCountries,
  getAvailableProducts,
  purchaseNumber,
  checkOrder,
  cancelOrder,
  finishOrder,
};