const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  subject:      { type: String, required: true },
  htmlContent:  { type: String, required: true },
  textContent:  String,
  restaurant:   { type: String, enum: ['all', 'nook', 'heyday', 'graffiti'], default: 'all' },
  targetTags:   [String],
  status:       { type: String, enum: ['draft', 'scheduled', 'sending', 'sent', 'failed'], default: 'draft' },
  scheduledAt:  Date,
  sentAt:       Date,
  stats: {
    sent:         { type: Number, default: 0 },
    delivered:    { type: Number, default: 0 },
    opened:       { type: Number, default: 0 },
    clicked:      { type: Number, default: 0 },
    bounced:      { type: Number, default: 0 },
    unsubscribed: { type: Number, default: 0 }
  },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('Campaign', campaignSchema);
