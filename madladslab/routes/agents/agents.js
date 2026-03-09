import express from "express";
import axios from "axios";

import Agent from "../../api/v1/models/Agent.js";
import { isAdmin } from "./middleware.js";

const router = express.Router();

// Dashboard
router.get('/', isAdmin, async (req, res) => {
    try {
        const agents = await Agent.find({})
            .populate('createdBy', 'displayName email')
            .sort({ createdAt: -1 });

        res.render("agents/index", {
            user: req.user,
            agents,
            currentPage: 'agents'
        });
    } catch (error) {
        console.error('Error loading agents dashboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Digest — unified background feed
router.get('/digest', isAdmin, async (req, res) => {
    try {
        const agents = await Agent.find({}, 'name role status tier').sort({ tier: 1, name: 1 }).lean();
        res.render("agents/digest", { user: req.user, agents, currentPage: 'agents' });
    } catch (error) {
        console.error('Error loading digest:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Get all agents
router.get('/api/agents', isAdmin, async (req, res) => {
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

// Get full org chart
router.get('/api/agents/hierarchy', isAdmin, async (req, res) => {
    try {
        const agents = await Agent.find({}, 'name role status tier parentAgent').lean();
        res.json({ success: true, agents });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set hierarchy tier + parent
router.put('/api/agents/:id/hierarchy', isAdmin, async (req, res) => {
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
router.get('/api/agents/:id', isAdmin, async (req, res) => {
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
router.post('/api/agents', isAdmin, async (req, res) => {
    try {
        const { name, description, model, provider, systemPrompt, temperature, contextWindow, maxTokens } = req.body;

        if (!name || name.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Agent name is required' });
        }

        if (!model || model.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Model is required' });
        }

        if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
            return res.status(400).json({ success: false, error: 'Temperature must be between 0 and 2' });
        }

        const agentData = {
            name: name.trim(),
            description: description?.trim() || '',
            model: model.trim(),
            provider: provider || 'ollama',
            createdBy: req.user._id,
            config: {
                systemPrompt: systemPrompt || 'You are a helpful AI assistant.',
                temperature: temperature !== undefined ? parseFloat(temperature) : 0.7,
                contextWindow: contextWindow ? parseInt(contextWindow) : 200000,
                maxTokens: maxTokens ? parseInt(maxTokens) : 8192
            }
        };

        const agent = new Agent(agentData);
        await agent.save();
        await agent.addLog('info', `Agent created by ${req.user.displayName || req.user.email}`);

        res.json({ success: true, agent });
    } catch (error) {
        console.error('Error creating agent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update agent
router.put('/api/agents/:id', isAdmin, async (req, res) => {
    try {
        const { name, description, model, provider, systemPrompt, temperature, contextWindow, maxTokens } = req.body;

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
        if (provider !== undefined) agent.provider = provider;
        if (systemPrompt !== undefined) agent.config.systemPrompt = systemPrompt;
        if (temperature !== undefined) agent.config.temperature = parseFloat(temperature);
        if (contextWindow !== undefined) agent.config.contextWindow = parseInt(contextWindow);
        if (maxTokens !== undefined) agent.config.maxTokens = parseInt(maxTokens);

        await agent.save();
        await agent.addLog('info', `Agent updated by ${req.user.displayName || req.user.email}`);

        res.json({ success: true, agent });
    } catch (error) {
        console.error('Error updating agent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete agent
router.delete('/api/agents/:id', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        await Agent.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: 'Agent deleted successfully' });
    } catch (error) {
        console.error('Error deleting agent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update capabilities
router.put('/api/agents/:id/capabilities', isAdmin, async (req, res) => {
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
router.put('/api/agents/:id/bih-bot/chat-mode', isAdmin, async (req, res) => {
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
router.put('/api/agents/:id/bih-bot/roles', isAdmin, async (req, res) => {
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
router.patch('/api/agents/:id/bih-bot', isAdmin, async (req, res) => {
    try {
        const { enabled, trigger, displayName, avatar } = req.body;
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        agent.bihBot.enabled = typeof enabled === 'boolean' ? enabled : agent.bihBot.enabled;
        agent.bihBot.trigger = trigger
            ? trigger.toLowerCase().replace(/[^a-z0-9_-]/g, '')
            : (agent.bihBot.trigger || agent.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, ''));
        agent.bihBot.displayName = displayName || agent.bihBot.displayName || agent.name;
        agent.bihBot.avatar = avatar !== undefined ? avatar : agent.bihBot.avatar;

        await agent.save();
        res.json({ success: true, bihBot: agent.bihBot });
    } catch (error) {
        console.error('Error updating bihBot config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Toggle pepeChat (consumer-facing chat) on an agent
// Only one agent can have pepeChat.enabled at a time
router.patch('/api/agents/:id/pepe-chat', isAdmin, async (req, res) => {
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
router.patch('/api/agents/:id/status', isAdmin, async (req, res) => {
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
router.get('/api/agents/:id/logs', isAdmin, async (req, res) => {
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

// Test Ollama connection
router.get('/api/ollama/test', isAdmin, async (req, res) => {
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
