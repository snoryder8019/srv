import mongoose from "mongoose";

// Tracks all agent-generated outputs: middleware docs (TLDR, task lists),
// background findings, and file writes. One document per action.
const agentActionSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Agent',
      required: true,
      index: true
    },
    // type drives how the action is displayed/filtered
    type: {
      type: String,
      enum: ['tldr', 'task_list', 'finding', 'background', 'file_write', 'image'],
      required: true
    },
    title: {
      type: String,
      default: ''
    },
    content: {
      type: String,
      required: true
    },
    // Extra context: { tool, args } for tool actions; { filename } for file_write etc.
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    tokens: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['complete', 'error'],
      default: 'complete'
    }
  },
  {
    timestamps: true,
    collection: 'agent_actions'
  }
);

// Static: latest N actions across all agents (findings view)
agentActionSchema.statics.getFindings = function(limit = 100) {
  return this.find({})
    .populate('agentId', 'name role')
    .sort({ createdAt: -1 })
    .limit(limit);
};

const AgentAction = mongoose.model('AgentAction', agentActionSchema);

export default AgentAction;
