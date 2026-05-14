import express from 'express';
import { getDb } from '../../plugins/mongo.js';
import { sha256 } from '../../plugins/crypto.js';

const router = express.Router();

async function authApiKey(req, res, next) {
  const key = req.header('x-api-key') || (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!key) return res.status(401).json({ error: 'missing api key' });
  const sub = await getDb().collection('slabSubscriptions').findOne({ apiKeyHash: sha256(key), revoked: { $ne: true } });
  if (!sub) return res.status(403).json({ error: 'invalid api key' });
  req.subscription = sub;
  next();
}

router.get('/calendar', authApiKey, async (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  const filter = { familyId: req.subscription.familyId };
  if (from || to) {
    filter.start = {};
    if (from) filter.start.$gte = from;
    if (to) filter.start.$lte = to;
  }
  const events = await db.collection('events').find(filter).sort({ start: 1 }).limit(500).toArray();
  res.json({ events: events.map(e => ({
    id: e._id, title: e.title, start: e.start, end: e.end,
    allDay: e.allDay, location: e.location, source: e.source,
  })) });
});

router.get('/feed', authApiKey, async (req, res) => {
  const db = getDb();
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const items = await db.collection('feedItems')
    .find({ familyId: req.subscription.familyId, displayDate: { $gte: dayStart, $lt: dayEnd } })
    .toArray();
  res.json({ items });
});

export default router;
