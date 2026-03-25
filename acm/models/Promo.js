const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
  name:               { type: String, required: true },
  description:        String,
  type:               { type: String, enum: ['discount', 'freebie', 'event', 'invite'], required: true },
  restaurant:         { type: String, enum: ['all', 'nook', 'heyday', 'graffiti'], required: true },
  code:               { type: String, unique: true, required: true },
  qrData:             String,
  discountValue:      Number,
  discountType:       { type: String, enum: ['percent', 'fixed'] },
  maxRedemptions:     { type: Number, default: 0 },
  currentRedemptions: { type: Number, default: 0 },
  validFrom:          { type: Date, default: Date.now },
  validUntil:         Date,
  isActive:           { type: Boolean, default: true },
  source:             { type: String, enum: ['newsletter', 'in-store', 'social', 'event'], default: 'newsletter' },
  createdBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt:          { type: Date, default: Date.now }
});

module.exports = mongoose.model('Promo', promoSchema);
