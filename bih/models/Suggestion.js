const mongoose = require('mongoose');

const suggestionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  displayName: { type: String, required: true },
  text: { type: String, required: true },
  status: { type: String, enum: ['pending', 'reviewed', 'accepted', 'declined'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

suggestionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Suggestion', suggestionSchema);
