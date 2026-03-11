import express from "express";
import axios from "axios";

import Agent from "../../api/v1/models/Agent.js";
import AgentAction from "../../api/v1/models/AgentAction.js";
import { emitMemoryUpdate, emitToolCall, emitToolResult, emitActionNew } from "../../plugins/socket/agents.js";
import { MCP_TOOL_DEFINITIONS, executeMcpTool } from "./mcp.js";
import { isAdmin, runResearcherMiddleware, runVibecoderMiddleware } from "./middleware.js";

const router = express.Router();

// Per-agent rate limit: prevent stacked LLM calls if a request is already in flight
const chatInFlight = new Map(); // agentId -> timestamp of last request start

// Chat with agent (agentic loop with MCP tool support)
router.post('/api/agents/:id/chat', isAdmin, async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }

        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        // Rate guard: reject if a request for this agent is already in flight
        const agentIdStr = req.params.id;
        if (chatInFlight.has(agentIdStr)) {
            return res.status(429).json({ success: false, error: 'Agent is already processing a message — please wait' });
        }
        chatInFlight.set(agentIdStr, Date.now());

        agent.status = 'running';
        await agent.save();

        const generatedImages = [];
        const toolCallsLog = [];
        const io = req.app.get('io');

        try {
            const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
            const ollamaApiKey = process.env.OLLAMA_API_KEY;

            // Build message history: system prompt + session context + knowledge base + recent convos + new message
            const messages = [{ role: 'system', content: agent.config.systemPrompt }];

            // Inject live session context — user identity, agent roster, current time
            try {
                const allAgents = await Agent.find({}, 'name role status').lean();
                const roster = allAgents
                    .filter(a => a._id.toString() !== agent._id.toString())
                    .map(a => `  - ${a.name} [${a.role}] (${a.status})`)
                    .join('\n');
                const userName = req.user.displayName || req.user.email || 'Unknown user';
                let ctx = `Session context:\n- You are: ${agent.name} (${agent.role})\n- Your agentId (MongoDB _id): ${agent._id}\n- Speaking with: ${userName}\n- Time: ${new Date().toLocaleString()}\n- IMPORTANT: Your Knowledge Base, Thread Summary, Long-term Memory, and Background Research are already injected below as system messages. Do NOT use mongo_find to search for your own KB or memory — it is already here. The 'agents' collection contains agent configs, NOT general knowledge about people or entities.`;
                if (roster) ctx += `\n- Other agents:\n${roster}`;
                messages.push({ role: 'system', content: ctx });
            } catch (_) {}

            // ── Inject all memory layers ──────────────────────────────
            if (agent.memory.threadSummary) {
                messages.push({ role: 'system', content: `Thread Summary (what we have worked on so far):\n${agent.memory.threadSummary}` });
            }
            if (agent.memory.longTermMemory) {
                messages.push({ role: 'system', content: `Your Notes (tasks, decisions, next steps from our conversations):\n${agent.memory.longTermMemory}` });
            }
            if (agent.memory.bgFindings) {
                // Background research done autonomously — inject last 1500 chars so it doesn't dominate
                messages.push({ role: 'system', content: `Background Research (what you found while running autonomously — can be referenced in responses):\n${agent.memory.bgFindings.slice(-1500)}` });
            }
            if (agent.memory.knowledgeBase?.length > 0) {
                // Cap per-entry at 300 chars to keep context manageable; most recent 12 entries
                const kb = agent.memory.knowledgeBase.slice(-12)
                    .map(e => `[${e.type.toUpperCase()}] ${e.title}:\n${e.content.substring(0, 300)}`)
                    .join('\n\n');
                messages.push({ role: 'system', content: `Knowledge Base (already loaded — do NOT query for this via mongo_find):\n${kb}` });
            }

            const recentConvos = (agent.memory.conversations || []).slice(-10);
            for (const conv of recentConvos) {
                messages.push({ role: 'user', content: conv.userMessage });
                messages.push({ role: 'assistant', content: conv.agentResponse });
            }

            messages.push({ role: 'user', content: message });

            let finalResponse = null;
            let totalTokens = 0;
            const MAX_ITERATIONS = 10;
            let toolCallCounter = 0;

            // Role-based middleware pipeline — run before the main LLM loop
            try {
                if (agent.role === 'researcher') {
                    const mwAction = await runResearcherMiddleware(agent, message, ollamaBaseUrl, ollamaApiKey);
                    totalTokens += mwAction.tokens;
                    messages.push({ role: 'system', content: `Research TLDR (pre-processing):\n${mwAction.content}` });
                    if (io) emitActionNew(io, agent._id.toString(), mwAction.toObject());
                } else if (agent.role === 'vibecoder') {
                    const mwAction = await runVibecoderMiddleware(agent, message, ollamaBaseUrl, ollamaApiKey);
                    totalTokens += mwAction.tokens;
                    messages.push({ role: 'system', content: `Task breakdown (pre-processing):\n${mwAction.content}` });
                    if (io) emitActionNew(io, agent._id.toString(), mwAction.toObject());
                }
            } catch (mwErr) {
                await agent.addLog('warning', `Middleware failed: ${mwErr.message}`);
            }

            // Build Ollama tool list from agent's enabled MCP tools
            const enabledTools = (agent.mcpConfig?.enabledTools || [])
                .map(name => MCP_TOOL_DEFINITIONS[name])
                .filter(Boolean);

            // Intent intercept: fire generate_image directly if the model won't tool-call reliably
            let imageIntercepFired = false;
            const imageToolEnabled = (agent.mcpConfig?.enabledTools || []).includes('generate-image');
            if (imageToolEnabled) {
                const imgMatch = message.match(/\b(?:generate|create|draw|paint|render|make|show)\s+(?:an?\s+)?(?:image|picture|photo|illustration|artwork|drawing|painting|render)\s+(?:of\s+)?(.+)/i)
                    || message.match(/\b(?:generate|create|draw|paint|render|imagine)\s+(.+)/i);
                if (imgMatch) {
                    imageIntercepFired = true;
                    const prompt = imgMatch[1].trim();
                    const callId = `${Date.now()}-intent`;
                    await agent.addLog('info', `Intent intercept: generate_image(${JSON.stringify({ prompt })})`);
                    if (io) emitToolCall(io, agent._id.toString(), { callId, tool: 'generate_image', args: { prompt } });
                    try {
                        const toolResult = await executeMcpTool('generate_image', { prompt });
                        if (io) emitToolResult(io, agent._id.toString(), { callId, tool: 'generate_image', success: true });
                        if (toolResult?.url) {
                            generatedImages.push({ url: toolResult.url, markdown: toolResult.markdown, prompt });
                            messages.push({ role: 'system', content: `You just generated an image for the user. The image is available at: ${toolResult.url}\nDisplay it using this exact markdown: ${toolResult.markdown}\nTell the user their image is ready and include the markdown in your response.` });
                        }
                    } catch (err) {
                        await agent.addLog('warning', `Intent intercept generate_image failed: ${err.message}`);
                        if (io) emitToolResult(io, agent._id.toString(), { callId, tool: 'generate_image', success: false, error: err.message });
                        messages.push({ role: 'system', content: `Image generation failed: ${err.message}. Let the user know.` });
                    }
                }
            }

            // Agentic loop — keep calling Ollama until we get a text response
            for (let i = 0; i < MAX_ITERATIONS && !finalResponse; i++) {
                const payload = {
                    model: agent.model,
                    messages,
                    temperature: agent.config.temperature,
                    max_tokens: agent.config.contextWindow || 4096,
                    stream: false
                };

                const activeTools = imageIntercepFired
                    ? enabledTools.filter(t => t.function?.name !== 'generate_image')
                    : enabledTools;
                if (activeTools.length > 0) payload.tools = activeTools;

                const ollamaRes = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, payload, {
                    headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' }
                });

                totalTokens += ollamaRes.data.usage?.completion_tokens || ollamaRes.data.usage?.total_tokens || 0;
                const assistantMsg = ollamaRes.data.choices?.[0]?.message;

                if (assistantMsg?.tool_calls?.length > 0) {
                    messages.push(assistantMsg);

                    for (const toolCall of assistantMsg.tool_calls) {
                        const toolName = toolCall.function.name;
                        const toolArgs = typeof toolCall.function.arguments === 'string'
                            ? JSON.parse(toolCall.function.arguments)
                            : toolCall.function.arguments;

                        const callId = `${Date.now()}-${toolCallCounter++}`;

                        await agent.addLog('info', `Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);

                        if (io) emitToolCall(io, agent._id.toString(), { callId, tool: toolName, args: toolArgs });

                        let toolResult;
                        try {
                            toolResult = await executeMcpTool(toolName, toolArgs, agent._id.toString());
                            if (io) emitToolResult(io, agent._id.toString(), { callId, tool: toolName, success: true });
                        } catch (err) {
                            toolResult = { error: err.message };
                            await agent.addLog('warning', `Tool ${toolName} failed: ${err.message}`);
                            if (io) emitToolResult(io, agent._id.toString(), { callId, tool: toolName, success: false, error: err.message });
                        }

                        toolCallsLog.push({ tool: toolName, args: toolArgs, result: toolResult });

                        // Track image generations for auto-embed + AgentAction save
                        if (toolName === 'generate_image' && toolResult?.url) {
                            generatedImages.push({ url: toolResult.url, markdown: toolResult.markdown, prompt: toolArgs.prompt });
                        }

                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
                        });
                    }
                } else {
                    finalResponse = assistantMsg?.content ?? null;
                }
            }

            if (!finalResponse) {
                finalResponse = '(Agent reached max tool iterations without a final response)';
            }

            // Auto-embed any generated images the model forgot to include
            if (generatedImages.length > 0) {
                for (const img of generatedImages) {
                    if (!finalResponse.includes(img.url)) {
                        finalResponse += `\n\n${img.markdown}`;
                    }
                    // Save as AgentAction so images are browsable in the Actions tab
                    const imgAction = new AgentAction({
                        agentId: agent._id,
                        type: 'image',
                        title: img.prompt?.substring(0, 80) || 'Generated image',
                        content: img.url,
                        metadata: { imageUrl: img.url, prompt: img.prompt },
                        status: 'complete'
                    });
                    await imgAction.save();
                    if (io) emitActionNew(io, agent._id.toString(), imgAction.toObject());
                }
            }

            await agent.updateStats(1, totalTokens);
            await agent.addConversation(message, finalResponse, totalTokens);

            // Fire-and-forget: update thread summary, long-term memory, and KB in background.
            // Each uses findByIdAndUpdate on its own field to avoid concurrent save races.
            const agentId = agent._id.toString();
            const convCount = agent.memory.conversations.length;

            updateThreadSummary(agentId, agent.model, message, finalResponse, agent.memory.threadSummary, ollamaBaseUrl, ollamaApiKey)
                .catch(e => console.error(`[Agent ${agentId}] Thread summary failed:`, e.message));
            updateLongTermMemory(agentId, agent.model, message, finalResponse, agent.memory.longTermMemory, ollamaBaseUrl, ollamaApiKey)
                .catch(e => console.error(`[Agent ${agentId}] Long-term memory failed:`, e.message));

            // KB extraction every 5 turns — gives the agent reusable context well before compaction
            if (convCount >= 5 && convCount % 5 === 0) {
                const recentForKB = agent.memory.conversations.slice(-5);
                extractKnowledge(agentId, agent.model, recentForKB, ollamaBaseUrl, ollamaApiKey)
                    .catch(e => console.error(`[Agent ${agentId}] KB extraction failed:`, e.message));
            }

            // Conversation compaction — when history gets long, summarise oldest entries into KB
            const COMPACT_THRESHOLD = 20;
            const convos = agent.memory.conversations || [];
            if (convos.length >= COMPACT_THRESHOLD) {
                try {
                    const toCompact = convos.slice(0, Math.floor(COMPACT_THRESHOLD / 2));
                    const summaryInput = toCompact.map(c => `User: ${c.userMessage}\nAgent: ${c.agentResponse}`).join('\n\n');
                    const summaryRes = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
                        model: agent.model,
                        messages: [
                            { role: 'system', content: 'Summarise the following conversation history into a concise memory entry (3-8 bullet points). Capture key decisions, facts, and context. Output only the summary, no preamble.' },
                            { role: 'user', content: summaryInput }
                        ],
                        temperature: 0.2,
                        stream: false
                    }, { headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' } });

                    const summaryText = summaryRes.data.choices?.[0]?.message?.content || '';
                    if (summaryText) {
                        await agent.addKnowledge(`Memory summary (${new Date().toLocaleDateString()})`, summaryText, 'context');
                        agent.memory.conversations = convos.slice(Math.floor(COMPACT_THRESHOLD / 2));
                        await agent.save();
                        await agent.addLog('info', `Compacted ${toCompact.length} conversations into KB summary`);
                    }
                } catch (compactErr) {
                    await agent.addLog('warning', `Compaction failed: ${compactErr.message}`);
                }
            }

            agent.status = 'idle';
            await agent.save();
            await agent.addLog('info', `Chat complete — ${toolCallsLog.length} tool calls, ${totalTokens} tokens`);

            if (io) {
                emitMemoryUpdate(io, agent._id.toString(), 'conversation', {
                    userMessage: message,
                    agentResponse: finalResponse,
                    tokenCount: totalTokens,
                    timestamp: new Date()
                });
            }

            chatInFlight.delete(agentIdStr);
            res.json({
                success: true,
                response: finalResponse,
                toolCalls: toolCallsLog,
                usage: { tokens: totalTokens, iterations: toolCallsLog.length }
            });
        } catch (ollamaError) {
            console.error('Ollama API error:', ollamaError.response?.data || ollamaError.message);

            // If image(s) were generated before Ollama failed (GPU contention), return them gracefully
            if (generatedImages.length > 0) {
                const imageResponse = generatedImages.map(img =>
                    `Here's your generated image!\n\n${img.markdown}`
                ).join('\n\n');

                for (const img of generatedImages) {
                    const imgAction = new AgentAction({
                        agentId: agent._id,
                        type: 'image',
                        title: img.prompt?.substring(0, 80) || 'Generated image',
                        content: img.url,
                        metadata: { imageUrl: img.url, prompt: img.prompt },
                        status: 'complete'
                    });
                    await imgAction.save();
                    if (io) emitActionNew(io, agent._id.toString(), imgAction.toObject());
                }

                agent.status = 'idle';
                await agent.save();
                chatInFlight.delete(agentIdStr);
                return res.json({
                    success: true,
                    response: imageResponse,
                    toolCalls: toolCallsLog,
                    usage: { tokens: 0, iterations: 0 }
                });
            }

            agent.status = 'error';
            await agent.save();
            await agent.addLog('error', `Ollama API error: ${ollamaError.message}`);

            chatInFlight.delete(agentIdStr);
            res.status(500).json({
                success: false,
                error: 'Failed to communicate with Ollama',
                details: ollamaError.response?.data || ollamaError.message
            });
        }
    } catch (error) {
        chatInFlight.delete(req.params.id);
        console.error('Error in agent chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

async function updateThreadSummary(agentId, model, userMessage, agentResponse, currentSummary, ollamaBaseUrl, ollamaApiKey) {
    const current = currentSummary || '';
    const prompt = current
        ? `Current thread summary:\n${current}\n\nLatest exchange:\nUser: ${userMessage}\nAgent: ${agentResponse}\n\nUpdate the thread summary to incorporate this exchange. Keep it concise (5-10 bullet points). Capture what was accomplished, key decisions, and the overall arc. Output only the updated summary.`
        : `User: ${userMessage}\nAgent: ${agentResponse}\n\nWrite a concise thread summary (5-10 bullet points) capturing what was accomplished, key decisions, and context from this exchange. Output only the summary.`;

    const res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
        model,
        messages: [
            { role: 'system', content: 'You are a memory assistant. Produce concise, factual summaries.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        stream: false
    }, { headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' } });

    const summary = res.data.choices?.[0]?.message?.content || '';
    if (summary) {
        await Agent.findByIdAndUpdate(agentId, { $set: { 'memory.threadSummary': summary } });
    }
}

async function updateLongTermMemory(agentId, model, userMessage, agentResponse, currentNotes, ollamaBaseUrl, ollamaApiKey) {
    const current = currentNotes || '';
    const prompt = current
        ? `Current notes:\n${current}\n\nLatest exchange:\nUser: ${userMessage}\nAgent: ${agentResponse}\n\nExtract any new action items, next steps, decisions, or important facts from this exchange. Merge them into the existing notes without duplicating items. Use bullet points or checkboxes (- [ ]) for tasks. Output the complete updated notes.`
        : `User: ${userMessage}\nAgent: ${agentResponse}\n\nExtract any action items, next steps, decisions, or key facts from this exchange. Format tasks as checkboxes (- [ ]). Output only the notes, nothing else.`;

    const res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
        model,
        messages: [
            { role: 'system', content: 'You are a memory assistant that extracts and maintains action items, next steps, and key decisions from conversations.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        stream: false
    }, { headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' } });

    const notes = res.data.choices?.[0]?.message?.content || '';
    if (notes) {
        await Agent.findByIdAndUpdate(agentId, { $set: { 'memory.longTermMemory': notes } });
    }
}

async function extractKnowledge(agentId, model, recentConvos, ollamaBaseUrl, ollamaApiKey) {
    const convText = recentConvos.map(c => `User: ${c.userMessage}\nAgent: ${c.agentResponse}`).join('\n\n');

    const res = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
        model,
        messages: [
            { role: 'system', content: 'You are a knowledge extraction assistant. Extract only concrete, reusable facts, decisions, or context — not tasks or to-dos (those go in long-term memory). If there is nothing notable, respond with exactly: null' },
            { role: 'user', content: `Recent conversation:\n${convText}\n\nExtract any concrete facts, decisions, technical details, or context worth preserving as a knowledge base entry. Output JSON: {"title":"...","content":"..."} or null if nothing notable.` }
        ],
        temperature: 0.2,
        stream: false
    }, { headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' } });

    const raw = res.data.choices?.[0]?.message?.content?.trim() || '';
    if (!raw || raw === 'null' || raw.toLowerCase().startsWith('null')) return;

    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (!parsed?.title || !parsed?.content) return;

    await Agent.findByIdAndUpdate(agentId, {
        $push: {
            'memory.knowledgeBase': {
                type: 'context',
                title: `${parsed.title} (${new Date().toLocaleDateString()})`,
                content: parsed.content,
                addedAt: new Date()
            }
        }
    });
}

// Internal agent-to-agent messaging — authenticated by BOT_ALERT_SECRET, no session required
router.post('/api/agents/:id/chat-internal', async (req, res) => {
    const expected = process.env.BOT_ALERT_SECRET || 'bih-internal';
    const { secret, message, fromAgentName } = req.body;
    if (secret !== expected) return res.status(403).json({ error: 'Forbidden' });
    if (!message) return res.status(400).json({ error: 'message required' });

    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
        const ollamaApiKey = process.env.OLLAMA_API_KEY;

        const messages = [{ role: 'system', content: agent.config.systemPrompt }];
        if (fromAgentName) messages.push({ role: 'system', content: `You are receiving a message from agent: ${fromAgentName}` });
        if (agent.memory.longTermMemory) messages.push({ role: 'system', content: `Your notes:\n${agent.memory.longTermMemory}` });
        if (agent.memory.knowledgeBase?.length > 0) {
            const kb = agent.memory.knowledgeBase.slice(-5).map(e => `[${e.type}] ${e.title}: ${e.content}`).join('\n');
            messages.push({ role: 'system', content: `Knowledge Base:\n${kb}` });
        }
        const recentConvos = (agent.memory.conversations || []).slice(-5);
        for (const c of recentConvos) {
            messages.push({ role: 'user', content: c.userMessage });
            messages.push({ role: 'assistant', content: c.agentResponse });
        }
        messages.push({ role: 'user', content: message });

        const ollamaRes = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
            model: agent.model,
            messages,
            temperature: agent.config.temperature,
            stream: false
        }, { headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 });

        const response = ollamaRes.data.choices?.[0]?.message?.content || '';
        const tokens = ollamaRes.data.usage?.total_tokens || 0;

        await agent.addConversation(`[${fromAgentName || 'Agent'}]: ${message}`, response, tokens);

        res.json({ success: true, response, agentName: agent.name });
    } catch (error) {
        console.error('[chat-internal] error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
