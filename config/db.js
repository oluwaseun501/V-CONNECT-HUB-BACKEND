const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 30000,
        });
        console.log('It is connected successfully');
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        setTimeout(connectDB, 5000); // retry after 5 seconds
    }
};

module.exports = connectDB;