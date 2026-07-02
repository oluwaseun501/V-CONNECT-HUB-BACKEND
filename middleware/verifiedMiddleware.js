const verifiedMiddleware = (req, res, next) => {
    if (!req.user.isEmailVerified) {
        return res.status(403).json({ 
            message: 'Please verify your email address before making transactions' 
        });
    }
    next();
};

module.exports = { verifiedMiddleware };
