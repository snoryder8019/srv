const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  displayName: { type: String, required: true },
  avatar: { type: String },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

chatMessageSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
