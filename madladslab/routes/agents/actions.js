import express from "express";
import mongoose from "mongoose";

import AgentAction from "../../api/v1/models/AgentAction.js";
import Agent from "../../api/v1/models/Agent.js";
import { isAdmin } from "./middleware.js";

const router = express.Router();

// Get actions for a specific agent
router.get('/api/agents/:id/actions', isAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const type = req.query.type;
        const filter = { agentId: req.params.id };
        if (type) filter.type = type;

        const actions = await AgentAction.find(filter).sort({ createdAt: -1 }).limit(limit);
        res.json({ success: true, actions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all actions across all agents (findings collection)
router.get('/api/actions', isAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const type = req.query.type;
        const filter = type ? { type } : {};
        const actions = await AgentAction.find(filter)
            .populate('agentId', 'name role')
            .sort({ createdAt: -1 })
            .limit(limit);
        res.json({ success: true, actions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Promote an action into memory (knowledge base or long-term notes)
router.post('/api/agents/:id/actions/:actionId/promote', isAdmin, async (req, res) => {
    try {
        const { target } = req.body; // 'knowledge' | 'longterm'
        if (!['knowledge', 'longterm'].includes(target)) {
            return res.status(400).json({ success: false, error: 'target must be "knowledge" or "longterm"' });
        }

        const action = await AgentAction.findOne({ _id: req.params.actionId, agentId: req.params.id });
        if (!action) return res.status(404).json({ success: false, error: 'Action not found' });

        if (target === 'knowledge') {
            await Agent.findByIdAndUpdate(req.params.id, {
                $push: {
                    'memory.knowledgeBase': {
                        type: 'context',
                        title: action.title,
                        content: action.content,
                        addedAt: new Date()
                    }
                }
            });
        } else {
            const agent = await Agent.findById(req.params.id, 'memory.longTermMemory');
            if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
            const current = agent.memory.longTermMemory || '';
            const snippet = (action.content || '').replace(/\n+/g, ' ').substring(0, 400);
            const entry = `- [Promoted ${new Date().toLocaleDateString()}] **${action.title}**: ${snippet}`;
            const updated = current ? `${current}\n${entry}` : entry;
            await Agent.findByIdAndUpdate(req.params.id, { $set: { 'memory.longTermMemory': updated } });
        }

        res.json({ success: true, target });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get task queue for an agent
router.get('/api/agents/:id/tasks', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const status = req.query.status || 'pending';
        const tasks = await db.collection('agent_tasks')
            .find({ agentId: req.params.id, status })
            .sort({ priorityScore: -1, createdAt: 1 })
            .limit(50)
            .toArray();
        res.json({ success: true, tasks });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create a task for an agent (operator-injected)
router.post('/api/agents/:id/tasks', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const { title, description, priority = 'medium' } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'title required' });
        const PRIORITY_SCORE = { high: 3, medium: 2, low: 1 };
        const task = {
            agentId: req.params.id,
            title: String(title).substring(0, 200),
            description: String(description || '').substring(0, 500),
            priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
            priorityScore: PRIORITY_SCORE[priority] || 2,
            status: 'pending',
            source: 'operator',
            createdAt: new Date()
        };
        const result = await db.collection('agent_tasks').insertOne(task);
        res.json({ success: true, task: { ...task, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete / cancel a task
router.delete('/api/agents/:id/tasks/:taskId', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        await db.collection('agent_tasks').updateOne(
            { _id: new mongoose.Types.ObjectId(req.params.taskId), agentId: req.params.id },
            { $set: { status: 'cancelled' } }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Promote an action to a task
router.post('/api/agents/:id/actions/:actionId/promote-task', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const { priority = 'medium' } = req.body;
        const action = await AgentAction.findOne({ _id: req.params.actionId, agentId: req.params.id });
        if (!action) return res.status(404).json({ success: false, error: 'Action not found' });
        const PRIORITY_SCORE = { high: 3, medium: 2, low: 1 };
        const task = {
            agentId: req.params.id,
            title: action.title,
            description: action.content.substring(0, 500),
            priority,
            priorityScore: PRIORITY_SCORE[priority] || 2,
            status: 'pending',
            source: 'promoted',
            createdAt: new Date()
        };
        const result = await db.collection('agent_tasks').insertOne(task);
        res.json({ success: true, task: { ...task, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete a specific action
router.delete('/api/agents/:id/actions/:actionId', isAdmin, async (req, res) => {
    try {
        await AgentAction.findOneAndDelete({ _id: req.params.actionId, agentId: req.params.id });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
