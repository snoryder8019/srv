const mongoose = require('mongoose');

const agentTaskSchema = new mongoose.Schema({
  type:        { type: String, enum: ['chat', 'analysis', 'report', 'campaign_draft', 'promo_suggest', 'content_gen'], required: true },
  prompt:      { type: String, required: true },
  response:    String,
  status:      { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
  context:     { type: mongoose.Schema.Types.Mixed },
  metadata: {
    model:    String,
    tokens:   Number,
    duration: Number
  },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt:   { type: Date, default: Date.now },
  completedAt: Date
});

module.exports = mongoose.model('AgentTask', agentTaskSchema);
