import express from "express";

import Agent from "../../api/v1/models/Agent.js";
import { emitTuningUpdate } from "../../plugins/socket/agents.js";
import { isAdmin } from "./middleware.js";

const router = express.Router();

// Get agent tuning configuration
router.get('/api/agents/:id/tuning', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        res.json({
            success: true,
            tuning: {
                systemPrompt: agent.config.systemPrompt,
                systemPromptHistory: agent.tuning.systemPromptHistory || [],
                adjustableParams: agent.tuning.adjustableParams || {},
                config: {
                    temperature: agent.config.temperature,
                    maxTokens: agent.config.maxTokens,
                    contextWindow: agent.config.contextWindow,
                    topP: agent.config.topP ?? 0.9,
                    topK: agent.config.topK ?? 40,
                    repeatPenalty: agent.config.repeatPenalty ?? 1.1
                },
                bihBot: agent.bihBot || {}
            }
        });
    } catch (error) {
        console.error('Error fetching tuning config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update agent tuning configuration
router.put('/api/agents/:id/tuning', isAdmin, async (req, res) => {
    try {
        const { systemPrompt, adjustableParams, temperature, maxTokens, contextWindow, topP, topK, repeatPenalty, bihBot } = req.body;

        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        if (systemPrompt || adjustableParams) {
            await agent.updateTuning(systemPrompt, adjustableParams);
        }

        if (temperature !== undefined) agent.config.temperature = parseFloat(temperature);
        if (maxTokens !== undefined) agent.config.maxTokens = parseInt(maxTokens);
        if (contextWindow !== undefined) agent.config.contextWindow = parseInt(contextWindow);
        if (topP !== undefined) agent.config.topP = parseFloat(topP);
        if (topK !== undefined) agent.config.topK = parseInt(topK);
        if (repeatPenalty !== undefined) agent.config.repeatPenalty = parseFloat(repeatPenalty);

        // bih bot tunable params (displayName, avatar, rateMs only — enabled/trigger via /bih-bot)
        if (bihBot && typeof bihBot === 'object') {
            if (bihBot.displayName !== undefined) agent.bihBot.displayName = bihBot.displayName;
            if (bihBot.avatar !== undefined) agent.bihBot.avatar = bihBot.avatar;
            if (bihBot.rateMs !== undefined) agent.bihBot.rateMs = parseInt(bihBot.rateMs) || 8000;
        }

        await agent.save();

        const io = req.app.get('io');
        if (io) {
            emitTuningUpdate(io, agent._id.toString(), {
                systemPrompt: agent.config.systemPrompt,
                adjustableParams: agent.tuning.adjustableParams,
                config: {
                    temperature: agent.config.temperature,
                    maxTokens: agent.config.maxTokens,
                    contextWindow: agent.config.contextWindow
                }
            });
        }

        await agent.addLog('info', `Tuning updated by ${req.user.displayName || req.user.email}`);

        res.json({ success: true, agent });
    } catch (error) {
        console.error('Error updating tuning:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
