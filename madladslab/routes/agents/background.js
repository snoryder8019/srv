import express from "express";
import axios from "axios";
import mongoose from "mongoose";

import Agent from "../../api/v1/models/Agent.js";
import AgentAction from "../../api/v1/models/AgentAction.js";
import { emitActionNew, emitBackgroundStatus, emitAgentPush } from "../../plugins/socket/agents.js";
import { MCP_TOOL_DEFINITIONS, executeMcpTool } from "./mcp.js";
import { isAdmin } from "./middleware.js";

// ==================== BACKGROUND PROCESS MANAGER ====================

const backgroundProcesses = new Map(); // agentId -> { intervalId, agentName, startedAt, lastRun, runCount }

export function startBackgroundProcess(io, agent) {
    const agentId = agent._id.toString();
    if (backgroundProcesses.has(agentId)) return false;

    const intervalMs = Math.max(1, agent.config?.backgroundInterval || 2) * 60 * 1000;
    const proc = { agentId, agentName: agent.name, startedAt: new Date(), lastRun: null, runCount: 0, intervalMs };
    const intervalId = setInterval(() => runBackgroundTick(io, agentId, proc), intervalMs);
    proc.intervalId = intervalId;
    backgroundProcesses.set(agentId, proc);
    if (io) emitBackgroundStatus(io, agentId, 'started', { startedAt: proc.startedAt, intervalMs });
    return true;
}

export function stopBackgroundProcess(io, agentId) {
    const proc = backgroundProcesses.get(agentId);
    if (!proc) return false;
    clearInterval(proc.intervalId);
    backgroundProcesses.delete(agentId);
    if (io) emitBackgroundStatus(io, agentId, 'stopped', {});
    return true;
}

async function runBackgroundTick(io, agentId, proc) {
    try {
        const agent = await Agent.findById(agentId);
        if (!agent) { stopBackgroundProcess(io, agentId); return; }

        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
        const ollamaApiKey = process.env.OLLAMA_API_KEY;

        const bgTools = agent.mcpConfig?.backgroundEnabledTools || [];
        const toolDefs = bgTools.length > 0
            ? bgTools.map(name => MCP_TOOL_DEFINITIONS[name]).filter(Boolean)
            : [];

        let bgRoster = '';
        try {
            const allAgents = await Agent.find({}, 'name role status').lean();
            bgRoster = allAgents
                .filter(a => a._id.toString() !== agentId)
                .map(a => `  - ${a.name} [${a.role}] (${a.status})`)
                .join('\n');
        } catch (_) {}

        // Fetch pending tasks from agent_tasks collection
        let pendingTasks = [];
        try {
            const db = mongoose.connection.db;
            if (db) {
                pendingTasks = await db.collection('agent_tasks')
                    .find({ agentId, status: 'pending' })
                    .sort({ priorityScore: -1, createdAt: 1 })
                    .limit(5)
                    .toArray();
            }
        } catch (_) {}

        // Build directive: task-driven if tasks exist, otherwise generic
        const bgPrompt = agent.config.backgroundPrompt?.trim();
        let bgDirective;
        if (bgPrompt) {
            bgDirective = bgPrompt;
        } else if (pendingTasks.length > 0) {
            const taskList = pendingTasks.map((t, i) =>
                `${i + 1}. [${(t.priority || 'medium').toUpperCase()}] ${t.title}${t.description ? ': ' + t.description : ''} (id: ${t._id})`
            ).join('\n');
            bgDirective = `You have ${pendingTasks.length} pending task(s) in your queue:\n${taskList}\n\n${toolDefs.length > 0 ? 'Use your tools to complete the task.' : ''}\nWork on the highest priority task. Output JSON:\n{"title":"Task: <what you did>","content":"<detailed result>","pushToChat":true|false,"completedTaskIds":["<id>"],"newTasks":[{"title":"...","description":"...","priority":"high|medium|low"}]}\nOnly include completedTaskIds if you actually finished a task. Only include newTasks if follow-up work is needed.`;
        } else {
            bgDirective = `${toolDefs.length > 0 ? 'Use your tools to gather information before reporting.' : ''}\nIf you have proactive insights or follow-up work, output JSON: {"title":"...","content":"...","pushToChat":true,"newTasks":[{"title":"...","description":"...","priority":"high|medium|low"}]}.\nnewTasks is optional — only include if you identify work to be tracked.\nIf nothing to report, output exactly: null`;
        }

        const messages = [
            { role: 'system', content: agent.config.systemPrompt },
            { role: 'system', content: `You are: ${agent.name} (${agent.role}). Running as background process.\nTime: ${new Date().toLocaleString()}${bgRoster ? `\nOther agents:\n${bgRoster}` : ''}\n\n${bgDirective}\n\nOutput format: JSON object as described above, or exactly: null` }
        ];

        // Inject persistent memory context — same as chat loop
        if (agent.memory.threadSummary) {
            messages.push({ role: 'system', content: `Thread Summary:\n${agent.memory.threadSummary}` });
        }
        if (agent.memory.longTermMemory) {
            messages.push({ role: 'system', content: `Long-term Memory (your accumulated findings and notes):\n${agent.memory.longTermMemory}` });
        }
        if (agent.memory.knowledgeBase?.length > 0) {
            const kb = agent.memory.knowledgeBase.slice(-10).map(e => `[${e.type}] ${e.title}: ${e.content}`).join('\n');
            messages.push({ role: 'system', content: `Knowledge Base:\n${kb}` });
        }

        const reqBody = {
            model: agent.model,
            messages,
            options: { temperature: agent.config.temperature },
            stream: false
        };
        if (toolDefs.length > 0) reqBody.tools = toolDefs;

        // Inject subordinate briefings for manager/executive/apex agents
        if (['manager', 'executive', 'apex'].includes(agent.tier)) {
            try {
                const subQuery = agent.tier === 'apex'
                    ? { _id: { $ne: agent._id } }
                    : { parentAgent: agent._id };
                const subs = await Agent.find(subQuery, 'name role status memory.longTermMemory').lean();
                if (subs.length > 0) {
                    const briefing = subs.map(s => {
                        const notes = (s.memory?.longTermMemory || 'No notes').substring(0, 250);
                        return `• ${s.name} [${s.role}/${s.status}]: ${notes}`;
                    }).join('\n\n');
                    messages.push({ role: 'system', content: `Team Briefing (subordinates):\n${briefing}` });
                }
            } catch (_) {}
        }

        const ollamaHeaders = { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' };
        const OLLAMA_TIMEOUT = 120000; // 2 min — background ticks are non-urgent

        let res = await axios.post(`${ollamaBaseUrl}/api/chat`, reqBody,
            { headers: ollamaHeaders, timeout: OLLAMA_TIMEOUT });

        // One round of tool execution if tools were called
        if (toolDefs.length > 0 && res.data.message?.tool_calls?.length > 0) {
            messages.push(res.data.message);
            for (const toolCall of res.data.message.tool_calls) {
                const toolName = toolCall.function.name;
                const toolArgs = typeof toolCall.function.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;
                let toolResult;
                try { toolResult = await executeMcpTool(toolName, toolArgs); }
                catch (err) { toolResult = { error: err.message }; }
                messages.push({ role: 'tool', content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult) });
            }
            res = await axios.post(`${ollamaBaseUrl}/api/chat`, {
                model: agent.model, messages, options: { temperature: agent.config.temperature }, stream: false
            }, { headers: ollamaHeaders, timeout: OLLAMA_TIMEOUT });
        }

        const content = res.data.message?.content?.trim();
        proc.lastRun = new Date();
        proc.runCount++;

        if (content && content !== 'null' && !content.toLowerCase().startsWith('null')) {
            let parsed;
            try { parsed = JSON.parse(content); } catch { parsed = { title: 'Background insight', content }; }

            const action = new AgentAction({
                agentId,
                type: 'background',
                title: parsed.title || 'Background insight',
                content: parsed.content || content,
                tokens: (res.data.eval_count || 0),
                status: 'complete'
            });
            await action.save();
            if (io) emitActionNew(io, agentId, action.toObject());
            if (io && parsed.pushToChat !== false) {
                emitAgentPush(io, agentId, {
                    type: 'background',
                    title: action.title,
                    content: action.content,
                    actionId: action._id.toString()
                });
            }
            await agent.addLog('info', `Background finding: ${action.title}`);

            // Process self-generated task operations
            processTaskOperations(agentId, parsed)
                .catch(e => console.error(`[BG ${agentId}] Task ops failed:`, e.message));

            // Feed finding back into long-term memory so future ticks build on prior work
            appendFindingToMemory(agentId, action.title, action.content)
                .catch(e => console.error(`[BG ${agentId}] Memory append failed:`, e.message));
        }

        if (io) emitBackgroundStatus(io, agentId, 'tick', { lastRun: proc.lastRun, runCount: proc.runCount, pendingTasks: pendingTasks.length });
    } catch (err) {
        console.error(`Background tick error [${agentId}]:`, err.message);
    }
}

async function processTaskOperations(agentId, parsed) {
    const db = mongoose.connection.db;
    if (!db) return;
    const col = db.collection('agent_tasks');

    // Mark completed tasks
    if (Array.isArray(parsed.completedTaskIds) && parsed.completedTaskIds.length > 0) {
        for (const id of parsed.completedTaskIds) {
            try {
                await col.updateOne(
                    { _id: new mongoose.Types.ObjectId(id), agentId },
                    { $set: { status: 'complete', completedAt: new Date() } }
                );
            } catch (_) {} // invalid id — skip
        }
    }

    // Create new tasks
    if (Array.isArray(parsed.newTasks) && parsed.newTasks.length > 0) {
        const PRIORITY_SCORE = { high: 3, medium: 2, low: 1 };
        const docs = parsed.newTasks
            .filter(t => t?.title)
            .slice(0, 5) // cap per tick
            .map(t => ({
                agentId,
                title: String(t.title).substring(0, 200),
                description: String(t.description || '').substring(0, 500),
                priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
                priorityScore: PRIORITY_SCORE[t.priority] || 2,
                status: 'pending',
                source: 'self',
                createdAt: new Date()
            }));
        if (docs.length > 0) await col.insertMany(docs);
    }
}

async function appendFindingToMemory(agentId, title, content) {
    const agent = await Agent.findById(agentId, 'memory.longTermMemory');
    if (!agent) return;
    const current = agent.memory.longTermMemory || '';
    const snippet = (content || '').replace(/\n+/g, ' ').substring(0, 350);
    const entry = `- [BG ${new Date().toLocaleDateString()}] **${title}**: ${snippet}`;
    const updated = current ? `${current}\n${entry}` : entry;
    // Trim to last 4000 chars to prevent unbounded growth
    const trimmed = updated.length > 4000 ? '…' + updated.slice(-3800) : updated;
    await Agent.findByIdAndUpdate(agentId, { $set: { 'memory.longTermMemory': trimmed } });
}

// ==================== BACKGROUND PROCESS ROUTES ====================

const router = express.Router();

router.get('/api/background/status', isAdmin, async (req, res) => {
    const processes = Array.from(backgroundProcesses.values()).map(p => ({
        agentId: p.agentId,
        agentName: p.agentName,
        startedAt: p.startedAt,
        lastRun: p.lastRun,
        runCount: p.runCount
    }));
    res.json({ success: true, processes });
});

router.post('/api/agents/:id/background/start', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        const io = req.app.get('io');
        const started = startBackgroundProcess(io, agent);
        if (!started) return res.json({ success: true, message: 'Already running' });

        await agent.addLog('info', `Background process started by ${req.user.displayName || req.user.email}`);
        res.json({ success: true, message: 'Background process started' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/api/agents/:id/background/stop', isAdmin, async (req, res) => {
    try {
        const io = req.app.get('io');
        const stopped = stopBackgroundProcess(io, req.params.id);
        if (!stopped) return res.json({ success: true, message: 'Not running' });

        const agent = await Agent.findById(req.params.id);
        if (agent) await agent.addLog('info', `Background process stopped by ${req.user.displayName || req.user.email}`);
        res.json({ success: true, message: 'Background process stopped' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/api/agents/:id/background/config', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        if (req.body.backgroundPrompt !== undefined) agent.config.backgroundPrompt = req.body.backgroundPrompt;
        if (req.body.backgroundInterval !== undefined) {
            agent.config.backgroundInterval = Math.max(1, Math.min(1440, parseInt(req.body.backgroundInterval) || 2));
        }
        await agent.save();

        // If process is running, restart it to pick up new interval
        const io = req.app.get('io');
        const wasRunning = backgroundProcesses.has(agent._id.toString());
        if (wasRunning) {
            stopBackgroundProcess(io, agent._id.toString());
            startBackgroundProcess(io, agent);
        }

        res.json({ success: true, backgroundPrompt: agent.config.backgroundPrompt, backgroundInterval: agent.config.backgroundInterval, restarted: wasRunning });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/api/agents/:id/background/tools', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        const tools = (req.body.tools || []).filter(t => MCP_TOOL_DEFINITIONS[t]);
        agent.mcpConfig.backgroundEnabledTools = tools;
        await agent.save();

        res.json({ success: true, backgroundEnabledTools: tools });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
