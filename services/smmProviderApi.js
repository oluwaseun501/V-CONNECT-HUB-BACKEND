const axios = require('axios');

const PROVIDER_TIMEOUT_MS = 30 * 1000;

function providerRequest(provider, values) {
    const form = new URLSearchParams();

    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== null) {
            form.append(key, String(value));
        }
    }

    return axios.post(provider.apiUrl, form, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: PROVIDER_TIMEOUT_MS,
        validateStatus: () => true,
    });
}

function getProviderError(data) {
    if (!data) return 'Provider rejected the request';
    if (typeof data === 'string') return data;
    return data.error || data.message || 'Provider rejected the request';
}

function isProviderUnavailable(response) {
    return !response || response.status >= 500;
}

function hasProviderOrder(data) {
    return data?.order !== undefined &&
        data?.order !== null &&
        String(data.order).trim() !== '';
}

function normalizeProviderStatus(status) {
    const value = String(status || '').trim().toLowerCase();

    if (value === 'in progress' || value === 'in_progress') return 'processing';
    if (value === 'completed' || value === 'complete' || value === 'finished') return 'completed';
    if (value === 'canceled' || value === 'cancelled') return 'cancelled';
    if (value === 'partial') return 'partial';
    if (value === 'fail' || value === 'failed' || value === 'error') return 'failed';
    if (value === 'pending') return 'pending';

    return value;
}

function isSuccessfulCancellation(data, providerOrderId) {
    const items = Array.isArray(data) ? data : [data];
    const item = items.find((entry) =>
        String(entry?.order ?? providerOrderId) === String(providerOrderId)
    ) || items[0];

    if (!item) {
        return { accepted: false, message: 'Provider returned no cancellation result' };
    }

    const result = item.cancel;
    if (result === true || result === 1 || String(result) === '1') {
        return { accepted: true, message: 'Cancellation accepted by provider' };
    }

    return {
        accepted: false,
        message: getProviderError(item.cancel || item),
    };
}

async function getProviderBalance(provider) {
    const response = await providerRequest(provider, {
        key: provider.apiKey,
        action: 'balance',
    });

    if (isProviderUnavailable(response)) {
        const error = new Error('Provider balance endpoint is unavailable');
        error.code = 'PROVIDER_UNAVAILABLE';
        throw error;
    }

    const balance = Number(response.data?.balance);
    if (response.data?.error || !Number.isFinite(balance)) {
        const error = new Error(getProviderError(response.data));
        error.code = 'PROVIDER_REJECTED';
        throw error;
    }

    return {
        balance,
        currency: response.data?.currency || 'USD',
    };
}

async function cancelProviderOrder(provider, providerOrderId) {
    const response = await providerRequest(provider, {
        key: provider.apiKey,
        action: 'cancel',
        orders: providerOrderId,
    });

    if (isProviderUnavailable(response)) {
        const error = new Error('Provider cancellation endpoint is unavailable');
        error.code = 'PROVIDER_UNAVAILABLE';
        throw error;
    }

    return isSuccessfulCancellation(response.data, providerOrderId);
}

module.exports = {
    providerRequest,
    getProviderError,
    isProviderUnavailable,
    hasProviderOrder,
    normalizeProviderStatus,
    getProviderBalance,
    cancelProviderOrder,
};