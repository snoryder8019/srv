import express from "express";
import axios from "axios";
import mongoose from "mongoose";
import { readdir } from "fs/promises";
import { join, resolve } from "path";

import Agent from "../../api/v1/models/Agent.js";
import AgentAction from "../../api/v1/models/AgentAction.js";
import { isAdmin, requireAgents, requireAgentsWrite, requireAgentsAdmin } from "./middleware.js";

const router = express.Router();

// Root → Hub
router.get('/', requireAgents, (req, res) => res.redirect('/agents/hub'));

// Display — TV/wall dashboard
router.get('/display', requireAgents, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const agents = await Agent.find({}, 'name description model role status tier category project capabilities bgProductivity bgTickHistory stats config.backgroundRunning').lean();

        // Group by category
        const CATS = ['business','ops','security','research','personal','creative','education','other'];
        const byCategory = {};
        CATS.forEach(c => byCategory[c] = []);
        agents.forEach(a => {
            const cat = CATS.includes(a.category) ? a.category : 'other';
            byCategory[cat].push(a);
        });

        // Org stats
        const totalAgents = agents.length;
        const activeAgents = agents.filter(a => ['idle','running'].includes(a.status)).length;
        const bgRunning = agents.filter(a => a.config?.backgroundRunning).length;

        // Recent actions (last 20)
        const recentActions = await db.collection('agent_actions').find({}).sort({ createdAt: -1 }).limit(20).toArray().catch(() => []);

        // Task counts
        const pendingTasks = await db.collection('agent_tasks').countDocuments({ status: { $in: ['pending','needs_human'] } }).catch(() => 0);
        const doneTasks = await db.collection('agent_tasks').countDocuments({ status: 'completed' }).catch(() => 0);

        res.render('agents/display', {
            user: req.user,
            byCategory,
            CATS,
            totalAgents,
            activeAgents,
            bgRunning,
            recentActions: JSON.stringify(recentActions),
            pendingTasks,
            doneTasks,
            currentPage: 'agents-display',
            layout: false
        });
    } catch (error) {
        console.error('Error loading display:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Digest — unified background feed
router.get('/digest', requireAgents, async (req, res) => {
    try {
        const agents = await Agent.find({}, 'name role status tier').sort({ tier: 1, name: 1 }).lean();
        res.render("agents/digest", { user: req.user, agents, currentPage: 'agents' });
    } catch (error) {
        console.error('Error loading digest:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Get all agents
router.get('/api/agents', requireAgents, async (req, res) => {
    try {
        const agents = await Agent.find({})
            .populate('createdBy', 'displayName email')
            .sort({ createdAt: -1 });

        res.json({ success: true, agents });
    } catch (error) {
        console.error('Error fetching agents:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Hub view
router.get('/hub', requireAgents, async (req, res) => {
    try {
        const agents = await Agent.find({})
            .populate('createdBy', 'displayName email')
            .sort({ createdAt: -1 });
        res.render('agents/hub', { user: req.user, agents, currentPage: 'agents-hub' });
    } catch (error) {
        console.error('Error loading agent hub:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Admin: wipe a single collection entirely (agents, notes, or actions)
router.post('/api/agents/admin/wipe', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const { target } = req.body;
        if (!['agents', 'notes', 'actions', 'tasks', 'projects', 'reports'].includes(target)) {
            return res.status(400).json({ success: false, error: 'Invalid target' });
        }
        let deleted = 0;
        if (target === 'agents') {
            const r = await Agent.deleteMany({});
            deleted = r.deletedCount;
        } else if (target === 'notes') {
            const r = await db.collection('agent_notes').deleteMany({});
            deleted = r.deletedCount;
        } else if (target === 'actions') {
            const r = await AgentAction.deleteMany({});
            deleted = r.deletedCount;
        } else if (target === 'tasks') {
            const r = await db.collection('agent_tasks').deleteMany({});
            deleted = r.deletedCount;
        } else if (target === 'projects') {
            const r = await db.collection('agent_projects').deleteMany({});
            deleted = r.deletedCount;
        } else if (target === 'reports') {
            const r = await db.collection('agent_reports').deleteMany({});
            deleted = r.deletedCount;
        }
        console.log(`[ADMIN WIPE] target=${target} deleted=${deleted} by ${req.user?.email || 'unknown'}`);
        res.json({ success: true, target, deleted });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset ALL agent namespace collections org-wide (must be before /:id routes)
router.post('/api/agents/namespaces/reset-all', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const { collections = ['tasks', 'notes', 'crons', 'actions'] } = req.body;
        const deleted = {};
        if (collections.includes('tasks')) { const r = await db.collection('agent_tasks').deleteMany({}); deleted.tasks = r.deletedCount; }
        if (collections.includes('notes')) { const r = await db.collection('agent_notes').deleteMany({}); deleted.notes = r.deletedCount; }
        if (collections.includes('crons')) { const r = await db.collection('agent_crons').deleteMany({}); deleted.crons = r.deletedCount; }
        if (collections.includes('actions')) { const r = await AgentAction.deleteMany({}); deleted.actions = r.deletedCount; }
        res.json({ success: true, deleted });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Projects ────────────────────────────────────────────────────────────────

router.get('/api/agents/projects', requireAgents, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const projects = await db.collection('agent_projects').find({}).sort({ createdAt: -1 }).toArray();
        res.json({ success: true, projects });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/api/agents/projects', requireAgentsWrite, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const { name, description = '', category = 'other' } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'name required' });
        const VALID_CATS = ['business','personal','education','research','creative','ops','security','other'];
        const project = {
            name: name.trim(),
            description: description.trim(),
            category: VALID_CATS.includes(category) ? category : 'other',
            createdAt: new Date(),
            createdBy: req.user._id.toString()
        };
        const result = await db.collection('agent_projects').insertOne(project);
        res.json({ success: true, project: { ...project, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/api/agents/projects/:projectId', requireAgentsAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        await db.collection('agent_projects').deleteOne({
            _id: new mongoose.Types.ObjectId(req.params.projectId)
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Dir tree (locked to /srv subtree) ──────────────────────────────────────

router.get('/api/agents/dirtree', isAdmin, async (req, res) => {
    try {
        const reqPath = req.query.path || '/srv';
        const resolved = resolve(reqPath);
        if (!resolved.startsWith('/srv')) {
            return res.status(403).json({ success: false, error: 'Path must be under /srv' });
        }
        const entries = await readdir(resolved, { withFileTypes: true });
        const SKIP = new Set(['.git', 'node_modules', '.npm', 'dist', 'build', '.cache']);
        const children = entries
            .filter(e => !e.name.startsWith('.') && !SKIP.has(e.name))
            .map(e => ({ name: e.name, path: join(resolved, e.name), isDir: e.isDirectory() }))
            .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
        res.json({ success: true, path: resolved, children });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get full org chart
router.get('/api/agents/hierarchy', requireAgents, async (req, res) => {
    try {
        const agents = await Agent.find({}, 'name role status tier parentAgent').lean();
        res.json({ success: true, agents });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set hierarchy tier + parent
router.put('/api/agents/:id/hierarchy', requireAgentsWrite, async (req, res) => {
    try {
        const { tier, parentAgentId } = req.body;
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        if (tier && ['apex', 'executive', 'manager', 'worker'].includes(tier)) agent.tier = tier;

        if (parentAgentId === null || parentAgentId === '') {
            agent.parentAgent = null;
        } else if (parentAgentId) {
            if (parentAgentId === req.params.id) {
                return res.status(400).json({ success: false, error: 'Agent cannot be its own parent' });
            }
            agent.parentAgent = parentAgentId;
        }

        // Apex agents must have no parent
        if (agent.tier === 'apex') agent.parentAgent = null;

        await agent.save();
        await agent.addLog('info', `Hierarchy updated: tier=${agent.tier}, parent=${agent.parentAgent || 'none'}`);
        res.json({ success: true, tier: agent.tier, parentAgent: agent.parentAgent });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get single agent
router.get('/api/agents/:id', requireAgents, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id)
            .populate('createdBy', 'displayName email');

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        res.json({ success: true, agent });
    } catch (error) {
        console.error('Error fetching agent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create new agent
router.post('/api/agents', requireAgentsWrite, async (req, res) => {
    try {
        const { name, description, model, provider, role, systemPrompt, temperature, contextWindow, maxTokens, mcpTools, mcpBackgroundTools, supportsAgentId, supportRole, supportLabel, project, category, workingDir, capabilities } = req.body;

        if (!name || name.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Agent name is required' });
        }

        if (!model || model.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Model is required' });
        }

        if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
            return res.status(400).json({ success: false, error: 'Temperature must be between 0 and 2' });
        }

        const VALID_TOOLS = new Set([
            'read-file', 'write-file', 'list-directory', 'file-find', 'grep-search', 'git-status',
            'execute', 'process-list', 'tmux-sessions', 'tmux-logs', 'service-port',
            'http-request', 'mongo-find', 'mongo-write', 'web-search', 'log-tail',
            'bih-chat', 'npm-run', 'context', 'cron-job', 'generate-image', 'message-agent', 'fetch-url'
        ]);
        const sanitizeTools = (arr) =>
            Array.isArray(arr) ? arr.filter(t => typeof t === 'string' && VALID_TOOLS.has(t)) : [];

        const agentData = {
            name: name.trim(),
            description: description?.trim() || '',
            model: model.trim(),
            provider: provider || 'ollama',
            role: ['assistant', 'researcher', 'vibecoder', 'forwardChat'].includes(role) ? role : 'assistant',
            createdBy: req.user._id,
            config: {
                systemPrompt: systemPrompt || 'You are a helpful AI assistant.',
                temperature: temperature !== undefined ? parseFloat(temperature) : 0.7,
                contextWindow: contextWindow ? parseInt(contextWindow) : 200000,
                maxTokens: maxTokens ? parseInt(maxTokens) : 8192
            },
            mcpConfig: {
                enabledTools: sanitizeTools(mcpTools),
                backgroundEnabledTools: sanitizeTools(mcpBackgroundTools)
            },
            project: project || '',
            category: ['business','personal','education','research','creative','ops','security','other'].includes(category) ? category : 'other',
            workingDir: workingDir || '',
            capabilities: Array.isArray(capabilities) ? capabilities.filter(c => typeof c === 'string') : []
        };

        const agent = new Agent(agentData);
        await agent.save();

        // If this agent is a support agent for another, wire the relationship both ways
        if (supportsAgentId && supportsAgentId.trim()) {
            try {
                const targetAgent = await Agent.findById(supportsAgentId.trim());
                if (targetAgent) {
                    const validSupportRoles = [
                        'prompt-cleaner', 'kb-curator', 'reviewer', 'background-support',
                        'summarizer', 'fact-checker', 'tone-adjuster', 'context-injector',
                        'quality-gate', 'escalation-handler', 'data-validator', 'memory-manager',
                        'task-planner', 'output-formatter', 'content-filter', 'custom'
                    ];
                    const resolvedRole = validSupportRoles.includes(supportRole) ? supportRole : 'custom';
                    // Set supportsAgent on the new agent
                    agent.supportsAgent = { agentId: targetAgent._id, role: resolvedRole };
                    await agent.save();
                    // Add this agent to the target's supportAgents list
                    targetAgent.supportAgents.push({
                        agentId: agent._id,
                        role: resolvedRole,
                        label: supportLabel?.trim() || '',
                        enabled: true
                    });
                    await targetAgent.save();
                    await targetAgent.addLog('info', `Support agent "${agent.name}" (${resolvedRole}) assigned by ${req.user.displayName || req.user.email}`);
                }
            } catch (e) {
                console.error('[Agent create] support agent wiring failed:', e.message);
            }
        }

        await agent.addLog('info', `Agent created by ${req.user.displayName || req.user.email}`);
        res.json({ success: true, agent });
    } catch (error) {
        console.error('Error creating agent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update agent
router.put('/api/agents/:id', requireAgentsWrite, async (req, res) => {
    try {
        const { name, description, model, provider, role, systemPrompt, temperature, contextWindow, maxTokens, backgroundPrompt, project, category, workingDir, capabilities } = req.body;

        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        if (name !== undefined && name.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Agent name cannot be empty' });
        }

        if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
            return res.status(400).json({ success: false, error: 'Temperature must be between 0 and 2' });
        }

        if (name !== undefined) agent.name = name.trim();
        if (description !== undefined) agent.description = description.trim();
        if (model !== undefined) agent.model = model.trim();
        if (role !== undefined && ['assistant','researcher','vibecoder','forwardChat'].includes(role)) agent.role = role;
        if (provider !== undefined) agent.provider = provider;
        if (systemPrompt !== undefined) agent.config.systemPrompt = systemPrompt;
        if (temperature !== undefined) agent.config.temperature = parseFloat(temperature);
        if (contextWindow !== undefined) agent.config.contextWindow = parseInt(contextWindow);
        if (maxTokens !== undefined) agent.config.maxTokens = parseInt(maxTokens);
        if (backgroundPrompt !== undefined) agent.config.backgroundPrompt = backgroundPrompt;
        if (project !== undefined) agent.project = project;
        if (category !== undefined && ['business','personal','education','research','creative','ops','security','other'].includes(category)) agent.category = category;
        if (workingDir !== undefined) agent.workingDir = workingDir;
        if (capabilities !== undefined && Array.isArray(capabilities)) agent.capabilities = capabilities.filter(c => typeof c === 'string');

        await agent.save();
        await agent.addLog('info', `Agent updated by ${req.user.displayName || req.user.email}`);

        res.json({ success: true, agent });
    } catch (error) {
        console.error('Error updating agent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete agent
router.delete('/api/agents/:id', requireAgentsAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        const agentId = req.params.id;
        const agentObjectId = agent._id; // ObjectId — used for Mongoose-managed collections
        const db = mongoose.connection.db;

        // Cascade delete all agent-owned documents from raw collections.
        // agent_actions stores agentId as ObjectId (Mongoose model).
        // agent_tasks / agent_notes / agent_crons store agentId as string (raw MCP inserts).
        await Promise.all([
            db.collection('agent_actions').deleteMany({ agentId: agentObjectId }),
            db.collection('agent_tasks').deleteMany({ agentId }),
            db.collection('agent_notes').deleteMany({ agentId }),
            db.collection('agent_crons').deleteMany({ agentId }),
        ]);

        // Remove from other agents' supportAgents lists and clear supportsAgent back-refs
        await Agent.updateMany(
            { 'supportAgents.agentId': agent._id },
            { $pull: { supportAgents: { agentId: agent._id } } }
        );
        await Agent.updateMany(
            { 'supportsAgent.agentId': agent._id },
            { $set: { 'supportsAgent.agentId': null, 'supportsAgent.role': '' } }
        );

        // Clear parentAgent refs on child agents
        await Agent.updateMany(
            { parentAgent: agent._id },
            { $set: { parentAgent: null } }
        );

        await Agent.findByIdAndDelete(agentId);

        res.json({ success: true, message: 'Agent deleted successfully' });
    } catch (error) {
        console.error('Error deleting agent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update capabilities
router.put('/api/agents/:id/capabilities', requireAgentsWrite, async (req, res) => {
    try {
        const { capabilities } = req.body;
        if (!Array.isArray(capabilities)) {
            return res.status(400).json({ success: false, error: 'capabilities must be an array' });
        }
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        agent.capabilities = capabilities.map(c => String(c).trim()).filter(Boolean);
        await agent.save();
        res.json({ success: true, capabilities: agent.capabilities });
    } catch (error) {
        console.error('Error updating capabilities:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update bihBot chatMode
router.put('/api/agents/:id/bih-bot/chat-mode', requireAgentsWrite, async (req, res) => {
    try {
        const { chatMode } = req.body;
        if (!['passive', 'active', 'agent'].includes(chatMode)) {
            return res.status(400).json({ success: false, error: 'chatMode must be passive, active, or agent' });
        }
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        agent.bihBot.chatMode = chatMode;
        await agent.save();
        res.json({ success: true, chatMode: agent.bihBot.chatMode });
    } catch (error) {
        console.error('Error updating chatMode:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update bihBot allowedRoles
router.put('/api/agents/:id/bih-bot/roles', requireAgentsWrite, async (req, res) => {
    try {
        const { allowedRoles } = req.body;
        if (!Array.isArray(allowedRoles)) {
            return res.status(400).json({ success: false, error: 'allowedRoles must be an array' });
        }
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        agent.bihBot.allowedRoles = allowedRoles.map(r => String(r).trim()).filter(Boolean);
        await agent.save();
        res.json({ success: true, allowedRoles: agent.bihBot.allowedRoles });
    } catch (error) {
        console.error('Error updating bihBot roles:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Toggle bih chat bot deployment
router.patch('/api/agents/:id/bih-bot', requireAgentsWrite, async (req, res) => {
    try {
        const { enabled, trigger, displayName, avatar } = req.body;
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        if (enabled === false) {
            // Full reset — wipe all bih config so re-assignment starts clean
            agent.bihBot.enabled = false;
            agent.bihBot.trigger = '';
            agent.bihBot.displayName = '';
            agent.bihBot.avatar = '';
            agent.bihBot.chatMode = 'passive';
            agent.bihBot.allowedRoles = [];
        } else {
            agent.bihBot.enabled = typeof enabled === 'boolean' ? enabled : agent.bihBot.enabled;
            agent.bihBot.trigger = trigger
                ? trigger.toLowerCase().replace(/[^a-z0-9_-]/g, '')
                : (agent.bihBot.trigger || agent.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, ''));
            agent.bihBot.displayName = displayName || agent.bihBot.displayName || agent.name;
            agent.bihBot.avatar = avatar !== undefined ? avatar : agent.bihBot.avatar;
        }

        await agent.save();
        await agent.addLog('info', `bihBot ${agent.bihBot.enabled ? 'enabled' : 'disabled and reset'} by ${req.user.displayName || req.user.email}`);
        res.json({ success: true, bihBot: agent.bihBot });
    } catch (error) {
        console.error('Error updating bihBot config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Toggle pepeChat (consumer-facing chat) on an agent
// Only one agent can have pepeChat.enabled at a time
router.patch('/api/agents/:id/pepe-chat', requireAgentsWrite, async (req, res) => {
    try {
        const { enabled, sessionLimit, rateLimitPerHour, avatar } = req.body;
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        if (enabled === true) {
            // Disable pepeChat on any other agent first
            await Agent.updateMany({ _id: { $ne: agent._id } }, { $set: { 'pepeChat.enabled': false } });
        }

        agent.pepeChat.enabled = typeof enabled === 'boolean' ? enabled : agent.pepeChat.enabled;
        if (sessionLimit !== undefined) agent.pepeChat.sessionLimit = parseInt(sessionLimit);
        if (rateLimitPerHour !== undefined) agent.pepeChat.rateLimitPerHour = parseInt(rateLimitPerHour);
        if (avatar !== undefined) agent.pepeChat.avatar = avatar;

        await agent.save();
        await agent.addLog('info', `pepeChat ${agent.pepeChat.enabled ? 'enabled' : 'disabled'} by ${req.user.displayName || req.user.email}`);

        res.json({ success: true, pepeChat: agent.pepeChat });
    } catch (error) {
        console.error('Error updating pepeChat config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update agent status
router.patch('/api/agents/:id/status', requireAgentsWrite, async (req, res) => {
    try {
        const { status } = req.body;

        if (!['idle', 'running', 'stopped', 'error'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }

        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        agent.status = status;
        await agent.save();
        await agent.addLog('info', `Status changed to ${status} by ${req.user.displayName || req.user.email}`);

        res.json({ success: true, agent });
    } catch (error) {
        console.error('Error updating agent status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get agent logs
router.get('/api/agents/:id/logs', requireAgents, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        res.json({ success: true, logs: agent.logs.slice(-50).reverse() });
    } catch (error) {
        console.error('Error fetching agent logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Support agent management ──────────────────────────────────────────────────

// List support agents for an agent
router.get('/api/agents/:id/support-agents', requireAgents, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id, 'supportAgents').populate('supportAgents.agentId', 'name role status').lean();
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
        res.json({ success: true, supportAgents: agent.supportAgents || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add a support agent to an agent
router.post('/api/agents/:id/support-agents', requireAgentsWrite, async (req, res) => {
    try {
        const { agentId, role, label } = req.body;
        if (!agentId) return res.status(400).json({ success: false, error: 'agentId required' });

        const [agent, supportAgent] = await Promise.all([
            Agent.findById(req.params.id),
            Agent.findById(agentId)
        ]);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
        if (!supportAgent) return res.status(404).json({ success: false, error: 'Support agent not found' });
        if (agentId === req.params.id) return res.status(400).json({ success: false, error: 'Agent cannot support itself' });

        const validRoles = ['prompt-cleaner', 'kb-curator', 'reviewer', 'background-support', 'custom'];
        const resolvedRole = validRoles.includes(role) ? role : 'custom';

        // Avoid duplicates
        const already = agent.supportAgents.some(s => s.agentId.toString() === agentId);
        if (already) return res.status(400).json({ success: false, error: 'Already a support agent' });

        agent.supportAgents.push({ agentId, role: resolvedRole, label: label?.trim() || '', enabled: true });
        await agent.save();

        // Set supportsAgent on the support agent side
        supportAgent.supportsAgent = { agentId: agent._id, role: resolvedRole };
        await supportAgent.save();

        await agent.addLog('info', `Support agent "${supportAgent.name}" (${resolvedRole}) added by ${req.user.displayName || req.user.email}`);
        res.json({ success: true, supportAgents: agent.supportAgents });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove a support agent
router.delete('/api/agents/:id/support-agents/:supportAgentId', requireAgentsAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        agent.supportAgents = agent.supportAgents.filter(s => s.agentId.toString() !== req.params.supportAgentId);
        await agent.save();

        // Clear supportsAgent on the other side
        await Agent.findByIdAndUpdate(req.params.supportAgentId, { $set: { 'supportsAgent.agentId': null, 'supportsAgent.role': '' } });

        await agent.addLog('info', `Support agent removed by ${req.user.displayName || req.user.email}`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Toggle support agent enabled/disabled
router.patch('/api/agents/:id/support-agents/:supportAgentId', requireAgentsWrite, async (req, res) => {
    try {
        const { enabled } = req.body;
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        const entry = agent.supportAgents.find(s => s.agentId.toString() === req.params.supportAgentId);
        if (!entry) return res.status(404).json({ success: false, error: 'Support agent relationship not found' });

        entry.enabled = typeof enabled === 'boolean' ? enabled : entry.enabled;
        await agent.save();
        res.json({ success: true, supportAgents: agent.supportAgents });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Guardrails management ────────────────────────────────────────────────────

// Get guardrails config
router.get('/api/agents/:id/guardrails', requireAgents, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id, 'forwardChat.guardrails').lean();
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
        res.json({ success: true, guardrails: agent.forwardChat?.guardrails || {} });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update guardrails config
router.put('/api/agents/:id/guardrails', requireAgentsWrite, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        const g = req.body;
        const gr = agent.forwardChat.guardrails;

        if (typeof g.enabled === 'boolean') gr.enabled = g.enabled;
        if (Array.isArray(g.allowedTopics)) gr.allowedTopics = g.allowedTopics.map(t => String(t).trim()).filter(Boolean);
        if (Array.isArray(g.blockedKeywords)) gr.blockedKeywords = g.blockedKeywords.map(k => String(k).trim()).filter(Boolean);
        if (g.maxResponseLength !== undefined) gr.maxResponseLength = Math.max(0, parseInt(g.maxResponseLength) || 0);
        if (typeof g.profanityFilter === 'boolean') gr.profanityFilter = g.profanityFilter;
        if (typeof g.systemPromptLock === 'boolean') gr.systemPromptLock = g.systemPromptLock;
        if (g.offTopicResponse !== undefined) gr.offTopicResponse = String(g.offTopicResponse).substring(0, 500);
        if (g.rateLimit) {
            if (g.rateLimit.messagesPerSession !== undefined) gr.rateLimit.messagesPerSession = Math.max(0, parseInt(g.rateLimit.messagesPerSession) || 0);
            if (g.rateLimit.messagesPerHour !== undefined) gr.rateLimit.messagesPerHour = Math.max(0, parseInt(g.rateLimit.messagesPerHour) || 0);
        }

        await agent.save();
        await agent.addLog('info', `Guardrails updated by ${req.user.displayName || req.user.email}`);
        res.json({ success: true, guardrails: agent.forwardChat.guardrails });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test Ollama connection
router.get('/api/ollama/test', requireAgents, async (req, res) => {
    try {
        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
        const ollamaApiKey = process.env.OLLAMA_API_KEY;

        const response = await axios.get(`${ollamaBaseUrl}/api/tags`, {
            headers: { 'Authorization': `Bearer ${ollamaApiKey}` }
        });

        res.json({ success: true, models: response.data.models });
    } catch (error) {
        console.error('Ollama connection test failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to connect to Ollama',
            details: error.response?.data || error.message
        });
    }
});

export default router;
