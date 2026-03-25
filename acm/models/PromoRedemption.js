const mongoose = require('mongoose');

const redemptionSchema = new mongoose.Schema({
  promo:           { type: mongoose.Schema.Types.ObjectId, ref: 'Promo', required: true },
  user:            { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subscriberEmail: String,
  restaurant:      { type: String, required: true },
  scannedAt:       { type: Date, default: Date.now },
  scannedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status:          { type: String, enum: ['scanned', 'redeemed', 'expired', 'invalid'], default: 'scanned' },
  notes:           String
});

module.exports = mongoose.model('PromoRedemption', redemptionSchema);
