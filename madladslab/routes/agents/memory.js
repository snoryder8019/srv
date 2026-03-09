import express from "express";

import Agent from "../../api/v1/models/Agent.js";
import { emitMemoryUpdate } from "../../plugins/socket/agents.js";
import { isAdmin } from "./middleware.js";

const router = express.Router();

// Get agent memory
router.get('/api/agents/:id/memory', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        res.json({
            success: true,
            memory: {
                conversations: (agent.memory.conversations || []).slice(-50).reverse(),
                knowledgeBase: agent.memory.knowledgeBase || [],
                stats: agent.memory.stats || { totalTokens: 0, contextUsagePercent: 0 },
                threadSummary: agent.memory.threadSummary || '',
                longTermMemory: agent.memory.longTermMemory || ''
            }
        });
    } catch (error) {
        console.error('Error fetching memory:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get memory statistics
router.get('/api/agents/:id/memory/stats', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        const stats = {
            totalConversations: (agent.memory.conversations || []).length,
            knowledgeBaseEntries: (agent.memory.knowledgeBase || []).length,
            totalTokens: agent.memory.stats?.totalTokens || 0,
            contextUsagePercent: agent.memory.stats?.contextUsagePercent || 0,
            contextWindow: agent.config.contextWindow
        };

        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error fetching memory stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add knowledge base entry
router.post('/api/agents/:id/memory/knowledge', isAdmin, async (req, res) => {
    try {
        const { title, content, type } = req.body;

        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content are required' });
        }

        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        await agent.addKnowledge(title, content, type || 'context');
        await agent.addLog('info', `Knowledge added: ${title}`);

        const io = req.app.get('io');
        if (io) {
            emitMemoryUpdate(io, agent._id.toString(), 'knowledge', {
                title,
                content,
                type: type || 'context',
                addedAt: new Date()
            });
        }

        res.json({ success: true, knowledgeBase: agent.memory.knowledgeBase });
    } catch (error) {
        console.error('Error adding knowledge:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete knowledge base entry
router.delete('/api/agents/:id/memory/knowledge/:knowledgeId', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        agent.memory.knowledgeBase = agent.memory.knowledgeBase.filter(
            kb => kb._id.toString() !== req.params.knowledgeId
        );

        await agent.save();
        await agent.addLog('info', 'Knowledge entry deleted');

        const io = req.app.get('io');
        if (io) {
            emitMemoryUpdate(io, agent._id.toString(), 'knowledge-deleted', {
                knowledgeId: req.params.knowledgeId
            });
        }

        res.json({ success: true, knowledgeBase: agent.memory.knowledgeBase });
    } catch (error) {
        console.error('Error deleting knowledge:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update thread summary
router.put('/api/agents/:id/memory/summary', isAdmin, async (req, res) => {
    try {
        const { threadSummary } = req.body;
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        agent.memory.threadSummary = threadSummary || '';
        await agent.save();

        res.json({ success: true, threadSummary: agent.memory.threadSummary });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update long-term memory / notes
router.put('/api/agents/:id/memory/notes', isAdmin, async (req, res) => {
    try {
        const { longTermMemory } = req.body;
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        agent.memory.longTermMemory = longTermMemory || '';
        await agent.save();

        res.json({ success: true, longTermMemory: agent.memory.longTermMemory });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Clear agent memory
router.delete('/api/agents/:id/memory', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        await agent.clearMemory();
        await agent.addLog('warning', `Memory cleared by ${req.user.displayName || req.user.email}`);

        const io = req.app.get('io');
        if (io) {
            emitMemoryUpdate(io, agent._id.toString(), 'cleared', {});
        }

        res.json({ success: true, message: 'Memory cleared successfully' });
    } catch (error) {
        console.error('Error clearing memory:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
