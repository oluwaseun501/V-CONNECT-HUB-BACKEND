const User = require('../models/User');
const bcrypt = require('bcryptjs');

const pinMiddleware = async (req, res, next) => {
    try {
        const { transactionPin } = req.body;

        if (!transactionPin) {
            return res.status(400).json({ message: 'Transaction PIN is required' });
        }

        const user = await User.findById(req.user._id);

        if (!user.transactionPin) {
            return res.status(400).json({ message: 'Please set a transaction PIN before making purchases' });
        }

        const isMatch = await bcrypt.compare(transactionPin, user.transactionPin);
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect transaction PIN' });
        }

        next();
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { pinMiddleware };
