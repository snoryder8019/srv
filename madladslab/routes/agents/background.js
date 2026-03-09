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
    Agent.findByIdAndUpdate(agentId, { $set: { 'config.backgroundRunning': true } }).catch(() => {});
    return true;
}

export function stopBackgroundProcess(io, agentId) {
    const proc = backgroundProcesses.get(agentId);
    if (!proc) return false;
    clearInterval(proc.intervalId);
    backgroundProcesses.delete(agentId);
    if (io) emitBackgroundStatus(io, agentId, 'stopped', {});
    Agent.findByIdAndUpdate(agentId, { $set: { 'config.backgroundRunning': false } }).catch(() => {});
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

        // ── Productivity briefing ──────────────────────────────
        const prod = agent.bgProductivity || { score: 50, consecutiveIdle: 0, totalTicks: 0, activeTicks: 0 };
        const tickHistory = (agent.bgTickHistory || []).slice(-6);
        const consecutiveIdle = prod.consecutiveIdle || 0;
        const stuck = consecutiveIdle >= 2; // 2+ idle ticks = stuck, invent tasks

        let reasoningCtx = '';
        if (tickHistory.length > 0) {
            const histLines = tickHistory.map((h, i) => {
                const ago = Math.round((Date.now() - new Date(h.timestamp)) / 60000);
                const idleFlag = h.idle ? ' [IDLE]' : '';
                return `  Tick ${i + 1} (${ago}m ago)${idleFlag}: "${h.title}" — ${(h.summary || '').substring(0, 100)}${h.nextFocus ? `\n    → Planned next: ${h.nextFocus}` : ''}`;
            }).join('\n');
            const productivityLine = `Productivity score: ${prod.score}/100 (${prod.activeTicks}/${prod.totalTicks} ticks produced findings).`;
            const stuckLine = stuck ? `\nWARNING: You have been idle for ${consecutiveIdle} consecutive ticks. Your current approach is NOT WORKING. You MUST change strategy and invent new tasks.` : '';
            reasoningCtx = `BRIEF — your last ${tickHistory.length} ticks:\n${histLines}\n\n${productivityLine}${stuckLine}\n\nDo NOT repeat topics from recent ticks. If you planned something, execute it now.`;
        }

        // ── Build directive ────────────────────────────────────
        const bgPrompt = agent.config.backgroundPrompt?.trim();
        let bgDirective;
        if (bgPrompt) {
            bgDirective = (reasoningCtx ? `${reasoningCtx}\n\n` : '') + bgPrompt;
        } else if (pendingTasks.length > 0) {
            const taskList = pendingTasks.map((t, i) =>
                `${i + 1}. [${(t.priority || 'medium').toUpperCase()}] ${t.title}${t.description ? ': ' + t.description : ''} (id: ${t._id})`
            ).join('\n');
            bgDirective = `${reasoningCtx ? reasoningCtx + '\n\n' : ''}You have ${pendingTasks.length} pending task(s):\n${taskList}\n\n${toolDefs.length > 0 ? 'Use your tools to complete the task.' : ''}\nWork on the highest priority task. Output JSON:\n{"title":"Task: <what you did>","content":"<detailed result>","pushToChat":true|false,"completedTaskIds":["<id>"],"newTasks":[{"title":"...","description":"...","priority":"high|medium|low"}],"nextFocus":"<next concrete step>","productivityNote":"<one sentence: what worked or why you changed approach>"}\nOnly include completedTaskIds if you actually finished a task.`;
        } else if (stuck) {
            // Task invention mode — all memory context already injected as system messages above
            bgDirective = `${reasoningCtx}\n\nTASK INVENTION MODE: You have been idle. Review your Background Research Log and Chat Memory (injected above) — find gaps. Invent 2+ tasks you have NOT yet done.\n${toolDefs.length > 0 ? 'Use a tool to verify something before inventing tasks.' : ''}\nOutput JSON — newTasks REQUIRED with 2+ items:\n{"title":"Task Invention: <topic>","content":"<rationale>","pushToChat":false,"newTasks":[{"title":"...","description":"...","priority":"high|medium"},{"title":"...","description":"...","priority":"medium"}],"nextFocus":"<first task you will execute next tick>","productivityNote":"<what you will change>"}`;
        } else {
            // Generic autonomous tick — all memory context already injected as system messages above
            bgDirective = `${reasoningCtx ? reasoningCtx + '\n\n' : ''}Act autonomously based on your role, system prompt, and the memory context injected above.\n${toolDefs.length > 0 ? 'Use your tools to investigate.' : 'Reflect on your role and responsibilities.'}\nOutput JSON:\n{"title":"...","content":"<your finding>","pushToChat":true|false,"newTasks":[{"title":"...","description":"...","priority":"high|medium|low"}],"nextFocus":"<specific thing you will check next tick>","productivityNote":"<one sentence: what you found or why it matters>"}\nnewTasks optional but encouraged. nextFocus REQUIRED.\nIf nothing to report: {"title":"idle","content":"nothing to report","nextFocus":"<what you will check next>","productivityNote":"changing approach next tick"}`;
        }

        const messages = [
            { role: 'system', content: agent.config.systemPrompt },
            { role: 'system', content: `You are: ${agent.name} (${agent.role}). Running as background process.\nTime: ${new Date().toLocaleString()}${bgRoster ? `\nOther agents:\n${bgRoster}` : ''}\n\n${bgDirective}\n\nOutput format: JSON object as described above, or exactly: null` }
        ];

        // ── Inject memory context (separated to avoid collision with chat) ──
        if (agent.memory.threadSummary) {
            messages.push({ role: 'system', content: `Chat Thread Summary (from user sessions):\n${agent.memory.threadSummary}` });
        }
        if (agent.memory.longTermMemory) {
            messages.push({ role: 'system', content: `Chat Memory (tasks & decisions from user conversations):\n${agent.memory.longTermMemory}` });
        }
        if (agent.memory.bgFindings) {
            // Background findings: your own autonomous research, separate from chat memory
            messages.push({ role: 'system', content: `Background Research Log (your autonomous findings — do not repeat these):\n${agent.memory.bgFindings.slice(-2000)}` });
        }
        if (agent.memory.knowledgeBase?.length > 0) {
            // Most recent KB entries, capped per-entry to avoid context bloat
            const kb = agent.memory.knowledgeBase.slice(-8).map(e => `[${e.type.toUpperCase()}] ${e.title}: ${e.content.substring(0, 200)}`).join('\n');
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

            const isIdle = parsed.title === 'idle';
            const action = new AgentAction({
                agentId,
                type: 'background',
                title: parsed.title || 'Background insight',
                content: parsed.content || content,
                tokens: (res.data.eval_count || 0),
                status: 'complete'
            });
            if (!isIdle) await action.save();
            if (!isIdle && io) emitActionNew(io, agentId, action.toObject());
            if (!isIdle && io && parsed.pushToChat !== false) {
                emitAgentPush(io, agentId, {
                    type: 'background',
                    title: action.title,
                    content: action.content,
                    actionId: action._id.toString()
                });
            }
            if (!isIdle) await agent.addLog('info', `Background finding: ${action.title}`);
            if (!isIdle) processTaskOperations(agentId, parsed).catch(e => console.error(`[BG ${agentId}] Task ops failed:`, e.message));
            if (!isIdle) appendFindingToMemory(agentId, action.title, action.content).catch(e => console.error(`[BG ${agentId}] Memory append failed:`, e.message));

            // Update reasoning stack + productivity score
            appendTickHistory(agentId, action.title, action.content, parsed.nextFocus || '', isIdle)
                .catch(e => console.error(`[BG ${agentId}] Tick history failed:`, e.message));
            updateProductivityScore(agentId, isIdle)
                .catch(e => console.error(`[BG ${agentId}] Productivity update failed:`, e.message));
        }

        const freshProd = await Agent.findById(agentId, 'bgProductivity').lean().catch(() => null);
        if (io) emitBackgroundStatus(io, agentId, 'tick', {
            lastRun: proc.lastRun,
            runCount: proc.runCount,
            pendingTasks: pendingTasks.length,
            productivityScore: freshProd?.bgProductivity?.score ?? 50,
            consecutiveIdle: freshProd?.bgProductivity?.consecutiveIdle ?? 0
        });
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

async function appendTickHistory(agentId, title, content, nextFocus, idle = false) {
    const summary = (content || '').replace(/\n+/g, ' ').substring(0, 150);
    const entry = { timestamp: new Date(), title: (title || '').substring(0, 100), summary, nextFocus: (nextFocus || '').substring(0, 200), idle };
    await Agent.findByIdAndUpdate(agentId, {
        $push: { bgTickHistory: { $each: [entry], $slice: -10 } }
    });
}

async function updateProductivityScore(agentId, isIdle) {
    const agent = await Agent.findById(agentId, 'bgProductivity');
    if (!agent) return;
    const p = agent.bgProductivity || { score: 50, consecutiveIdle: 0, totalTicks: 0, activeTicks: 0 };
    p.totalTicks = (p.totalTicks || 0) + 1;
    if (isIdle) {
        p.consecutiveIdle = (p.consecutiveIdle || 0) + 1;
    } else {
        p.activeTicks = (p.activeTicks || 0) + 1;
        p.consecutiveIdle = 0;
    }
    // Score = weighted rolling avg: active ratio × 100, dampened toward 50 on first few ticks
    const rawScore = p.totalTicks > 0 ? Math.round((p.activeTicks / p.totalTicks) * 100) : 50;
    p.score = p.totalTicks < 4 ? Math.round((rawScore + 50) / 2) : rawScore;
    await Agent.findByIdAndUpdate(agentId, { $set: { bgProductivity: p } });
}

async function appendFindingToMemory(agentId, title, content) {
    // Writes to bgFindings — isolated from chat's longTermMemory to prevent collision
    const agent = await Agent.findById(agentId, 'memory.bgFindings bgProductivity');
    if (!agent) return;
    const current = agent.memory.bgFindings || '';
    const snippet = (content || '').replace(/\n+/g, ' ').substring(0, 300);
    const entry = `- [${new Date().toLocaleDateString()}] **${title}**: ${snippet}`;
    const updated = current ? `${current}\n${entry}` : entry;
    const trimmed = updated.length > 5000 ? '…' + updated.slice(-4800) : updated;
    await Agent.findByIdAndUpdate(agentId, { $set: { 'memory.bgFindings': trimmed } });

    // Auto-extract KB entry every 5 active ticks
    const activeTicks = agent.bgProductivity?.activeTicks || 0;
    if (activeTicks > 0 && activeTicks % 5 === 0) {
        extractBgKnowledge(agentId).catch(() => {});
    }
}

async function extractBgKnowledge(agentId) {
    const agent = await Agent.findById(agentId, 'memory.bgFindings memory.knowledgeBase model');
    if (!agent || !agent.memory.bgFindings) return;
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
    const ollamaApiKey = process.env.OLLAMA_API_KEY;
    try {
        const res = await (await import('axios')).default.post(`${ollamaBaseUrl}/v1/chat/completions`, {
            model: agent.model,
            messages: [
                { role: 'system', content: 'You are a knowledge distiller. Extract the 3-5 most important reusable facts, patterns, or conclusions from the following background research log. Be concise, factual, no preamble.' },
                { role: 'user', content: agent.memory.bgFindings.slice(-2000) }
            ],
            temperature: 0.2,
            stream: false
        }, { headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' } });
        const distilled = res.data.choices?.[0]?.message?.content || '';
        if (distilled && distilled.length > 20) {
            await Agent.findByIdAndUpdate(agentId, {
                $push: { 'memory.knowledgeBase': {
                    type: 'context',
                    title: `BG Research Digest (${new Date().toLocaleDateString()})`,
                    content: distilled,
                    addedAt: new Date()
                }}
            });
        }
    } catch (_) {}
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

export async function resumeBackgroundProcesses(io) {
    try {
        const agents = await Agent.find({ 'config.backgroundRunning': true });
        if (!agents.length) return;
        console.log(`[BG] Resuming ${agents.length} background process(es) after restart`);
        for (const agent of agents) {
            startBackgroundProcess(io, agent);
        }
    } catch (err) {
        console.error('[BG] Failed to resume background processes:', err.message);
    }
}

export default router;
