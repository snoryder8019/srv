/**
 * Tower API - CRUD + voting for community-built towers.
 */
import express from 'express';
import Tower from '../models/Tower.js';

const router = express.Router();

// List approved towers (browse / picker UI)
router.get('/', async (req, res) => {
  try {
    const { status = 'approved', category, limit = 50 } = req.query;
    const query = { status };
    if (category) query.category = category;

    const towers = await Tower.find(query)
      .sort({ 'votes.up': -1, createdAt: -1 })
      .limit(Math.min(parseInt(limit), 200));

    res.json({ success: true, towers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Single tower detail
router.get('/:id', async (req, res) => {
  try {
    const tower = await Tower.findById(req.params.id);
    if (!tower) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, tower });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new tower (draft)
router.post('/', async (req, res) => {
  try {
    const tower = await Tower.create(req.body);
    res.status(201).json({ success: true, tower });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update tower
router.put('/:id', async (req, res) => {
  try {
    const tower = await Tower.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!tower) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, tower });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete tower
router.delete('/:id', async (req, res) => {
  try {
    const tower = await Tower.findByIdAndDelete(req.params.id);
    if (!tower) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Vote on a tower (placeholder - wire to user auth later)
router.post('/:id/vote', async (req, res) => {
  try {
    const { direction } = req.body; // 'up' | 'down'
    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({ success: false, error: 'direction must be up or down' });
    }
    const tower = await Tower.findByIdAndUpdate(
      req.params.id,
      { $inc: { [`votes.${direction}`]: 1 } },
      { new: true }
    );
    if (!tower) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, votes: tower.votes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
