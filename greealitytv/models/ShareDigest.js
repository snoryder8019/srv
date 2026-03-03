const mongoose = require('mongoose');

const ShareDigestSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  platform: { type: String, enum: ['reddit', 'instagram', 'facebook', 'other'], required: true },
  description: { type: String, trim: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser', required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'grv_shares' });

module.exports = mongoose.model('GrvShare', ShareDigestSchema);
