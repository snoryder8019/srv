import express from "express";
import axios from "axios";
import mongoose from "mongoose";

import Agent from "../../api/v1/models/Agent.js";
import AgentAction from "../../api/v1/models/AgentAction.js";
import { emitActionNew, emitBackgroundStatus, emitAgentPush } from "../../plugins/socket/agents.js";
import { MCP_TOOL_DEFINITIONS, executeMcpTool } from "./mcp.js";
import { isAdmin } from "./middleware.js";
import { buildTaskDoc, insertTasksCapped } from "./task-helpers.js";

const mkOllamaHeaders = (apiKey) => ({
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
});

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

// ── Researcher-specific directive builder ─────────────────────────────────────
// Determines tick phase from memory state to avoid redundant research loops:
//   synthesis  — context already loaded; derive conclusions + gaps (no tool calls)
//   targeted   — pending tasks exist; answer specific questions against loaded context or tools
//   exploration — no context yet; pick ONE concrete topic and investigate it
function buildResearcherDirective(agent, pendingTasks, reasoningCtx, toolDefs, stuck) {
    const findings = agent.memory.bgFindings || '';
    const kb = agent.memory.knowledgeBase || [];
    const longTerm = agent.memory.longTermMemory || '';
    const hasFindings = findings.length > 300;
    const hasKB = kb.length > 0;
    const hasContext = hasFindings || hasKB || longTerm.length > 100;
    const ctx = reasoningCtx ? `${reasoningCtx}\n\n` : '';

    const JSON_SCHEMA = `{"title":"...","content":"<finding or synthesis>","pushToChat":true|false,"newTasks":[{"title":"...","description":"...","priority":"high|medium|low"}],"nextFocus":"<one specific question for next tick>","productivityNote":"<one sentence>"}`;

    // ── Phase: pending tasks — answer them ────────────────────────
    if (pendingTasks.length > 0) {
        const task = pendingTasks[0]; // highest priority
        const rest = pendingTasks.slice(1).map((t, i) =>
            `${i + 2}. [${(t.priority || 'medium').toUpperCase()}] ${t.title}`
        ).join('\n');
        return `${ctx}RESEARCH TASK MODE — address the top task using context already loaded above. Do NOT re-fetch data you already have in memory.\n\nTop task (id: ${task._id}):\n[${(task.priority || 'medium').toUpperCase()}] ${task.title}${task.description ? ': ' + task.description : ''}\n${rest ? `\nQueued: \n${rest}` : ''}\n\nSteps:\n1. Check your Background Research Log and Knowledge Base (already injected above) for relevant data.\n2. ${toolDefs.length > 0 ? 'Only use a tool if the answer is NOT in your loaded context.' : 'Synthesize an answer from your loaded context.'}\n3. If you cannot answer without human input, set "question":true.\n\nIMPORTANT: If a task requires human input or a real-world action you cannot perform autonomously, set "question":true. Do NOT pretend to complete it.\n\nOutput JSON:\n{"title":"Task: <what you resolved>","content":"<result or question>","pushToChat":true,"question":true|false,"completedTaskIds":["${task._id}"],"newTasks":[],"nextFocus":"<next task or gap>","productivityNote":"<one sentence>"}\nOnly include completedTaskIds if actually finished.`;
    }

    // ── Phase: synthesis — derive conclusions from loaded context ──
    if (hasContext && !stuck) {
        const kbSummary = kb.length > 0
            ? `\nKB entries loaded: ${kb.length} (${kb.map(e => e.title).join(', ')})`
            : '';
        const findingLen = findings.length;
        return `${ctx}SYNTHESIS MODE — your Background Research Log (${findingLen} chars) and Knowledge Base are already loaded above. DO NOT fetch new data this tick.\n${kbSummary}\n\nYour job this tick:\n1. Read the loaded context carefully.\n2. Identify 2-3 CONTRADICTIONS, GAPS, or UNANSWERED QUESTIONS in what you already know.\n3. Derive 1-2 concrete CONCLUSIONS or INSIGHTS that follow from the evidence.\n4. For each gap, create a specific task with a clear question to answer.\n\nDo NOT summarize what you already wrote. Push conclusions forward — what does the evidence MEAN?\n\nOutput JSON:\n${JSON_SCHEMA}\nnewTasks REQUIRED (2+ items — one per gap). nextFocus = the most important unanswered question.\nIf context is thin and you have nothing to synthesize: {"title":"idle","content":"insufficient context","nextFocus":"<first topic to research>","productivityNote":"seeding first research tick"}`;
    }

    // ── Phase: exploration — no context yet or stuck; pick ONE topic ──
    const toolHint = toolDefs.length > 0
        ? 'Use ONE tool call to gather initial data on this topic.'
        : 'Reason from your system prompt and role — write what you know and what you need to find out.';
    const stuckNote = stuck
        ? 'STUCK RECOVERY: Your recent approach has not produced findings. Pick a completely different topic from your role/system prompt.\n\n'
        : '';
    return `${ctx}${stuckNote}EXPLORATION MODE — no substantial context loaded yet. Pick ONE specific topic directly from your role and system prompt. Do NOT pick a vague topic like "general research".\n\n${toolHint}\n\nRules:\n- One topic, one investigation this tick.\n- Output a concrete finding, not a plan.\n- Create 2+ follow-up tasks for what you did NOT cover.\n\nOutput JSON:\n${JSON_SCHEMA}\nnewTasks REQUIRED (2+ follow-up questions). nextFocus = the most important follow-up.`;
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
                    await db.collection('agent_tasks').insertOne(
                        buildTaskDoc(agentId, { title: cron.title, description: cron.content, priority: 'medium' }, 'cron')
                    );
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
        let allAgents = [];
        try {
            allAgents = await Agent.find({}, 'name role status tier').lean();
            const isApex = agent.tier === 'apex';
            bgRoster = allAgents
                .filter(a => a._id.toString() !== agentId)
                .map(a => isApex
                    ? `  - ${a._id} | ${a.name} [${a.role}] (${a.status})`
                    : `  - ${a.name} [${a.role}] (${a.status})`)
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
            let directive = (reasoningCtx ? `${reasoningCtx}\n\n` : '') + bgPrompt;
            if (pendingTasks.length > 0) {
                const taskList = pendingTasks.map((t, i) =>
                    `${i + 1}. [${(t.priority || 'medium').toUpperCase()}] ${t.title}${t.description ? ': ' + t.description : ''} (id: ${t._id})`
                ).join('\n');
                directive += `\n\nYou also have ${pendingTasks.length} pending task(s) — address at least one this tick:\n${taskList}\nOutput JSON with "completedTaskIds":["<id>"] for any tasks you finish.`;
            }
            bgDirective = directive;
        } else if (agent.role === 'researcher') {
            bgDirective = buildResearcherDirective(agent, pendingTasks, reasoningCtx, toolDefs, stuck);
        } else if (pendingTasks.length > 0) {
            const taskList = pendingTasks.map((t, i) =>
                `${i + 1}. [${(t.priority || 'medium').toUpperCase()}] ${t.title}${t.description ? ': ' + t.description : ''} (id: ${t._id})`
            ).join('\n');
            bgDirective = `${reasoningCtx ? reasoningCtx + '\n\n' : ''}You have ${pendingTasks.length} pending task(s):\n${taskList}\n\n${toolDefs.length > 0 ? 'Use your tools to complete the task.' : ''}\nWork on the highest priority task.\n\nIMPORTANT: If a task requires human input, a real-world decision, or an action you cannot perform autonomously (e.g. writing code, making a purchase, contacting someone), set "question":true and ask the human directly in "content". Do NOT pretend to complete it. The task will be paused until they reply in chat.\n\nOutput JSON:\n{"title":"Task: <what you did or asked>","content":"<detailed result, OR your question to the human>","pushToChat":true,"question":true|false,"completedTaskIds":["<id>"],"newTasks":[{"title":"...","description":"...","priority":"high|medium|low"}],"nextFocus":"<next concrete step>","productivityNote":"<one sentence>"}\nOnly include completedTaskIds if you actually finished a task. If question:true, do NOT include completedTaskIds.`;
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

        const ollamaHeaders = mkOllamaHeaders(ollamaApiKey);
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
            try { parsed = JSON.parse(content); } catch {
                // Model sometimes outputs prose/preamble before the JSON — try to extract it
                let extracted = null;
                const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (codeBlock) { try { extracted = JSON.parse(codeBlock[1].trim()); } catch {} }
                if (!extracted) {
                    const jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) { try { extracted = JSON.parse(jsonMatch[0]); } catch {} }
                }
                parsed = extracted || { title: 'Background insight', content };
            }

            const isIdle = parsed.title === 'idle';

            // ── Question mode: agent needs human input ─────────────────
            if (parsed.question === true && pendingTasks.length > 0) {
                const questionTask = pendingTasks[0]; // highest priority task that triggered the question
                try {
                    const db = mongoose.connection.db;
                    if (db) {
                        await db.collection('agent_tasks').updateOne(
                            { _id: questionTask._id },
                            { $set: { status: 'needs_human', questionAsked: parsed.content, askedAt: new Date() } }
                        );
                    }
                    // Inject into conversation history so the chat route picks it up as context
                    await Agent.findByIdAndUpdate(agentId, {
                        $push: {
                            'memory.conversations': {
                                userMessage: `[Task] ${questionTask.title}`,
                                agentResponse: parsed.content,
                                tokenCount: 0,
                                timestamp: new Date()
                            }
                        }
                    });
                } catch (e) {
                    console.error(`[BG ${agentId}] needs_human update failed:`, e.message);
                }
            }

            // ── Dedup: if same title was saved within 2× interval, update instead of insert ──
            const dedupWindowMs = (agent.config.backgroundInterval || 2) * 2 * 60 * 1000;
            const dedupCutoff = new Date(Date.now() - dedupWindowMs);
            const existingAction = !isIdle && await AgentAction.findOne({
                agentId, type: 'background',
                title: parsed.title || 'Background insight',
                createdAt: { $gte: dedupCutoff }
            }).sort({ createdAt: -1 });

            let action;
            if (existingAction) {
                existingAction.content = parsed.content || content;
                existingAction.tokens += (res.data.usage?.completion_tokens || res.data.usage?.total_tokens || 0);
                existingAction.updatedAt = new Date();
                await existingAction.save();
                action = existingAction;
            } else {
                action = new AgentAction({
                    agentId,
                    type: 'background',
                    title: parsed.title || 'Background insight',
                    content: parsed.content || content,
                    tokens: (res.data.usage?.completion_tokens || res.data.usage?.total_tokens || 0),
                    status: 'complete'
                });
                if (!isIdle) await action.save();
            }
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
    }, { headers: mkOllamaHeaders(process.env.OLLAMA_API_KEY), timeout: 90000 });

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

    // Seed gap tasks — only if under the per-agent cap
    if (Array.isArray(parsed.newTasks) && parsed.newTasks.length > 0) {
        const db = mongoose.connection.db;
        if (!db) return;
        const n = await insertTasksCapped(db.collection('agent_tasks'), agentId, parsed.newTasks, 'consolidation');
        if (n > 0) console.log(`[BG ${agentId}] Consolidation seeded ${n} gap task(s)`);
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

    // Create new tasks — only if under the per-agent cap
    if (Array.isArray(parsed.newTasks) && parsed.newTasks.length > 0) {
        await insertTasksCapped(col, agentId, parsed.newTasks.slice(0, 5), 'self');
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
        }, { headers: mkOllamaHeaders(ollamaApiKey) });
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
            }, { headers: mkOllamaHeaders(ollamaApiKey), timeout: 120000 });

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
