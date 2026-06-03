import express from 'express';
import { generateImage, existingImage, PROPOSAL_DESIGN_PROMPTS } from '../lib/sd.js';

const router = express.Router();

const inflight = new Map();

router.get('/proposal/:design', async (req, res) => {
  const { design } = req.params;
  if (!PROPOSAL_DESIGN_PROMPTS[design]) {
    return res.status(404).json({ error: 'unknown design' });
  }
  const cached = existingImage(design);
  if (cached) {
    return res.redirect(`/images/proposal/${design}.png`);
  }
  try {
    if (!inflight.has(design)) {
      inflight.set(design, generateImage(design));
    }
    await inflight.get(design);
    inflight.delete(design);
    res.redirect(`/images/proposal/${design}.png`);
  } catch (err) {
    inflight.delete(design);
    res.status(502).json({ error: err.message });
  }
});

router.get('/proposal/:design/status', (req, res) => {
  const { design } = req.params;
  res.json({
    design,
    ready: !!existingImage(design),
    generating: inflight.has(design),
  });
});

export default router;
