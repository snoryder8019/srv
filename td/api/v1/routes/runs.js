/**
 * Run API - manage active gameplay sessions.
 * Stub for now; real-time updates will go through Socket.IO.
 */
import express from 'express';
import Run from '../models/Run.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const run = await Run.create(req.body);
    res.status(201).json({ success: true, run });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const run = await Run.findById(req.params.id);
    if (!run) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, run });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/leaderboard/:mapId', async (req, res) => {
  try {
    const top = await Run.find({ mapId: req.params.mapId, status: 'won' })
      .sort({ score: -1 })
      .limit(50);
    res.json({ success: true, top });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
