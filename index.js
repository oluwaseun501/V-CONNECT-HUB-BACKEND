const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { startOrderCron } = require('./utils/orderCron');

const authRoutes           = require('./routes/authRoutes');
const walletRoutes         = require('./routes/walletRoutes');
const transactionRoutes    = require('./routes/transactionRoutes');
const adminRoutes          = require('./routes/adminRoutes');
const virtualNumberRoutes  = require('./routes/virtualNumberRoutes');
const providerRoutes       = require('./routes/providerRoutes');
const helmet               = require('helmet');
const rateLimit            = require('express-rate-limit');
const smmProviderRoutes    = require('./routes/smmProviderRoutes');
const boostingRoutes       = require('./routes/boostingRoutes');
const { startAutoRefundJob } = require('./services/autoRefundJob');


// Connect DB and start background jobs
connectDB();
startOrderCron();
startAutoRefundJob();

const app = express();

app.use(cors({ origin: '*' }));
app.use(helmet());

// Higher limit for SMS polling — frontend checks every 10s per active order
app.use('/api/numbers/check', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { message: 'Too many requests, please try again later' }
}));

// Global rate limiter
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { message: 'Too many requests, please try again later' }
}));

app.use('/api/wallet/webhook/paystack', express.raw({ type: 'application/json' }));
app.use('/api/wallet/webhook/korapay', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/admin/smm-providers', smmProviderRoutes);
app.use('/boost', boostingRoutes);

app.use('/api/users', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/numbers', virtualNumberRoutes);
app.use('/api/admin/providers', providerRoutes);

app.get('/api/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('VirtualNums backend is running'));
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
