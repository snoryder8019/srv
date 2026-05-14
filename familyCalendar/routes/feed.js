import express from 'express';
import { getDb } from '../plugins/mongo.js';
import { requireAuth } from '../middleware/locals.js';

const router = express.Router();

router.use(requireAuth);

router.get('/today', async (req, res) => {
  const db = getDb();
  const familyId = req.user.familyId;
  if (!familyId) return res.json({ items: [] });
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const items = await db.collection('feedItems')
    .find({ familyId, displayDate: { $gte: dayStart, $lt: dayEnd } })
    .sort({ type: 1 }).toArray();
  res.json({ items });
});

export default router;
