import express from 'express';
import { listPitches } from '../lib/pitchLoader.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.render('home', { title: 'Left Field · Pitches', pitches: listPitches() });
});

router.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

export default router;
