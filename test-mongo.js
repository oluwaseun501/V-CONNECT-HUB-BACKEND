require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
console.log('Connecting to:', uri ? uri.split('@')[1]?.split('/')[0] : 'URI NOT FOUND');

mongoose.connect(uri)
  .then(() => { console.log('✅ Connected!'); process.exit(0); })
  .catch(err => { console.log('❌ Failed:', err.message); process.exit(1); });