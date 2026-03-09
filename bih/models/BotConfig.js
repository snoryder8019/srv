const mongoose = require('mongoose');

const botConfigSchema = new mongoose.Schema({
  trigger: { type: String, required: true, unique: true }, // e.g. 'nova' → @nova in chat
  agentId: { type: String, required: true },               // madladslab agent ObjectId
  agentName: { type: String, required: true },             // cached for display
  displayName: { type: String, required: true },           // shown as chat username
  avatar: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  rateMs: { type: Number, default: 5000 }                  // min ms between replies per user
}, { timestamps: true });

module.exports = mongoose.model('BotConfig', botConfigSchema);
