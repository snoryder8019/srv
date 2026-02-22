const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  callId:      { type: String, required: true, unique: true, index: true },
  name:        { type: String, required: true, trim: true, maxlength: 60 },
  creatorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  creatorName: { type: String, required: true },
  callType:    { type: String, default: 'video', enum: ['voice', 'video'] },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
});

// Auto-delete 6 hours after last update (crash recovery)
channelSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 21600 });

module.exports = mongoose.model('Channel', channelSchema);
