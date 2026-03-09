import mongoose from "mongoose";

// Agent schema for storing spawned agents and their configurations
const agentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: ''
    },
    model: {
      type: String,
      required: true,
      default: 'qwen2.5:7b'
    },
    provider: {
      type: String,
      default: 'ollama',
      enum: ['ollama']
    },
    status: {
      type: String,
      enum: ['idle', 'running', 'stopped', 'error'],
      default: 'idle'
    },
    role: {
      type: String,
      enum: ['assistant', 'researcher', 'vibecoder'],
      default: 'assistant'
    },
    config: {
      contextWindow: {
        type: Number,
        default: 200000
      },
      maxTokens: {
        type: Number,
        default: 8192
      },
      temperature: {
        type: Number,
        default: 0.7,
        min: 0,
        max: 2
      },
      topP: {
        type: Number,
        default: 0.9,
        min: 0,
        max: 1
      },
      topK: {
        type: Number,
        default: 40,
        min: 1,
        max: 200
      },
      repeatPenalty: {
        type: Number,
        default: 1.1,
        min: 0.5,
        max: 2
      },
      systemPrompt: {
        type: String,
        default: 'You are a helpful AI assistant.'
      },
      backgroundPrompt: {
        type: String,
        default: ''
      },
      backgroundInterval: {
        type: Number,
        default: 2,
        min: 1,
        max: 1440
      }
    },
    tuning: {
      systemPromptHistory: [{
        prompt: String,
        timestamp: {
          type: Date,
          default: Date.now
        }
      }],
      adjustableParams: {
        creativity: {
          type: Number,
          default: 0.5,
          min: 0,
          max: 1
        },
        verbosity: {
          type: Number,
          default: 0.5,
          min: 0,
          max: 1
        },
        formality: {
          type: Number,
          default: 0.5,
          min: 0,
          max: 1
        }
      }
    },
    mcpConfig: {
      enabledTools: {
        type: [String],
        default: []
      },
      backgroundEnabledTools: {
        type: [String],
        default: []
      },
      endpoints: [{
        name: String,
        enabled: {
          type: Boolean,
          default: false
        },
        description: String
      }]
    },
    memory: {
      conversations: [{
        timestamp: {
          type: Date,
          default: Date.now
        },
        userMessage: String,
        agentResponse: String,
        tokenCount: {
          type: Number,
          default: 0
        }
      }],
      knowledgeBase: [{
        type: {
          type: String,
          enum: ['document', 'context', 'instruction'],
          default: 'context'
        },
        content: String,
        title: String,
        addedAt: {
          type: Date,
          default: Date.now
        }
      }],
      threadSummary: {
        type: String,
        default: ''
      },
      longTermMemory: {
        type: String,
        default: ''
      },
      stats: {
        totalTokens: {
          type: Number,
          default: 0
        },
        contextUsagePercent: {
          type: Number,
          default: 0
        }
      }
    },
    stats: {
      totalMessages: {
        type: Number,
        default: 0
      },
      totalTokens: {
        type: Number,
        default: 0
      },
      lastActive: {
        type: Date,
        default: null
      },
      uptime: {
        type: Number,
        default: 0
      }
    },
    bihBot: {
      enabled: { type: Boolean, default: false },
      trigger: { type: String, default: '' },
      displayName: { type: String, default: '' },
      avatar: { type: String, default: '' },
      rateMs: { type: Number, default: 8000 },  // min ms between responses
      allowedRoles: { type: [String], default: [] },  // empty = all roles allowed
      chatMode: {
        type: String,
        enum: ['passive', 'active', 'agent'],
        default: 'passive'
        // passive: stays silent by default, speaks when directly addressed
        // active:  responds readily; [SILENT] still allowed but not default
        // agent:   always responds to @-mentions, uses enabled MCP chat tools
      }
    },
    pepeChat: {
      enabled: { type: Boolean, default: false },
      sessionLimit: { type: Number, default: 50 },
      rateLimitPerHour: { type: Number, default: 60 },
      avatar: { type: String, default: '' }
    },
    tier: {
      type: String,
      enum: ['apex', 'executive', 'manager', 'worker'],
      default: 'worker'
    },
    parentAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Agent',
      default: null
    },
    capabilities: {
      type: [String],
      default: []
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    logs: [{
      timestamp: {
        type: Date,
        default: Date.now
      },
      level: {
        type: String,
        enum: ['info', 'warning', 'error'],
        default: 'info'
      },
      message: String
    }]
  },
  {
    timestamps: true,
    collection: 'agents'
  }
);

// Method to update stats
agentSchema.methods.updateStats = function(messageCount, tokenCount) {
  this.stats.totalMessages += messageCount || 0;
  this.stats.totalTokens += tokenCount || 0;
  this.stats.lastActive = new Date();
  return this.save();
};

// Method to add log entry
agentSchema.methods.addLog = function(level, message) {
  this.logs.push({
    timestamp: new Date(),
    level,
    message
  });
  // Keep only last 100 logs
  if (this.logs.length > 100) {
    this.logs = this.logs.slice(-100);
  }
  return this.save();
};

// Static method to get active agents
agentSchema.statics.getActiveAgents = function() {
  return this.find({ status: { $in: ['idle', 'running'] } })
    .populate('createdBy', 'displayName email')
    .sort({ updatedAt: -1 });
};

// Method to add conversation to memory
agentSchema.methods.addConversation = function(userMessage, agentResponse, tokenCount) {
  this.memory.conversations.push({
    timestamp: new Date(),
    userMessage,
    agentResponse,
    tokenCount: tokenCount || 0
  });

  // Keep only last 100 conversations
  if (this.memory.conversations.length > 100) {
    this.memory.conversations = this.memory.conversations.slice(-100);
  }

  // Update memory stats
  this.memory.stats.totalTokens += tokenCount || 0;
  this.memory.stats.contextUsagePercent = Math.min(
    100,
    (this.memory.stats.totalTokens / this.config.contextWindow) * 100
  );

  return this.save();
};

// Method to add knowledge base entry
agentSchema.methods.addKnowledge = function(title, content, type = 'context') {
  this.memory.knowledgeBase.push({
    type,
    title,
    content,
    addedAt: new Date()
  });
  return this.save();
};

// Method to clear memory
agentSchema.methods.clearMemory = function() {
  this.memory.conversations = [];
  this.memory.knowledgeBase = [];
  this.memory.threadSummary = '';
  this.memory.longTermMemory = '';
  this.memory.stats.totalTokens = 0;
  this.memory.stats.contextUsagePercent = 0;
  return this.save();
};

// Method to update tuning parameters
agentSchema.methods.updateTuning = function(systemPrompt, adjustableParams) {
  if (systemPrompt && systemPrompt !== this.config.systemPrompt) {
    // Save to history
    this.tuning.systemPromptHistory.push({
      prompt: this.config.systemPrompt,
      timestamp: new Date()
    });

    // Keep only last 10 versions
    if (this.tuning.systemPromptHistory.length > 10) {
      this.tuning.systemPromptHistory = this.tuning.systemPromptHistory.slice(-10);
    }

    this.config.systemPrompt = systemPrompt;
  }

  if (adjustableParams) {
    Object.assign(this.tuning.adjustableParams, adjustableParams);
  }

  return this.save();
};

// Method to enable MCP tools
agentSchema.methods.enableMcpTools = function(tools) {
  this.mcpConfig.enabledTools = tools;
  return this.save();
};

const Agent = mongoose.model("Agent", agentSchema);

export default Agent;
