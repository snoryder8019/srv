import express from "express";
import axios from "axios";
import mongoose from "mongoose";

import Agent from "../../api/v1/models/Agent.js";
import AgentAction from "../../api/v1/models/AgentAction.js";
import { isAdmin, requireAgents } from "./middleware.js";

const router = express.Router();

// ── View ───────────────────────────────────────────────────────────────────
router.get('/reports', requireAgents, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const reports = await db.collection('agent_reports')
            .find({})
            .sort({ generatedAt: -1 })
            .limit(20)
            .toArray();
        res.render('agents/reports', { user: req.user, reports, currentPage: 'agents-reports' });
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

// ── List reports (API) ─────────────────────────────────────────────────────
router.get('/api/agents/reports', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const reports = await db.collection('agent_reports')
            .find({})
            .sort({ generatedAt: -1 })
            .limit(20)
            .toArray();
        res.json({ success: true, reports });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Delete a report ────────────────────────────────────────────────────────
router.delete('/api/agents/reports/:reportId', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        await db.collection('agent_reports').deleteOne({
            _id: new mongoose.Types.ObjectId(req.params.reportId)
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Generate brief ─────────────────────────────────────────────────────────
router.post('/api/agents/reports/generate', isAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const { model = 'qwen2.5:7b', windowHours = 48 } = req.body;
        const since = new Date(Date.now() - windowHours * 3600000);

        // ── Gather org data ──────────────────────────────────────────────
        const agents = await Agent.find({}).lean();

        // Actions in window
        const recentActions = await AgentAction.find({ createdAt: { $gte: since } })
            .sort({ createdAt: -1 })
            .limit(150)
            .lean();

        // Tasks
        const [pendingTasks, needsHuman, completedTasks] = await Promise.all([
            db.collection('agent_tasks').find({ status: 'pending' }).limit(50).toArray(),
            db.collection('agent_tasks').find({ status: 'needs_human' }).limit(30).toArray(),
            db.collection('agent_tasks').find({ status: 'complete', completedAt: { $gte: since } }).limit(50).toArray()
        ]);

        // Notes in window (best effort — _id timestamp)
        const notesRaw = await db.collection('agent_notes').find({}).sort({ _id: -1 }).limit(100).toArray();

        // ── Build agent map for lookups ──────────────────────────────────
        const agentMap = Object.fromEntries(agents.map(a => [a._id.toString(), a]));

        // ── Compose data context for the LLM ────────────────────────────
        let context = `You are a senior analyst writing a briefing document for an AI agent organization.\n`;
        context += `Time window: last ${windowHours} hours. Generated: ${new Date().toLocaleString()}.\n\n`;

        // Agent roster
        context += `## AGENT ROSTER (${agents.length} agents)\n`;
        for (const a of agents) {
            const bgRunning = a.config?.backgroundRunning;
            const prod = a.bgProductivity?.score ?? 'n/a';
            const ticks = (a.bgTickHistory || []).slice(0, 3).map(t => t.title || '(idle)').join(' | ');
            context += `- **${a.name}** [${a.role}/${a.tier}] status:${a.status}`;
            if (bgRunning) context += ` bg:running productivity:${prod}%`;
            context += '\n';
            if (a.memory?.threadSummary) context += `  summary: ${a.memory.threadSummary.substring(0, 200)}\n`;
            if (ticks) context += `  recent ticks: ${ticks}\n`;
        }

        // Recent findings by agent
        const actionsByAgent = {};
        for (const action of recentActions) {
            const aid = action.agentId?.toString();
            if (!actionsByAgent[aid]) actionsByAgent[aid] = [];
            actionsByAgent[aid].push(action);
        }

        context += `\n## RECENT FINDINGS (${recentActions.length} in window)\n`;
        for (const [aid, actions] of Object.entries(actionsByAgent)) {
            const agentName = agentMap[aid]?.name || 'Unknown';
            context += `\n### ${agentName}\n`;
            for (const a of actions.slice(0, 8)) {
                context += `- [${a.type}] ${a.title}: ${(a.content || '').substring(0, 200)}\n`;
            }
        }

        // Tasks
        context += `\n## TASK QUEUE\n`;
        context += `- Pending: ${pendingTasks.length}\n`;
        context += `- Needs human: ${needsHuman.length}\n`;
        context += `- Completed in window: ${completedTasks.length}\n`;

        if (needsHuman.length > 0) {
            context += `\n### Awaiting human input:\n`;
            for (const t of needsHuman.slice(0, 10)) {
                const aName = agentMap[t.agentId]?.name || 'Unknown';
                context += `- [${aName}] ${t.title}\n`;
            }
        }

        if (completedTasks.length > 0) {
            context += `\n### Completed this period:\n`;
            for (const t of completedTasks.slice(0, 15)) {
                const aName = agentMap[t.agentId]?.name || 'Unknown';
                context += `- [${aName}] ${t.title}\n`;
            }
        }

        // Notes
        if (notesRaw.length > 0) {
            context += `\n## AGENT NOTES (${notesRaw.length} total)\n`;
            for (const n of notesRaw.slice(0, 20)) {
                const aName = agentMap[n.agentId]?.name || 'Unknown';
                const fields = Object.entries(n).filter(([k]) => !['_id','agentId'].includes(k))
                    .map(([k,v]) => `${k}: ${String(v).substring(0, 100)}`).join(' | ');
                if (fields) context += `- [${aName}] ${fields}\n`;
            }
        }

        // ── Prompt ──────────────────────────────────────────────────────
        const systemPrompt = `You are a senior analyst writing a concise briefing document.
Write in markdown. Be direct, specific, and useful — not generic.
Structure: Executive Summary → Agent Activity Highlights → Key Findings → Needs Human Attention → Org Health → Recommended Next Actions.
Keep the Executive Summary to 3-4 sentences max. Every section should contain only what is genuinely notable.
If something has nothing to report, omit that section entirely rather than saying "nothing to report".`;

        const userPrompt = `Using the data below, write a briefing document for the organization's operator.
Title it "# Org Brief — ${new Date().toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' })}".

${context}

Write the brief now. Be concrete — reference actual agent names, actual task titles, actual findings.`;

        // ── LLM call ────────────────────────────────────────────────────
        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
        const ollamaApiKey = process.env.OLLAMA_API_KEY;

        const headers = { 'Content-Type': 'application/json' };
        if (ollamaApiKey) headers['Authorization'] = `Bearer ${ollamaApiKey}`;

        const llmRes = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            stream: false,
            options: { temperature: 0.35, num_predict: 2048 }
        }, { headers, timeout: 120000 });

        const brief = llmRes.data.choices?.[0]?.message?.content || '(no output)';
        const tokens = llmRes.data.usage?.total_tokens || 0;

        // ── Store ────────────────────────────────────────────────────────
        const report = {
            brief,
            model,
            windowHours,
            agentCount: agents.length,
            actionCount: recentActions.length,
            tasksPending: pendingTasks.length,
            needsHuman: needsHuman.length,
            completedInWindow: completedTasks.length,
            tokens,
            generatedAt: new Date()
        };

        const result = await db.collection('agent_reports').insertOne(report);

        res.json({ success: true, report: { ...report, _id: result.insertedId } });
    } catch (error) {
        console.error('[Reports] Generate error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
