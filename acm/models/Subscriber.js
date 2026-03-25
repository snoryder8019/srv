const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true },
  firstName:    String,
  lastName:     String,
  source:       { type: String, enum: ['website', 'qr', 'admin', 'import'], default: 'website' },
  restaurant:   { type: String, enum: ['all', 'nook', 'heyday', 'graffiti'], default: 'all' },
  tags:         [String],
  isSubscribed: { type: Boolean, default: true },
  unsubscribedAt: Date,
  createdAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('Subscriber', subscriberSchema);
