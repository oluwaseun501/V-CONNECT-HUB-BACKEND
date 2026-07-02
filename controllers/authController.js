const User = require('../models/User');
const Transaction = require('../models/Transaction');
const bcrypt = require('bcryptjs');
const generateToken = require('../utils/generateToken');
const { sendWelcomeEmail, sendPasswordResetEmail, sendVerificationEmail } = require('../utils/sendEmail');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            emailVerificationToken: verificationToken
        });

const verifyURL = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
sendWelcomeEmail(user.name, user.email).catch((e) => console.error('Welcome email failed:', e.message));
sendVerificationEmail(user.name, user.email, verifyURL).catch((e) => console.error('Verify email failed:', e.message));


        res.status(201).json({
            _id: user.id,
            name: user.name,
            email: user.email,
            balance: user.balance,
            isAdmin: user.isAdmin,
            isEmailVerified: user.isEmailVerified,
            token: generateToken(user._id)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// Google Sign-In: frontend sends the credential (ID token) from Google's GSI button
const googleLogin = async (req, res) => {
    try {
        const { credential } = req.body;

        if (!credential) {
            return res.status(400).json({ message: 'Google credential is required' });
        }

        // Verify the ID token with Google
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        const { sub: googleId, email, name, picture } = payload;

        // Find by googleId first, then by email (link existing account)
        let user = await User.findOne({ googleId });

        if (!user) {
            user = await User.findOne({ email });

            if (user) {
                // Link Google to existing email/password account
                user.googleId = googleId;
                if (!user.avatar) user.avatar = picture;
                await user.save();
            } else {
                // New user — create account (no password, email auto-verified)
                user = await User.create({
                    name,
                    email,
                    googleId,
                    avatar: picture,
                    isEmailVerified: true
                });
                try { await sendWelcomeEmail(name, email); } catch (e) {}
            }
        }

        res.status(200).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            balance: user.balance,
            isAdmin: user.isAdmin,
            isEmailVerified: user.isEmailVerified,
            token: generateToken(user._id)
        });

    } catch (error) {
        res.status(401).json({ message: 'Google authentication failed: ' + error.message });
    }
};




const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        res.status(200).json({
            _id: user.id,
            name: user.name,
            email: user.email,
            balance: user.balance,
            isAdmin: user.isAdmin,
            token: generateToken(user._id)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.name = req.body.name || user.name;

        // Only update email if not already taken by another user
        if (req.body.email && req.body.email !== user.email) {
            const emailExists = await User.findOne({ email: req.body.email });
            if (emailExists) {
                return res.status(400).json({ message: 'Email already in use' });
            }
            user.email = req.body.email;
        }

        const updatedUser = await user.save();

        res.status(200).json({
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            balance: updatedUser.balance,
            isAdmin: updatedUser.isAdmin
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update password separately
const updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Please provide current and new password' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters' });
        }

        const user = await User.findById(req.user._id);

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.status(200).json({ message: 'Password updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get logged-in user's transactions
const getMyTransactions = async (req, res) => {
    try {
        const transactions = await Transaction
            .find({ user: req.user._id })
            .sort({ createdAt: -1 });

        res.status(200).json(transactions);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get wallet balance
const getWalletBalance = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('balance');
        res.status(200).json({ balance: user.balance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'No account found with that email' });
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        user.passwordResetExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
        await user.save();

        // Send email with reset link
        const resetURL = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        await sendPasswordResetEmail(user.name, user.email, resetURL);

        res.status(200).json({ message: 'Password reset link sent to your email' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        // Hash the token to compare with stored one
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Reset link is invalid or has expired' });
        }

        // Update password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        user.passwordResetToken = null;
        user.passwordResetExpires = null;
        await user.save();

        res.status(200).json({ message: 'Password reset successful. You can now log in.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const verifyEmail = async (req, res) => {
    try {
        const { token } = req.body;

        const user = await User.findOne({ emailVerificationToken: token });
        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired verification link' });
        }

        user.isEmailVerified = true;
        user.emailVerificationToken = null;
        await user.save();

        res.status(200).json({ message: 'Email verified successfully! You can now transact.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const resendVerificationEmail = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (user.isEmailVerified) {
            return res.status(400).json({ message: 'Email is already verified' });
        }

        const verificationToken = crypto.randomBytes(32).toString('hex');
        user.emailVerificationToken = verificationToken;
        await user.save();

        const verifyURL = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
        await sendVerificationEmail(user.name, user.email, verifyURL);

        res.status(200).json({ message: 'Verification email resent' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const setTransactionPin = async (req, res) => {
    try {
        const { pin } = req.body;

        if (!pin || pin.length !== 4 || isNaN(pin)) {
            return res.status(400).json({ message: 'PIN must be exactly 4 digits' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(pin, salt);

        await User.findByIdAndUpdate(req.user._id, { transactionPin: hashedPin });

        res.status(200).json({ message: 'Transaction PIN set successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const verifyTransactionPin = async (req, res) => {
    try {
        const { pin } = req.body;
        const user = await User.findById(req.user._id);

        if (!user.transactionPin) {
            return res.status(400).json({ message: 'You have not set a transaction PIN yet' });
        }

        const isMatch = await bcrypt.compare(pin, user.transactionPin);
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect PIN' });
        }

        res.status(200).json({ message: 'PIN verified' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    registerUser, loginUser, googleLogin, getMe, updateProfile, updatePassword,
    getMyTransactions, getWalletBalance,
    forgotPassword, resetPassword,
    verifyEmail, resendVerificationEmail,
    setTransactionPin, verifyTransactionPin
};
