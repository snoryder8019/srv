/**
 * NPC + AI routes.
 *   POST /api/v1/npc/bark   { event, ctx }      -> single in-character line
 *   POST /api/v1/npc/chat   { message, history } -> free-form commander reply
 *   GET  /api/v1/npc/health                       -> AI gateway liveness
 *
 * These power the "tavern" chat UI and let the front-end fetch barks for
 * events that don't flow through the socket loop.
 */
import express from 'express';
import { bark, converse } from '../../../services/ai/npc.js';
import { aiHealth } from '../../../services/ai/client.js';

const router = express.Router();

router.get('/health', async (req, res) => {
  const h = await aiHealth();
  res.status(h.ok ? 200 : 503).json({ success: h.ok, ...h });
});

router.post('/bark', async (req, res) => {
  const { event = 'wave:start', ctx = {} } = req.body || {};
  const line = await bark(String(event), ctx);
  res.json({ success: true, event, line });
});

router.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ success: false, error: 'message required' });
  }
  const safeHistory = Array.isArray(history)
    ? history.filter(m => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role)).slice(-6)
    : [];
  const reply = await converse(message.slice(0, 500), safeHistory);
  res.json({ success: true, reply });
});

export default router;
