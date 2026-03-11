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

        // ── Inject due crons as pending tasks ──────────────────
        try {
            const db = mongoose.connection.db;
            if (db) {
                const dueCrons = await db.collection('agent_crons')
                    .find({ agentId, active: true, nextRun: { $lte: new Date() } })
                    .toArray();
                for (const cron of dueCrons) {
                    await db.collection('agent_tasks').insertOne({
                        agentId,
                        title: cron.title,
                        description: cron.content,
                        priority: 'medium',
                        priorityScore: 2,
                        status: 'pending',
                        source: 'cron',
                        createdAt: new Date()
                    });
                    await db.collection('agent_crons').updateOne(
                        { _id: cron._id },
                        { $set: { nextRun: new Date(Date.now() + cron.intervalMinutes * 60000), lastRun: new Date() } }
                    );
                }
            }
        } catch (_) {}

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

        // ── Obsession detection ────────────────────────────────
        const obsessionTopic = detectTopicRepetition(tickHistory);

        let reasoningCtx = '';
        if (tickHistory.length > 0) {
            const histLines = tickHistory.map((h, i) => {
                const ago = Math.round((Date.now() - new Date(h.timestamp)) / 60000);
                const idleFlag = h.idle ? ' [IDLE]' : '';
                return `  Tick ${i + 1} (${ago}m ago)${idleFlag}: "${h.title}" — ${(h.summary || '').substring(0, 100)}${h.nextFocus ? `\n    → Planned next: ${h.nextFocus}` : ''}`;
            }).join('\n');
            const productivityLine = `Productivity score: ${prod.score}/100 (${prod.activeTicks}/${prod.totalTicks} ticks produced findings).`;
            const stuckLine = stuck ? `\nWARNING: You have been idle for ${consecutiveIdle} consecutive ticks. Your current approach is NOT WORKING. You MUST change strategy and invent new tasks.` : '';
            const obsessionLine = obsessionTopic ? `\nOBSESSION DETECTED: You have repeated the topic "${obsessionTopic}" across multiple recent ticks. This topic is now BANNED for this tick. Explore a completely different area.` : '';
            reasoningCtx = `BRIEF — your last ${tickHistory.length} ticks:\n${histLines}\n\n${productivityLine}${stuckLine}${obsessionLine}\n\nDo NOT repeat topics from recent ticks. If you planned something, execute it now.`;
        }

        // ── Periodic bgFindings consolidation (every 4 active ticks) ──
        const activeTicks = prod.activeTicks || 0;
        if (activeTicks > 0 && activeTicks % 4 === 0) {
            consolidateBgFindings(agentId, agent, ollamaBaseUrl, ollamaApiKey)
                .then(() => dispatchSupportAgents(agentId, agent, 'prompt-cleaner', ollamaBaseUrl, ollamaApiKey))
                .catch(e => console.error(`[BG ${agentId}] Consolidation failed:`, e.message));
        }

        // ── Build directive ────────────────────────────────────
        const bgPrompt = agent.config.backgroundPrompt?.trim();
        let bgDirective;
        if (obsessionTopic && !bgPrompt && pendingTasks.length === 0) {
            // Hard redirect — break the obsession loop
            bgDirective = `${reasoningCtx}\n\nOBSESSION BREAK MODE: You have explored "${obsessionTopic}" too many times. You MUST explore a completely different area this tick. Do NOT mention "${obsessionTopic}".\nOutput JSON — newTasks encouraged:\n{"title":"<completely new topic>","content":"<finding>","pushToChat":false,"newTasks":[{"title":"...","description":"...","priority":"medium"}],"nextFocus":"<new direction unrelated to ${obsessionTopic}>","productivityNote":"breaking repetition loop"}`;
        } else if (bgPrompt) {
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
            { role: 'system', content: `You are: ${agent.name} (${agent.role}). Running as background process.\nYour agentId (MongoDB _id): ${agentId}\nTime: ${new Date().toLocaleString()}${bgRoster ? `\nOther agents:\n${bgRoster}` : ''}\n\nMEMORY RULES:\n- Your Knowledge Base, Background Research Log, and Long-term Memory are injected below as system messages. They are ALREADY LOADED.\n- Do NOT use mongo_find to look up your own KB or memory — it is already in your context.\n- The 'agents' collection contains AI agent configs ONLY, not knowledge about people, characters, or external entities. Searching it for a person's name will always fail.\n- To store new research findings: write to agent_notes collection via mongo_write, or output them in the JSON content field so they get saved to bgFindings.\n\n${bgDirective}\n\nOutput format: JSON object as described above, or exactly: null` }
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
            // Most recent KB entries, capped per-entry to avoid context bloat.
            // KB is embedded in the agents document — there is no separate agent_kb collection.
            // Do NOT use mongo_find to look for KB; it is already injected here.
            const kb = agent.memory.knowledgeBase.slice(-8).map(e => `[${e.type.toUpperCase()}] ${e.title}: ${e.content.substring(0, 200)}`).join('\n');
            messages.push({ role: 'system', content: `Knowledge Base (already loaded — do NOT query for this via mongo_find):\n${kb}` });
        }

        const reqBody = {
            model: agent.model,
            messages,
            temperature: agent.config.temperature,
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

        let res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, reqBody,
            { headers: ollamaHeaders, timeout: OLLAMA_TIMEOUT });

        // One round of tool execution if tools were called
        const assistantMsg = res.data.choices?.[0]?.message;
        if (toolDefs.length > 0 && assistantMsg?.tool_calls?.length > 0) {
            messages.push(assistantMsg);
            for (const toolCall of assistantMsg.tool_calls) {
                const toolName = toolCall.function.name;
                const toolArgs = typeof toolCall.function.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;
                let toolResult;
                try { toolResult = await executeMcpTool(toolName, toolArgs, agentId); }
                catch (err) { toolResult = { error: err.message }; }
                messages.push({ role: 'tool', tool_call_id: toolCall.id, content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult) });
            }
            res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
                model: agent.model, messages, temperature: agent.config.temperature, stream: false
            }, { headers: ollamaHeaders, timeout: OLLAMA_TIMEOUT });
        }

        const content = res.data.choices?.[0]?.message?.content?.trim();
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
                tokens: (res.data.usage?.completion_tokens || res.data.usage?.total_tokens || 0),
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

// ── Topic repetition detector ─────────────────────────────────────────────────
// Returns the dominant repeated topic if the last 4 non-idle ticks share a keyword,
// otherwise returns null.
function detectTopicRepetition(tickHistory) {
    const STOP_WORDS = new Set(['the','and','for','with','from','that','this','have','been','will','about','what','your','their','into','they','when','then','more','some','also','were','has','not','but','our','any','can','its','are','was','out','all','new','task','tick','idle','null','research','background','finding','based','using','update','review','analysis','check']);
    const recent = tickHistory.filter(h => !h.idle).slice(-4);
    if (recent.length < 3) return null;

    const wordSets = recent.map(h => {
        const words = (h.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
            .filter(w => w.length > 3 && !STOP_WORDS.has(w));
        return new Set(words);
    });

    // Find words that appear in 3+ of the last 4 non-idle ticks
    const allWords = [...wordSets.reduce((a, s) => new Set([...a, ...s]), new Set())];
    const repeated = allWords.filter(w => wordSets.filter(s => s.has(w)).length >= 3);
    return repeated.length > 0 ? repeated.slice(0, 3).join('/') : null;
}

// ── bgFindings consolidation ──────────────────────────────────────────────────
// Runs every 4 active ticks. Calls the LLM to:
//   1. Deduplicate + compress bgFindings into a clean summary
//   2. Identify 3 unexplored topic areas
//   3. Seed those as new pending tasks
async function consolidateBgFindings(agentId, agent, ollamaBaseUrl, ollamaApiKey) {
    if (!agent.memory?.bgFindings || agent.memory.bgFindings.length < 200) return;

    const prompt = `You are a research coordinator reviewing an agent's background research log. The agent has been looping and repeating topics.

BACKGROUND RESEARCH LOG:
${agent.memory.bgFindings.slice(-3000)}

Do three things:
1. Write a DEDUPLICATED SUMMARY of unique findings (max 1200 chars, bullet points, no repetition).
2. List 3 topic areas the agent has NOT yet explored based on its role: "${agent.role}".
3. For each unexplored area, write a concrete task.

Output JSON ONLY:
{
  "consolidatedSummary": "<deduplicated bullet-point summary>",
  "gaps": ["<area 1>", "<area 2>", "<area 3>"],
  "newTasks": [
    {"title": "...", "description": "...", "priority": "high|medium|low"},
    {"title": "...", "description": "...", "priority": "high|medium|low"},
    {"title": "...", "description": "...", "priority": "medium|low"}
  ]
}`;

    const res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
        model: agent.model,
        messages: [
            { role: 'system', content: 'You are a concise research coordinator. Output valid JSON only.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        stream: false
    }, { headers: { 'Authorization': `Bearer ${process.env.OLLAMA_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 90000 });

    const raw = res.data.choices?.[0]?.message?.content?.trim() || '';
    let parsed;
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (_) { return; }
    if (!parsed) return;

    // Replace bgFindings with deduplicated version + gap note
    if (parsed.consolidatedSummary) {
        const gapNote = parsed.gaps?.length ? `\n\n[Gaps identified — tasks created: ${parsed.gaps.join(', ')}]` : '';
        const newFindings = `[Consolidated ${new Date().toLocaleDateString()}]\n${parsed.consolidatedSummary}${gapNote}`;
        await Agent.findByIdAndUpdate(agentId, { $set: { 'memory.bgFindings': newFindings } });
        console.log(`[BG ${agentId}] bgFindings consolidated (${agent.memory.bgFindings.length} → ${newFindings.length} chars)`);
    }

    // Seed gap tasks
    if (Array.isArray(parsed.newTasks) && parsed.newTasks.length > 0) {
        const db = mongoose.connection.db;
        if (!db) return;
        const PRIORITY_SCORE = { high: 3, medium: 2, low: 1 };
        const docs = parsed.newTasks.filter(t => t?.title).map(t => ({
            agentId,
            title: String(t.title).substring(0, 200),
            description: String(t.description || '').substring(0, 500),
            priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
            priorityScore: PRIORITY_SCORE[t.priority] || 2,
            status: 'pending',
            source: 'consolidation',
            createdAt: new Date()
        }));
        if (docs.length > 0) await db.collection('agent_tasks').insertMany(docs);
        console.log(`[BG ${agentId}] Consolidation seeded ${docs.length} gap task(s)`);
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

// ── Support agent dispatcher ──────────────────────────────────────────────────
// Called after consolidation. Finds enabled support agents of the given role,
// sends them a structured task via chat-internal, then writes the result back
// to the target agent's field (systemPrompt for prompt-cleaner, bgFindings for others).
async function dispatchSupportAgents(agentId, agent, role, ollamaBaseUrl, ollamaApiKey) {
    const freshAgent = await Agent.findById(agentId, 'supportAgents config.systemPrompt memory.bgFindings memory.longTermMemory name role').lean();
    if (!freshAgent || !freshAgent.supportAgents?.length) return;

    const eligible = freshAgent.supportAgents.filter(s => s.enabled && s.role === role);
    if (!eligible.length) return;

    for (const support of eligible) {
        try {
            const supportAgent = await Agent.findById(support.agentId, 'name model config.systemPrompt config.temperature').lean();
            if (!supportAgent) continue;

            let taskMessage = '';
            if (role === 'prompt-cleaner') {
                taskMessage = `You are performing a background maintenance task for agent "${freshAgent.name}" (${freshAgent.role}).

CURRENT SYSTEM PROMPT:
${freshAgent.config.systemPrompt}

RECENT BACKGROUND FINDINGS (context about what this agent has learned):
${(freshAgent.memory.bgFindings || '').slice(-1500)}

Your task: Rewrite the system prompt to be tighter, clearer, and reflect what this agent has actually been doing and learning. Remove bloat, fix contradictions, sharpen the persona. Do NOT add guardrails or restrictions unless they were already present.

Output JSON only:
{"revisedPrompt": "<the improved system prompt>", "changesSummary": "<1-2 sentences: what you changed and why>"}`;
            } else if (role === 'kb-curator') {
                taskMessage = `Curate the knowledge base for agent "${freshAgent.name}". Review the following long-term memory and background findings, then identify which entries are stale, redundant, or should be promoted to permanent KB.

LONG-TERM MEMORY:
${freshAgent.memory.longTermMemory || '(empty)'}

BACKGROUND FINDINGS:
${(freshAgent.memory.bgFindings || '').slice(-1500)}

Output JSON only:
{"curationNotes": "<what you found>", "suggestedRemovals": ["<entry title>"], "suggestedPromotions": [{"title": "...", "content": "..."}]}`;
            }

            if (!taskMessage) continue;

            const res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
                model: supportAgent.model,
                messages: [
                    { role: 'system', content: supportAgent.config.systemPrompt },
                    { role: 'user', content: taskMessage }
                ],
                temperature: supportAgent.config.temperature ?? 0.3,
                stream: false
            }, {
                headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' },
                timeout: 120000
            });

            const raw = res.data.choices?.[0]?.message?.content?.trim() || '';
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) continue;
            const parsed = JSON.parse(jsonMatch[0]);

            if (role === 'prompt-cleaner' && parsed.revisedPrompt) {
                await Agent.findByIdAndUpdate(agentId, {
                    $set: { 'config.systemPrompt': parsed.revisedPrompt },
                    $push: { 'tuning.systemPromptHistory': { prompt: freshAgent.config.systemPrompt, timestamp: new Date() } }
                });
                console.log(`[BG ${agentId}] Prompt cleaned by support agent "${supportAgent.name}": ${parsed.changesSummary}`);
                // Log on the target agent
                const targetAgentDoc = await Agent.findById(agentId);
                if (targetAgentDoc) await targetAgentDoc.addLog('info', `System prompt cleaned by support agent "${supportAgent.name}": ${parsed.changesSummary}`);
            }
        } catch (e) {
            console.error(`[BG ${agentId}] Support agent dispatch (${role}) failed:`, e.message);
        }
    }
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

router.get('/api/agents/:id/context-debug', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id,
            'name role model bgTickHistory bgProductivity config.backgroundInterval config.backgroundRunning memory.conversations memory.threadSummary memory.longTermMemory memory.bgFindings memory.knowledgeBase'
        ).lean();
        if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

        const recentActions = await AgentAction.find({ agentId: req.params.id })
            .sort({ createdAt: -1 }).limit(10).lean();

        res.json({
            success: true,
            agentName: agent.name,
            backgroundInterval: agent.config?.backgroundInterval ?? 2,
            backgroundRunning: agent.config?.backgroundRunning ?? false,
            bgTickHistory: (agent.bgTickHistory || []).slice(-10).reverse(),
            bgProductivity: agent.bgProductivity || {},
            conversations: (agent.memory?.conversations || []).slice(-10).reverse(),
            threadSummary: agent.memory?.threadSummary || '',
            longTermMemory: agent.memory?.longTermMemory || '',
            bgFindings: (agent.memory?.bgFindings || '').slice(-2000),
            knowledgeBase: (agent.memory?.knowledgeBase || []).slice(-8),
            recentActions
        });
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
