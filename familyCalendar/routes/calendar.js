import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { requireAuth } from '../middleware/locals.js';
import { emitFamily } from '../plugins/socketio.js';
import { pushEventToGoogle } from '../plugins/googleCalendar.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const db = getDb();
  const familyId = req.user.familyId;
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const events = familyId
    ? await db.collection('events')
        .find({ familyId, start: { $gte: monthStart, $lte: monthEnd } })
        .sort({ start: 1 }).toArray()
    : [];

  res.render('calendar', { title: 'Calendar', events, monthStart, monthEnd });
});

router.post('/events', async (req, res) => {
  const db = getDb();
  const { title, description, start, end, allDay, location } = req.body;
  if (!title || !start || !end) return res.status(400).json({ error: 'title, start, end required' });

  const familyId = req.user.familyId;
  if (!familyId) return res.status(400).json({ error: 'user not in a family yet' });

  const doc = {
    familyId,
    source: 'native',
    userId: req.user._id,
    title,
    description: description || '',
    start,
    end,
    allDay: !!allDay,
    location: location || '',
    attendees: [],
    createdAt: new Date(),
    syncedAt: new Date(),
  };
  const { insertedId } = await db.collection('events').insertOne(doc);
  doc._id = insertedId;

  pushEventToGoogle({ familyId, userId: req.user._id, event: doc })
    .then(externalId => {
      if (externalId) {
        return db.collection('events').updateOne(
          { _id: insertedId },
          { $set: { externalId, source: 'native+google' } }
        );
      }
    })
    .catch(err => console.warn('[push google]', err.message));

  emitFamily(familyId.toString(), 'event:created', doc);
  res.json(doc);
});

router.put('/events/:id', async (req, res) => {
  const db = getDb();
  const { title, description, start, end, allDay, location } = req.body;
  const _id = new ObjectId(req.params.id);
  const event = await db.collection('events').findOne({ _id });
  if (!event || event.familyId.toString() !== req.user.familyId?.toString()) {
    return res.status(404).json({ error: 'not found' });
  }
  await db.collection('events').updateOne({ _id }, {
    $set: { title, description, start, end, allDay: !!allDay, location, syncedAt: new Date() },
  });
  const updated = await db.collection('events').findOne({ _id });
  emitFamily(event.familyId.toString(), 'event:updated', updated);
  res.json(updated);
});

router.delete('/events/:id', async (req, res) => {
  const db = getDb();
  const _id = new ObjectId(req.params.id);
  const event = await db.collection('events').findOne({ _id });
  if (!event || event.familyId.toString() !== req.user.familyId?.toString()) {
    return res.status(404).json({ error: 'not found' });
  }
  await db.collection('events').deleteOne({ _id });
  emitFamily(event.familyId.toString(), 'event:deleted', { _id });
  res.json({ ok: true });
});

export default router;
