/**
 * Story API — CRUD for narrative arcs, plus an SD portrait-generation endpoint
 * for NPC "headset" busts. Mirrors the maps router conventions.
 */
import express from 'express';
import Story from '../models/Story.js';
import { generateImage } from '../../../services/ai/client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTRAIT_DIR = path.resolve(__dirname, '..', '..', '..', 'public', 'assets', 'img', 'story');
fs.mkdirSync(PORTRAIT_DIR, { recursive: true });

const router = express.Router();

// List stories (optionally by map)
router.get('/', async (req, res) => {
  try {
    const { status, mapId, limit = 50 } = req.query;
    const q = {};
    if (status) q.status = status;
    if (mapId) q.mapId = mapId;
    const stories = await Story.find(q).sort({ updatedAt: -1 }).limit(Math.min(parseInt(limit), 200));
    res.json({ success: true, stories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, story });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const story = await Story.create(req.body);
    res.status(201).json({ success: true, story });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const story = await Story.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!story) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, story });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const story = await Story.findByIdAndDelete(req.params.id);
    if (!story) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate an SD "headset" portrait for a character. Returns the saved URL.
// Body: { slug, prompt }. Saves to /assets/img/story/<slug>.png.
router.post('/portrait', async (req, res) => {
  try {
    const slug = String(req.body.slug || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    const prompt = String(req.body.prompt || '').slice(0, 400);
    if (!slug || !prompt) return res.status(400).json({ success: false, error: 'slug and prompt required' });
    const NEG = 'text, watermark, signature, letters, words, logo, blurry, lowres, jpeg artifacts, deformed, extra limbs';
    // a "headset"/comms bust framing for the narrative modal
    const framed = `${prompt}, head-and-shoulders bust portrait, comms headset, dramatic rim light, dark fantasy sci-fi, painterly game character art, centered, plain dark background, no text`;
    const b64 = await generateImage(framed, { size: '512x512', steps: 26, negativePrompt: NEG, timeoutMs: 180000 });
    if (!b64) return res.status(502).json({ success: false, error: 'image generation failed' });
    const file = `${slug}.png`;
    fs.writeFileSync(path.join(PORTRAIT_DIR, file), Buffer.from(b64, 'base64'));
    res.json({ success: true, url: `/assets/img/story/${file}`, prompt: framed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
