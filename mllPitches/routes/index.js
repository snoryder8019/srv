import express from 'express';
import { listPitches } from '../lib/pitchLoader.js';

const router = express.Router();

router.get('/', (req, res) => {
  if (req.mllUser) return res.redirect('/dashboard');
  const pitches = listPitches().filter((p) => p.source === 'seed');
  res.render('home', { title: 'Pitches that don’t sound like pitches', pitches });
});

router.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

export default router;
