const mongoose = require('mongoose');

// Connection to madladslab DB — read/write agent config + memory
let madlabConn = null;
let AgentModel = null;

// Tool definitions for Ollama tool-calling format (agent chatMode only)
const BIH_TOOL_DEFS = {
  'web-search': {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and return a summary of results.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] }
    }
  },
  'execute': {
    type: 'function',
    function: {
      name: 'execute',
      description: 'Execute a shell command (restricted; working dir is /srv)',
      parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] }
    }
  },
  'read-file': {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file contents from the /srv directory',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path within /srv' } }, required: ['path'] }
    }
  },
  'list-directory': {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List directory contents (must be within /srv)',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  },
  'grep-search': {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search file contents with regex within /srv',
      parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, case_insensitive: { type: 'boolean' } }, required: ['pattern', 'path'] }
    }
  },
  'tmux-logs': {
    type: 'function',
    function: {
      name: 'tmux_logs',
      description: 'Capture recent output from a tmux session',
      parameters: { type: 'object', properties: { session: { type: 'string' }, lines: { type: 'number' } }, required: ['session'] }
    }
  },
  'tmux-sessions': {
    type: 'function',
    function: {
      name: 'tmux_sessions',
      description: 'List all known tmux sessions and their running status',
      parameters: { type: 'object', properties: {} }
    }
  },
  'log-tail': {
    type: 'function',
    function: {
      name: 'log_tail',
      description: 'Tail the last N lines of a log file from /srv or /var/log',
      parameters: { type: 'object', properties: { path: { type: 'string' }, lines: { type: 'number' } }, required: ['path'] }
    }
  },
  'mongo-find': {
    type: 'function',
    function: {
      name: 'mongo_find',
      description: 'Read-only MongoDB query (agents, users, threads, agent_actions)',
      parameters: { type: 'object', properties: { collection: { type: 'string' }, filter: { type: 'object' }, projection: { type: 'object' }, limit: { type: 'number' } }, required: ['collection'] }
    }
  },
  'http-request': {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'HTTP request to localhost or *.madladslab.com',
      parameters: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, body: { type: 'object' } }, required: ['url'] }
    }
  },
  'fetch-url': {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch and read the text content of any public web page.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full URL to fetch' }, max_chars: { type: 'number', description: 'Max characters to return (default 8000)' } }, required: ['url'] }
    }
  }
};

const agentSchema = new mongoose.Schema({
  name: String,
  description: { type: String, default: '' },
  model: String,
  status: { type: String, default: 'idle' },
  role: { type: String, default: 'assistant' },
  config: {
    systemPrompt: { type: String, default: 'You are a helpful AI assistant.' },
    temperature: { type: Number, default: 0.7 },
    contextWindow: { type: Number, default: 4096 },
    maxTokens: { type: Number, default: 8192 }
  },
  bihBot: {
    enabled: { type: Boolean, default: false },
    trigger: { type: String, default: '' },
    displayName: { type: String, default: '' },
    avatar: { type: String, default: '' },
    rateMs: { type: Number, default: 8000 },
    allowedRoles: { type: [String], default: [] },  // empty = all users
    chatMode: { type: String, default: 'passive' }  // passive | active | agent
  },
  capabilities: { type: [String], default: [] },
  mcpConfig: {
    enabledTools: { type: [String], default: [] }
  },
  memory: {
    conversations: [{
      timestamp: { type: Date, default: Date.now },
      userMessage: String,
      agentResponse: String,
      tokenCount: { type: Number, default: 0 }
    }],
    threadSummary: String,
    longTermMemory: String
  },
  stats: {
    totalMessages: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    lastActive: Date
  },
  createdBy: mongoose.Schema.Types.ObjectId
}, { collection: 'agents', timestamps: true });

function getMadlabConn() {
  if (madlabConn && madlabConn.readyState === 1) return madlabConn;
  const uri = `${process.env.DB_URL}/madLadsLab?retryWrites=true&w=majority`;
  madlabConn = mongoose.createConnection(uri);
  return madlabConn;
}

function getAgentModel() {
  if (AgentModel) return AgentModel;
  const conn = getMadlabConn();
  AgentModel = conn.model('MadlabAgent', agentSchema);
  return AgentModel;
}

// Get all agents deployed as bih bots
async function getActiveBots() {
  const Agent = getAgentModel();
  return Agent.find({ 'bihBot.enabled': true }).lean();
}

// List all agents from madladslab DB
async function listAgents() {
  const Agent = getAgentModel();
  return Agent.find({}, { name: 1, model: 1, status: 1, 'bihBot.enabled': 1, 'bihBot.displayName': 1, description: 1 })
    .sort({ name: 1 }).lean();
}

// Enable bihBot for an agent by name (case-insensitive)
async function activateAgent(name) {
  const Agent = getAgentModel();
  const agent = await Agent.findOneAndUpdate(
    { name: new RegExp(`^${name}$`, 'i') },
    { $set: { 'bihBot.enabled': true } },
    { new: true }
  ).lean();
  return agent;
}

// Disable bihBot for an agent by name (case-insensitive)
async function deactivateAgent(name) {
  const Agent = getAgentModel();
  const agent = await Agent.findOneAndUpdate(
    { name: new RegExp(`^${name}$`, 'i') },
    { $set: { 'bihBot.enabled': false } },
    { new: true }
  ).lean();
  return agent;
}

// Create a new agent in madladslab DB
async function createAgent(name, model, systemPrompt, createdBy) {
  const Agent = getAgentModel();
  const displayName = name;
  const agent = await Agent.create({
    name,
    model: model || 'qwen2.5:7b',
    config: {
      systemPrompt: systemPrompt || `You are ${displayName}, a helpful AI assistant.`,
      temperature: 0.7,
      contextWindow: 4096,
      maxTokens: 8192
    },
    bihBot: {
      enabled: false,
      displayName,
      trigger: name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      rateMs: 8000
    },
    createdBy
  });
  return agent.toObject();
}

// Grant a capability/role to an agent by name
async function grantAgentPerm(name, perm) {
  const Agent = getAgentModel();
  return Agent.findOneAndUpdate(
    { name: new RegExp(`^${name}$`, 'i') },
    { $addToSet: { capabilities: perm } },
    { new: true }
  ).lean();
}

// Revoke a capability/role from an agent by name
async function revokeAgentPerm(name, perm) {
  const Agent = getAgentModel();
  return Agent.findOneAndUpdate(
    { name: new RegExp(`^${name}$`, 'i') },
    { $pull: { capabilities: perm } },
    { new: true }
  ).lean();
}

// Restrict an agent to users with a specific role (bih, admin, etc.)
async function setAgentAllowedRoles(name, roles) {
  const Agent = getAgentModel();
  return Agent.findOneAndUpdate(
    { name: new RegExp(`^${name}$`, 'i') },
    { $set: { 'bihBot.allowedRoles': roles } },
    { new: true }
  ).lean();
}

// Persist a bih conversation exchange to the agent's madladslab memory (fire-and-forget)
async function saveBihMemory(agentId, userMessage, botReply) {
  try {
    const Agent = getAgentModel();
    await Agent.findByIdAndUpdate(agentId, {
      $push: {
        'memory.conversations': {
          $each: [{ userMessage: `[bih] ${userMessage}`, agentResponse: botReply, timestamp: new Date() }],
          $slice: -100
        }
      },
      $inc: { 'stats.totalMessages': 1 },
      $set: { 'stats.lastActive': new Date() }
    });
  } catch (e) {
    console.error('[agentBot] memory save failed:', e.message);
  }
}

// Execute a tool via the madladslab internal MCP endpoint
async function callMadlabTool(agentId, toolName, args) {
  const baseUrl = process.env.MADLADSLAB_URL || 'http://localhost:3000';
  const secret = process.env.BOT_ALERT_SECRET || 'bih-internal';
  const res = await fetch(`${baseUrl}/agents/api/mcp/execute-internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, agentId: agentId.toString(), toolName, args })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Tool execution failed');
  return data.result;
}

// Strip model-hallucinated bracket tool calls from plain-chat responses.
// Removes lines that are purely bracket commands (e.g. [DIR], [bash ls]).
// Does NOT strip lowercase casual expressions like [laughs].
function stripBracketTools(text) {
  const toolBracketRe = /^\s*\[(?:[A-Z_]{2,}|(?:bash|sh|shell|cmd|tree|ls|dir|pwd|cat|echo|grep|find|cd|mkdir|rm|cp|mv|python|node|git|curl|wget|tmux|ssh)\b)[^\]]*\]\s*$/im;
  const inlineToolRe = /\[(?:[A-Z_]{2,}|(?:bash|sh|shell|cmd|tree|ls|dir|pwd|cat|echo|grep|find|cd|mkdir|rm|cp|mv|python|node|git|curl|wget|tmux|ssh)\b)[^\]]*\]/gi;
  if (toolBracketRe.test(text)) {
    text = text.split('\n').filter(l => !toolBracketRe.test(l)).join('\n').trim();
  }
  return text.replace(inlineToolRe, '').trim();
}

// Chat with an agent in bih context.
// opts.directAddress: true when user explicitly @-mentioned this bot → always respond
// Returns the reply string, or null if the bot chose to stay silent.
async function botChat(agent, recentHistory, newMessage, senderName, activeBotNames = [], opts = {}) {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
  const ollamaApiKey = process.env.OLLAMA_API_KEY;

  const botName = agent.bihBot.displayName || agent.name;
  const chatMode = agent.bihBot.chatMode || 'passive';
  const enabledTools = agent.mcpConfig?.enabledTools || [];
  const directAddress = opts.directAddress === true;

  const ctxLines = (recentHistory || []).slice(-8)
    .map(m => `${m.displayName}: ${m.message}`).join('\n');

  const memCtx = agent.memory?.longTermMemory
    ? `Your long-term memory:\n${agent.memory.longTermMemory}`
    : null;

  const peers = activeBotNames.filter(n => n !== botName);
  const peerLine = peers.length
    ? `Other bots in chat: ${peers.join(', ')}. They may also respond.`
    : '';

  // Build the behavior system message based on chatMode
  let behaviorMsg;
  if (chatMode === 'agent') {
    const toolNames = enabledTools.filter(t => BIH_TOOL_DEFS[t]).map(t => t);
    behaviorMsg = `You are ${botName}, a member of the ballzinholez.com group chat (bih gaming hub).
${peerLine}

Respond conversationally. Keep replies concise — this is a live chat.
${toolNames.length > 0 ? `You have tools available (${toolNames.join(', ')}). Use them when the request genuinely requires it.` : ''}
Never start your reply with your own name or "Name:" prefix.`;
  } else if (chatMode === 'active') {
    behaviorMsg = `You are ${botName}, a member of the ballzinholez.com group chat (bih gaming hub).
${peerLine}

Reply when you have something relevant or in-character to say. Keep it short (1-2 sentences).
If you truly have nothing to add, output [SILENT] and nothing else.
Never start your reply with your own name or "Name:" prefix.
Plain conversational text only.`;
  } else {
    // passive (default)
    const forceReply = directAddress
      ? `You have been directly addressed — you MUST respond. Keep it brief.`
      : `IMPORTANT: Default to silence. Only reply if you are directly addressed by name OR the topic strongly matches your persona. If in doubt, output [SILENT] and nothing else.`;
    behaviorMsg = `You are ${botName}, a persistent member of the ballzinholez.com group chat (bih gaming hub).
${peerLine}

${forceReply}

When you do reply: one or two sentences max.
Never start your reply with your own name or "Name:" prefix.
Plain conversational text only. No bracket commands.`;
  }

  const messages = [
    { role: 'system', content: agent.config.systemPrompt },
    { role: 'system', content: behaviorMsg },
    ...(memCtx ? [{ role: 'system', content: memCtx }] : []),
    ...(ctxLines ? [{ role: 'system', content: `Recent chat:\n${ctxLines}` }] : []),
    { role: 'user', content: `${senderName}: ${newMessage}` }
  ];

  const headers = { 'Content-Type': 'application/json' };
  if (ollamaApiKey) headers['Authorization'] = `Bearer ${ollamaApiKey}`;

  // Build tool defs for agent mode
  const toolDefs = chatMode === 'agent' && enabledTools.length > 0
    ? enabledTools.map(t => BIH_TOOL_DEFS[t]).filter(Boolean)
    : [];

  const reqBody = {
    model: agent.model,
    messages,
    options: { temperature: agent.config.temperature || 0.7, num_ctx: Math.min(agent.config.contextWindow || 4096, 8192) },
    stream: false
  };
  if (toolDefs.length > 0) reqBody.tools = toolDefs;

  let res = await fetch(`${ollamaBaseUrl}/api/chat`, { method: 'POST', headers, body: JSON.stringify(reqBody) });
  const rawText = await res.text();
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${rawText.slice(0, 200)}`);

  // Parse response — handle both JSON and NDJSON
  let parsed = null;
  try { parsed = JSON.parse(rawText); } catch {
    const lines2 = rawText.trim().split('\n');
    for (let i = lines2.length - 1; i >= 0; i--) {
      try { parsed = JSON.parse(lines2[i]); if (parsed.message) break; } catch { /* skip */ }
    }
  }

  // Handle tool_calls in agent mode (one round)
  if (chatMode === 'agent' && parsed?.message?.tool_calls?.length > 0) {
    messages.push(parsed.message);
    for (const tc of parsed.message.tool_calls) {
      const toolName = tc.function.name;
      const toolArgs = typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments) : tc.function.arguments;
      let toolResult;
      try { toolResult = await callMadlabTool(agent._id, toolName, toolArgs); }
      catch (err) { toolResult = { error: err.message }; }
      messages.push({ role: 'tool', content: JSON.stringify(toolResult) });
    }
    res = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: agent.model, messages, options: reqBody.options, stream: false })
    });
    const raw2 = await res.text();
    try { parsed = JSON.parse(raw2); } catch {
      const ls = raw2.trim().split('\n');
      for (let i = ls.length - 1; i >= 0; i--) {
        try { parsed = JSON.parse(ls[i]); if (parsed.message) break; } catch { /* skip */ }
      }
    }
  }

  const content = parsed?.message?.content?.trim();
  if (!content) return null;

  // Silent check (not applicable in agent mode)
  if (chatMode !== 'agent') {
    if (/^\[silent\]$/i.test(content)) return null;
    if (/^\[silent\]/i.test(content) && content.length < 20) return null;
  }
  let cleaned = content.replace(/^\[silent\]\s*/i, '').trim();
  if (!cleaned) return null;

  // Strip hallucinated bracket tool calls in non-agent modes
  if (chatMode !== 'agent') {
    cleaned = stripBracketTools(cleaned);
    if (!cleaned) return null;
  }

  // Strip leading "Name: " prefix that models sometimes mimic from chat context
  const prefixRe = /^[A-Za-z0-9 _'-]{1,40}:\s+/;
  const stripped = prefixRe.test(cleaned) ? cleaned.replace(prefixRe, '').trim() : cleaned;
  if (!stripped) return null;

  saveBihMemory(agent._id, `${senderName}: ${newMessage}`, stripped);
  return stripped;
}

module.exports = { getActiveBots, botChat, listAgents, activateAgent, deactivateAgent, createAgent, grantAgentPerm, revokeAgentPerm, setAgentAllowedRoles };
