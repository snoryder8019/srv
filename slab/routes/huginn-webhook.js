/**
 * Huginn Webhook — receives events from LLM via SSH tunnel
 * POST /huginn/webhook — receives deployment events and pushes to control center displays
 */

import express from 'express';
import { getHuginnIO } from '../plugins/socketio.js';

const router = express.Router();

// ── Webhook endpoint ────────────────────────────────────────────────────────
router.post('/webhook', express.json(), async (req, res) => {
  const io = getHuginnIO();
  if (!io) {
    return res.status(503).json({ error: 'Socket.IO not initialized' });
  }

  const { content, type, displayId, style, secret } = req.body;

  // Optional: Add secret validation for security
  const WEBHOOK_SECRET = process.env.HUGINN_WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  if (!content) {
    return res.status(400).json({ error: 'content field required' });
  }

  // Build deployment payload
  const payload = {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
    content,
    type: type || 'alert',           // text, code, alert, metric
    style: style || {},               // optional styling hints
    deployedBy: 'Huginn LLM',
    deployedAt: new Date().toISOString(),
  };

  // Get Huginn namespace
  const huginnNS = io.of('/huginn');

  // Target specific display or broadcast to all
  if (displayId && displayId !== 'all') {
    huginnNS.to('display-' + displayId).emit('deploy', payload);
  } else {
    huginnNS.to('control-center').emit('deploy', payload);
  }

  console.log(`[huginn-webhook] Deployed to ${displayId || 'all'}: ${content.slice(0, 60)}...`);

  res.json({
    ok: true,
    deploymentId: payload.id,
    message: 'Event deployed to control center',
  });
});

// ── Health check ────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  const io = getHuginnIO();
  const huginnNS = io ? io.of('/huginn') : null;
  const displayCount = huginnNS ? huginnNS.adapter.rooms.get('control-center')?.size || 0 : 0;
  const operatorCount = huginnNS ? huginnNS.adapter.rooms.get('huginn-chat')?.size || 0 : 0;

  res.json({
    ok: !!io,
    displays: displayCount,
    operators: operatorCount,
    timestamp: new Date().toISOString(),
  });
});

export default router;
