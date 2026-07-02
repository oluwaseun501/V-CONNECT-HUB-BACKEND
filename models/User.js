const mongoose = require('mongoose');

const userSchema = mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, default: null },
    googleId: { type: String, default: null },
    avatar: { type: String, default: null },
    balance: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: null },
    transactionPin: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
