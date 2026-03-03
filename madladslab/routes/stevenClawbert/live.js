import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LIVE_ROOT = '/srv/madladslab';
const SKIP = new Set(['node_modules', '.git', '.npm', '.cache', 'dist', '__pycache__']);

// GET /ls — File listing scoped to madladslab (no admin required)
router.get('/ls', (req, res) => {
  try {
    const requested = req.query.path ? path.resolve(req.query.path) : LIVE_ROOT;
    // Keep requests inside /srv to prevent traversal
    if (!requested.startsWith('/srv')) {
      return res.status(400).json({ success: false, error: 'Invalid path' });
    }
    const entries = fs.readdirSync(requested, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && !SKIP.has(e.name))
      .map(e => {
        const full = path.join(requested, e.name);
        let size = 0, childCount = 0;
        try {
          size = fs.statSync(full).size;
          if (e.isDirectory()) {
            try { childCount = fs.readdirSync(full).filter(n => !n.startsWith('.') && !SKIP.has(n)).length; } catch {}
          }
        } catch {}
        return { name: e.name, path: full, isDir: e.isDirectory(), size, childCount };
      })
      .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    res.json({ success: true, items: entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET / — Live Vision interface
router.get('/', (req, res) => {
  res.render('stevenClawbert/live', {
    title: 'Live Vision — Steven Clawbert',
    user: req.user
  });
});

// POST /vision — Multimodal: camera frame + gesture context → Claude Haiku
router.post('/vision', async (req, res) => {
  try {
    const { imageBase64, gestureContext, userMessage } = req.body;

    if (!imageBase64 && !userMessage) {
      return res.json({ success: false, error: 'No input provided' });
    }

    const content = [];

    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64Data }
      });
    }

    let textPrompt = '';
    if (gestureContext) textPrompt += `[Detected: ${gestureContext}]\n`;
    if (userMessage) textPrompt += userMessage;
    if (!textPrompt) textPrompt = 'What do you observe about this person?';

    content.push({ type: 'text', text: textPrompt });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      system: `You are Steven Clawbert, a sharp and witty AI assistant with a slick, no-nonsense personality. The user is interacting via their camera — you can see their face, expressions, and hand gestures. Keep responses punchy (1-3 sentences max). React naturally and cleverly to what you observe.`,
      messages: [{ role: 'user', content }]
    });

    res.json({ success: true, response: response.content[0]?.text || '' });
  } catch (err) {
    console.error('[live/vision]', err.message);
    res.json({ success: false, error: err.message });
  }
});

export default router;
