const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    registerUser,
    loginUser,
    googleLogin,
    getMe,
    updateProfile,
    updatePassword,
    getMyTransactions,
    getWalletBalance,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerificationEmail,
    setTransactionPin,
    verifyTransactionPin
} = require('../controllers/authController');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/google', googleLogin);
router.get('/test-email', async (req, res) => {
    const { testEmailConnection } = require('../utils/sendEmail');
    const result = await testEmailConnection();
    res.json(result);
});
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-email', verifyEmail);

router.use(protect);
router.get('/me', getMe);
router.put('/profile', updateProfile);
router.put('/password', updatePassword);
router.get('/transactions', getMyTransactions);
router.get('/balance', getWalletBalance);
router.post('/resend-verification', resendVerificationEmail);
router.post('/set-pin', setTransactionPin);
router.post('/verify-pin', verifyTransactionPin);

module.exports = router;
