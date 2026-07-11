const mongoose = require('mongoose');

const siteConfigSchema = new mongoose.Schema({
    maintenanceMode:    { type: Boolean, default: false },
    maintenanceMessage: { type: String,  default: 'We are currently down for maintenance. Please check back soon.' },
    usdToNgn:           { type: Number,  default: 1600 },
}, { timestamps: true });

module.exports = mongoose.model('SiteConfig', siteConfigSchema);