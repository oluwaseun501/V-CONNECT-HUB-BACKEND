const axios = require('axios');
const Provider = require('../models/Provider');

const getActiveProvider = async () => {
    const provider = await Provider.findOne({ isActive: true });
    if (!provider) throw new Error('No active virtual number provider configured. Please add one in the admin dashboard.');
    return provider;
};

const providerRequest = async (method, path, data = null) => {
    const provider = await getActiveProvider();
    const url = `${provider.baseUrl}${path}`;

    const config = {
        method,
        url,
        headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            Accept: 'application/json'
        }
    };

    if (data) config.data = data;

    const response = await axios(config);
    return { data: response.data, provider };
};

module.exports = { getActiveProvider, providerRequest };
