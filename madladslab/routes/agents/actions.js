import express from "express";
import mongoose from "mongoose";

import AgentAction from "../../api/v1/models/AgentAction.js";
import Agent from "../../api/v1/models/Agent.js";
import { isAdmin } from "./middleware.js";
import { buildTaskDoc } from "./task-helpers.js";

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
        const task = buildTaskDoc(req.params.id, { title, description, priority }, 'operator');
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
        const task = buildTaskDoc(req.params.id, { title: action.title, description: action.content, priority }, 'promoted');
        const result = await db.collection('agent_tasks').insertOne(task);
        res.json({ success: true, task: { ...task, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create a manual action for an agent
router.post('/api/agents/:id/actions', isAdmin, async (req, res) => {
    try {
        const { title, content, type = 'finding' } = req.body;
        if (!title || !content) return res.status(400).json({ success: false, error: 'title and content required' });
        const allowed = ['tldr', 'task_list', 'background', 'file_write', 'image', 'finding'];
        if (!allowed.includes(type)) return res.status(400).json({ success: false, error: 'invalid type' });
        const action = new AgentAction({ agentId: req.params.id, type, title, content, status: 'complete' });
        await action.save();
        res.json({ success: true, action });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// List crons for an agent
router.get('/api/agents/:id/crons', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const crons = await db.collection('agent_crons')
            .find({ agentId: req.params.id, active: true })
            .sort({ createdAt: -1 })
            .toArray();
        res.json({ success: true, crons });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create a cron for an agent
router.post('/api/agents/:id/crons', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const { title, content, intervalMinutes = 60 } = req.body;
        if (!title || !content) return res.status(400).json({ success: false, error: 'title and content required' });
        const interval = Math.max(5, Math.min(10080, parseInt(intervalMinutes) || 60));
        const cron = {
            agentId: req.params.id,
            title: String(title).substring(0, 200),
            content: String(content).substring(0, 1000),
            intervalMinutes: interval,
            active: true,
            nextRun: new Date(Date.now() + interval * 60000),
            lastRun: null,
            createdAt: new Date()
        };
        const result = await db.collection('agent_crons').insertOne(cron);
        res.json({ success: true, cron: { ...cron, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete/disable a cron
router.delete('/api/agents/:id/crons/:cronId', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        await db.collection('agent_crons').updateOne(
            { _id: new mongoose.Types.ObjectId(req.params.cronId), agentId: req.params.id },
            { $set: { active: false } }
        );
        res.json({ success: true });
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

// Human reply to a needs_human task — bypasses chat rate-limit
router.post('/api/agents/:id/tasks/:taskId/reply', isAdmin, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'message required' });

        const db = mongoose.connection.db;
        const task = await db.collection('agent_tasks').findOne({
            _id: new mongoose.Types.ObjectId(req.params.taskId),
            agentId: req.params.id
        });
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

        // Mark complete with human reply stored on the task
        await db.collection('agent_tasks').updateOne(
            { _id: task._id },
            { $set: { status: 'complete', completedAt: new Date(), completedBy: 'human_reply', humanReply: message } }
        );

        // Inject reply into agent's conversation history so next chat/bg tick has context
        await Agent.findByIdAndUpdate(req.params.id, {
            $push: {
                'memory.conversations': {
                    userMessage: `[Human reply for task "${task.title}"]: ${message}`,
                    agentResponse: '(Awaiting agent response on next run)',
                    tokenCount: 0,
                    timestamp: new Date()
                }
            }
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Org-wide approval queue (needs_human tasks)
router.get('/api/tasks/approval-queue', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const tasks = await db.collection('agent_tasks')
            .find({ status: 'needs_human' })
            .sort({ askedAt: 1 })
            .limit(50)
            .toArray();

        const agentIds = [...new Set(tasks.map(t => t.agentId))];
        const agentDocs = await Agent.find({ _id: { $in: agentIds } }, 'name').lean();
        const agMap = Object.fromEntries(agentDocs.map(a => [a._id.toString(), a.name]));

        res.json({ success: true, tasks: tasks.map(t => ({ ...t, agentName: agMap[t.agentId] || 'Unknown' })) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Org-wide task scorecard
router.get('/api/tasks/scorecard', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const agents = await Agent.find({}, 'name tier bgProductivity config.backgroundRunning').lean();

        const counts = await db.collection('agent_tasks').aggregate([
            { $group: { _id: { agentId: '$agentId', status: '$status' }, count: { $sum: 1 } } }
        ]).toArray();

        // Roll up by agent
        const byAgent = {};
        for (const c of counts) {
            const id = c._id.agentId;
            if (!byAgent[id]) byAgent[id] = { pending: 0, complete: 0, needs_human: 0 };
            const s = c._id.status;
            if (s === 'pending') byAgent[id].pending = c.count;
            else if (s === 'complete') byAgent[id].complete = c.count;
            else if (s === 'needs_human') byAgent[id].needs_human = c.count;
        }

        // Completed in last 24h
        const since24h = new Date(Date.now() - 86400000);
        const recent = await db.collection('agent_tasks').aggregate([
            { $match: { status: 'complete', completedAt: { $gte: since24h } } },
            { $group: { _id: '$agentId', count: { $sum: 1 } } }
        ]).toArray();
        const recentMap = Object.fromEntries(recent.map(r => [r._id, r.count]));

        const scorecard = agents.map(a => {
            const id = a._id.toString();
            const t = byAgent[id] || { pending: 0, complete: 0, needs_human: 0 };
            const total = t.pending + t.complete + t.needs_human;
            const rate = total > 0 ? Math.round((t.complete / total) * 100) : null;
            return {
                agentId: id,
                name: a.name,
                tier: a.tier,
                pending: t.pending,
                complete: t.complete,
                needs_human: t.needs_human,
                completionRate: rate,
                completedLast24h: recentMap[id] || 0,
                productivityScore: a.bgProductivity?.score ?? null,
                backgroundRunning: a.config?.backgroundRunning ?? false
            };
        }).sort((a, b) => (b.pending + b.needs_human) - (a.pending + a.needs_human));

        const totals = scorecard.reduce((acc, a) => {
            acc.pending += a.pending;
            acc.complete += a.complete;
            acc.needs_human += a.needs_human;
            acc.completedLast24h += a.completedLast24h;
            return acc;
        }, { pending: 0, complete: 0, needs_human: 0, completedLast24h: 0 });

        res.json({ success: true, scorecard, totals });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
