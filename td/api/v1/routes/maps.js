/**
 * Map API - CRUD for hex board layouts.
 */
import express from 'express';
import GameMap from '../models/Map.js';
import { generateHexBoard } from '../../../services/hex-grid.js';

const router = express.Router();

// List maps
router.get('/', async (req, res) => {
  try {
    const { status = 'approved', limit = 50 } = req.query;
    const maps = await GameMap.find({ status })
      .sort({ 'votes.up': -1, createdAt: -1 })
      .limit(Math.min(parseInt(limit), 200));
    res.json({ success: true, maps });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get one map (full doc - used at game start)
router.get('/:id', async (req, res) => {
  try {
    const map = await GameMap.findById(req.params.id);
    if (!map) return res.status(404).json({ success: false, error: 'Not found' });
    // Compute full hex set on demand so we don't have to store it
    const allHexes = generateHexBoard(map.radius);
    res.json({ success: true, map, allHexes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const map = await GameMap.create(req.body);
    res.status(201).json({ success: true, map });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const map = await GameMap.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!map) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, map });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const map = await GameMap.findByIdAndDelete(req.params.id);
    if (!map) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
