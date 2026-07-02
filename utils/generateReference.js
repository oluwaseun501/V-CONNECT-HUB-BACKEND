const crypto = require('crypto');

const generateReference = () => {
    return `VNP-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

module.exports = generateReference;
