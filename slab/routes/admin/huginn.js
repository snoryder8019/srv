/**
 * Slab — Huginn Agent Chat (Superadmin only)
 * Mounted at /admin/huginn
 *
 * Proxies chat to the Huginn persistent agent on GPU 0
 * (deepseek-r1:7b at ollama.madladslab.com/huginn/*)
 */

import express from 'express';
import { requireSuperInAdmin } from '../../middleware/superadmin.js';
import { config } from '../../config/config.js';

const router = express.Router();

router.use(requireSuperInAdmin);

const HUGINN_BASE = (config.OLLAMA_URL || '').replace(/\/v1\/chat\/completions$/, '');

// ── Helper: proxy GET to Huginn ────────────────────────────────────────────
async function huginnGet(path, timeoutMs = 8000) {
  const r = await fetch(`${HUGINN_BASE}/huginn${path}`, {
    headers: { 'Authorization': `Bearer ${config.OLLAMA_KEY}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`Huginn ${r.status}`);
  return r.json();
}

// ── Render chat page ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('admin/huginn', {
    user: req.adminUser,
    page: 'huginn',
  });
});

// ── Proxy chat to Huginn ────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { messages, session } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const sessionId = session || `sa-${req.adminUser?.email || 'default'}`;

    const upstream = await fetch(`${HUGINN_BASE}/huginn/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.OLLAMA_KEY}`,
        'X-Huginn-Session': sessionId,
      },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({ error: `Huginn ${upstream.status}`, detail: text });
    }

    // Check if streaming (SSE) or JSON
    const ct = upstream.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } catch { /* client disconnect */ }
      res.end();
    } else {
      const data = await upstream.json();
      res.json(data);
    }
  } catch (err) {
    console.error('[huginn] proxy error:', err.message);
    res.status(502).json({ error: 'Huginn unreachable', detail: err.message });
  }
});

// ── Status (uses /huginn/status) ────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const data = await huginnGet('/status');
    res.json(data);
  } catch (err) {
    res.json({ busy: null, error: err.message });
  }
});

// ── Health check (uses /huginn/status) ──────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    const data = await huginnGet('/status');
    res.json({
      ok: data.model === 'deepseek-r1:7b',
      busy: !!data.busy,
      busyTask: data.busyTask || null,
      model: data.model || 'deepseek-r1:7b',
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Insights ────────────────────────────────────────────────────────────────
router.get('/insights', async (req, res) => {
  try {
    const data = await huginnGet('/insights', 10000);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/insights/latest', async (req, res) => {
  try {
    const data = await huginnGet('/insights/latest', 10000);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Sessions ────────────────────────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  try {
    const data = await huginnGet('/sessions');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/sessions/:id', async (req, res) => {
  try {
    const data = await huginnGet(`/sessions/${encodeURIComponent(req.params.id)}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
