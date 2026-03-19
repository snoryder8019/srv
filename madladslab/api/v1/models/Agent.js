import mongoose from "mongoose";
import { track as trackDb } from '../../../lib/dbMonitor.js';

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
      enum: ['assistant', 'researcher', 'vibecoder', 'forwardChat'],
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
      },
      backgroundRunning: {
        type: Boolean,
        default: false
      }
    },
    bgTickHistory: {
      type: [{
        timestamp: { type: Date, default: Date.now },
        title: String,
        summary: String,
        nextFocus: String,
        idle: { type: Boolean, default: false }
      }],
      default: []
    },
    bgProductivity: {
      score: { type: Number, default: 50 },        // 0-100
      consecutiveIdle: { type: Number, default: 0 },
      totalTicks: { type: Number, default: 0 },
      activeTicks: { type: Number, default: 0 }
    },
    tuning: {
      systemPromptHistory: [{
        prompt: String,
        timestamp: {
          type: Date,
          default: Date.now
        }
      }]
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
      bgFindings: {
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
    // forwardChat — unified external site deployment discipline
    forwardChat: {
      // Per-site assignments: which sites this agent serves + mode per site
      sites: [{
        siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ForwardChatSite' },
        chatMode: {
          type: String,
          enum: ['passive', 'active', 'agent'],
          default: 'active'
        },
        enabled: { type: Boolean, default: true }
      }],
      // BIH platform deployment (mirrors bihBot but under forwardChat discipline)
      bihEnabled: { type: Boolean, default: false },
      sessionLimit: { type: Number, default: 50 },
      rateLimitPerHour: { type: Number, default: 60 },
      // Consumer chatbot guardrails — third permission column
      guardrails: {
        enabled: { type: Boolean, default: false },
        allowedTopics: { type: [String], default: [] },
        blockedKeywords: { type: [String], default: [] },
        maxResponseLength: { type: Number, default: 0 },  // 0 = unlimited
        profanityFilter: { type: Boolean, default: false },
        systemPromptLock: { type: Boolean, default: true },
        offTopicResponse: { type: String, default: '' },  // custom canned reply
        rateLimit: {
          messagesPerSession: { type: Number, default: 0 },
          messagesPerHour: { type: Number, default: 0 }
        }
      }
    },
    // Support agent relationships — service bonds (not hierarchy)
    supportAgents: [{
      agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' },
      role: {
        type: String,
        enum: [
          'prompt-cleaner', 'kb-curator', 'reviewer', 'background-support',
          'summarizer', 'fact-checker', 'tone-adjuster', 'context-injector',
          'quality-gate', 'escalation-handler', 'data-validator', 'memory-manager',
          'task-planner', 'output-formatter', 'content-filter', 'custom'
        ],
        default: 'custom'
      },
      label: { type: String, default: '' },  // optional human label
      enabled: { type: Boolean, default: true }
    }],
    // If this agent IS a support agent, which agent does it serve?
    supportsAgent: {
      agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
      role: { type: String, default: '' }
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
    project: {
      type: String,
      default: ''
    },
    category: {
      type: String,
      enum: ['business', 'personal', 'education', 'research', 'creative', 'ops', 'security', 'other'],
      default: 'other'
    },
    workingDir: {
      type: String,
      default: ''
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
  this.memory.bgFindings = '';
  this.memory.stats.totalTokens = 0;
  this.memory.stats.contextUsagePercent = 0;
  this.bgTickHistory = [];
  this.bgProductivity = { score: 50, consecutiveIdle: 0, totalTicks: 0, activeTicks: 0 };
  return this.save();
};

// Method to update tuning parameters
agentSchema.methods.updateTuning = function(systemPrompt) {
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

  return this.save();
};

// Method to enable MCP tools
agentSchema.methods.enableMcpTools = function(tools) {
  this.mcpConfig.enabledTools = tools;
  return this.save();
};

// ── DB Monitor hooks ──────────────────────────────────────────────────────────
agentSchema.post('save', function(doc) {
  trackDb('write', 'agents', doc._id?.toString());
});
agentSchema.post('findOne', function(doc) {
  if (doc) trackDb('read', 'agents', doc._id?.toString());
});
agentSchema.post('find', function(docs) {
  if (docs?.length) trackDb('read', 'agents', null, `${docs.length} docs`);
});
agentSchema.post('findOneAndUpdate', function(doc) {
  if (doc) trackDb('write', 'agents', doc._id?.toString());
});
agentSchema.post('updateOne', function() {
  trackDb('write', 'agents');
});
agentSchema.post('updateMany', function() {
  trackDb('write', 'agents');
});

const Agent = mongoose.model("Agent", agentSchema);

export default Agent;
