const mongoose = require('mongoose');

const NEIGHBORHOODS = require('./Local').NEIGHBORHOODS;

const GIG_CATEGORIES = [
  'Tech', 'Food & Restaurant', 'Retail', 'Construction',
  'Healthcare', 'Education', 'Automotive', 'Creative',
  'Events', 'Lawn & Home', 'General Labor', 'Other'
];

const gigSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  type:        { type: String, enum: ['gig', 'job'], required: true },
  category:    { type: String, required: true },
  company:     { type: String, trim: true },
  description: { type: String, required: true, trim: true },
  pay:         { type: String, trim: true },
  contact:     { type: String, required: true, trim: true },
  neighborhood:{ type: String, default: '' },
  isRemote:    { type: Boolean, default: false },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser', required: true },
  status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  expiresAt:   { type: Date },
  createdAt:   { type: Date, default: Date.now }
});

gigSchema.statics.CATEGORIES   = GIG_CATEGORIES;
gigSchema.statics.NEIGHBORHOODS = NEIGHBORHOODS;

module.exports = mongoose.model('GrvGig', gigSchema, 'grv_gigs');
