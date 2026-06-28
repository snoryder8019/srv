const mongoose = require('mongoose');

const VerificationRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser', required: true },

  // Mailing address
  streetAddress: { type: String, required: true },
  city: { type: String, required: true, enum: ['Greeley', 'Evans', 'Eaton'] },
  state: { type: String, default: 'CO' },
  zip: { type: String, required: true },

  // Postcard code (set by admin when mailed)
  code: { type: String },
  codeExpiresAt: { type: Date },

  // Payment
  paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
  paymentId: { type: String },   // Stripe payment intent / checkout session ID
  amountPaid: { type: Number },  // in cents (250)

  // Request lifecycle
  status: {
    type: String,
    enum: ['pending_payment', 'paid', 'mailed', 'verified', 'expired', 'rejected'],
    default: 'pending_payment'
  },

  // Timestamps
  submittedAt: { type: Date, default: Date.now },
  paidAt: { type: Date },
  mailedAt: { type: Date },
  verifiedAt: { type: Date }
}, { collection: 'grv_verifications' });

module.exports = mongoose.model('GrvVerification', VerificationRequestSchema);
