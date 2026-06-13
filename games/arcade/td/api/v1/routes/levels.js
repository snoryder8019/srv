/**
 * Level API - campaign levels played on top of Maps.
 * A Level adds waves + difficulty modifiers + lifecycle to a board (Map).
 * Mirrors the maps router's success/error JSON conventions.
 */
import express from 'express';
import Level from '../models/Level.js';

const router = express.Router();

// List levels (campaign browse). Filter by status (default approved+featured)
// and optional mapId (series). Sorted by order asc, then createdAt asc.
router.get('/', async (req, res) => {
  try {
    const { status, mapId } = req.query;
    const filter = status
      ? { status }
      : { status: { $in: ['approved', 'featured'] } };
    if (mapId) filter.mapId = mapId;
    const levels = await Level.find(filter)
      .sort({ order: 1, createdAt: 1 })
      .select('name slug description mapId order status');
    res.json({
      success: true,
      levels: levels.map(l => ({
        _id: l._id,
        name: l.name,
        slug: l.slug,
        description: l.description,
        mapId: l.mapId,
        order: l.order,
        status: l.status,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get one level (full doc - used at game start)
router.get('/:id', async (req, res) => {
  try {
    const level = await Level.findById(req.params.id);
    if (!level) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, level });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Next level in the SAME SERIES (same mapId) with a strictly greater order
// (ties broken by createdAt), published only. Returns next:null when none.
router.get('/:id/next', async (req, res) => {
  try {
    const level = await Level.findById(req.params.id);
    if (!level) return res.status(404).json({ success: false, error: 'Not found' });
    const next = await Level.findOne({
      mapId: level.mapId,
      status: { $in: ['approved', 'featured'] },
      $or: [
        { order: { $gt: level.order } },
        { order: level.order, createdAt: { $gt: level.createdAt } },
      ],
    }).sort({ order: 1, createdAt: 1 });
    res.json({
      success: true,
      next: next ? { _id: next._id, slug: next.slug, name: next.name } : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
