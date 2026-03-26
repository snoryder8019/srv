import express from 'express';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { config } from '../../config/config.js';

const router = express.Router();

// Helper: safely parse comma-separated ObjectId strings
function parseIds(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : raw.split(',');
  return arr.map(s => s.trim()).filter(Boolean).map(id => {
    try { return new ObjectId(id); } catch { return null; }
  }).filter(Boolean);
}

// GET /admin/meetings — list all meetings
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const now = new Date();

    // Auto-expire overdue meetings
    await db.collection('meetings').updateMany(
      { status: 'active', expiresAt: { $lt: now } },
      { $set: { status: 'expired' } }
    );

    const meetings = await db.collection('meetings')
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    // Fetch clients and users for tag selection + resolution
    const clients = await db.collection('clients').find({}, { projection: { name: 1, email: 1, company: 1 } }).sort({ name: 1 }).toArray();
    const users = await db.collection('users').find({}, { projection: { name: 1, email: 1, displayName: 1 } }).sort({ name: 1 }).toArray();

    // Build lookup maps for resolving tag IDs to names
    const clientMap = {};
    clients.forEach(c => { clientMap[c._id.toString()] = c.name || c.email || 'Client'; });
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u.displayName || u.name || u.email || 'User'; });

    // Split into active and history
    const active = meetings.filter(m => m.status === 'active');
    const history = meetings.filter(m => m.status !== 'active');

    res.render('admin/meetings/index', {
      user: req.adminUser,
      page: 'meetings',
      title: 'Meetings',
      meetings,
      active,
      history,
      clients,
      users,
      clientMap,
      userMap,
      domain: req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN,
    });
  } catch (err) {
    console.error('[meetings] list error:', err);
    res.status(500).send('Error loading meetings');
  }
});

// POST /admin/meetings — create a new meeting
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { title, expiresInHours, maxUses, tagClients, tagUsers } = req.body;
    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    const expHours = parseInt(expiresInHours) || 24;
    const max = maxUses ? parseInt(maxUses) : null;

    await db.collection('meetings').insertOne({
      title: title || 'Meeting',
      token,
      createdBy: req.adminUser.email,
      createdAt: now,
      expiresAt: new Date(now.getTime() + expHours * 60 * 60 * 1000),
      maxUses: max,
      useCount: 0,
      status: 'active',
      participants: [],
      notes: [],
      assets: [],
      tags: {
        clients: parseIds(tagClients),
        users: parseIds(tagUsers),
      },
    });

    res.redirect('/admin/meetings');
  } catch (err) {
    console.error('[meetings] create error:', err);
    res.status(500).send('Error creating meeting');
  }
});

// DELETE /admin/meetings/:id/destroy — permanently delete a meeting record
router.delete('/:id/destroy', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('meetings').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error('[meetings] destroy error:', err);
    res.status(500).json({ error: 'Error deleting meeting' });
  }
});

// DELETE /admin/meetings/:id — close a meeting
router.delete('/:id', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('meetings').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'closed', closedAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[meetings] delete error:', err);
    res.status(500).json({ error: 'Error closing meeting' });
  }
});

// GET /admin/meetings/:id — detail / archive view
router.get('/:id', async (req, res) => {
  try {
    const db = req.db;
    const meeting = await db.collection('meetings').findOne({ _id: new ObjectId(req.params.id) });
    if (!meeting) return res.status(404).send('Meeting not found');

    // Resolve tagged clients and users
    const taggedClients = meeting.tags?.clients?.length
      ? await db.collection('clients').find({ _id: { $in: meeting.tags.clients } }).toArray()
      : [];
    const taggedUsers = meeting.tags?.users?.length
      ? await db.collection('users').find({ _id: { $in: meeting.tags.users } }).toArray()
      : [];

    // All clients/users for tag editing
    const allClients = await db.collection('clients').find({}, { projection: { name: 1, email: 1, company: 1 } }).sort({ name: 1 }).toArray();
    const allUsers = await db.collection('users').find({}, { projection: { name: 1, email: 1, displayName: 1 } }).sort({ name: 1 }).toArray();

    res.render('admin/meetings/detail', {
      user: req.adminUser,
      page: 'meetings',
      title: meeting.title,
      meeting,
      taggedClients,
      taggedUsers,
      allClients,
      allUsers,
      domain: req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN,
    });
  } catch (err) {
    console.error('[meetings] detail error:', err);
    res.status(500).send('Error loading meeting');
  }
});

// PUT /admin/meetings/:id/tags — update tags
router.put('/:id/tags', async (req, res) => {
  try {
    const db = req.db;
    const { tagClients, tagUsers } = req.body;
    await db.collection('meetings').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { 'tags.clients': parseIds(tagClients), 'tags.users': parseIds(tagUsers) } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[meetings] tags update error:', err);
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

export default router;
