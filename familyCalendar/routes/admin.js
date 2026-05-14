import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { requireAdmin } from '../middleware/locals.js';
import { newApiKey, sha256 } from '../plugins/crypto.js';

const router = express.Router();

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const db = getDb();
  const [familyCount, userCount, eventCount, feedCount, subCount] = await Promise.all([
    db.collection('families').countDocuments(),
    db.collection('users').countDocuments(),
    db.collection('events').countDocuments(),
    db.collection('feedItems').countDocuments(),
    db.collection('slabSubscriptions').countDocuments(),
  ]);
  res.render('admin/index', {
    title: 'Admin',
    stats: { familyCount, userCount, eventCount, feedCount, subCount },
  });
});

router.get('/families', async (req, res) => {
  const families = await getDb().collection('families').find({}).toArray();
  res.render('admin/families', { title: 'Families', families });
});

router.post('/families', async (req, res) => {
  const { name, ownerEmail, timezone, weatherLocation } = req.body;
  const db = getDb();
  const result = await db.collection('families').insertOne({
    name, ownerEmail, timezone: timezone || 'UTC', weatherLocation: weatherLocation || '', createdAt: new Date(),
  });
  if (ownerEmail) {
    await db.collection('users').updateOne(
      { email: ownerEmail },
      { $set: { familyId: result.insertedId, isAdmin: true } }
    );
  }
  res.redirect('/admin/families');
});

router.get('/feed', async (req, res) => {
  const items = await getDb().collection('feedItems').find({}).sort({ displayDate: -1 }).limit(100).toArray();
  res.render('admin/feed', { title: 'Feed Items', items });
});

router.post('/feed', async (req, res) => {
  const { familyId, type, title, body, displayDate } = req.body;
  await getDb().collection('feedItems').insertOne({
    familyId: new ObjectId(familyId),
    type,
    payload: { title, body },
    displayDate: new Date(displayDate),
    createdAt: new Date(),
  });
  res.redirect('/admin/feed');
});

router.get('/slab-subscribers', async (req, res) => {
  const subs = await getDb().collection('slabSubscriptions').find({}).toArray();
  res.render('admin/slab', { title: 'Slab Subscribers', subs, newKey: req.query.newKey });
});

router.post('/slab-subscribers', async (req, res) => {
  const { tenantKey, familyId, label } = req.body;
  const apiKey = newApiKey();
  await getDb().collection('slabSubscriptions').insertOne({
    tenantKey,
    familyId: new ObjectId(familyId),
    label: label || tenantKey,
    apiKeyHash: sha256(apiKey),
    createdAt: new Date(),
    revoked: false,
  });
  res.redirect('/admin/slab-subscribers?newKey=' + encodeURIComponent(apiKey));
});

export default router;
