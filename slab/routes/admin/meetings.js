import express from 'express';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { config } from '../../config/config.js';
import { sendClientEmail } from '../../plugins/mailer.js';

const router = express.Router();

// ── Agreement Templates ──
const AGREEMENT_TEMPLATES = {
  likeness_waiver: {
    title: 'Likeness Waiver',
    body: 'I grant {brandName} permission to use my likeness, image, and voice captured during the meeting titled "{meetingTitle}" for promotional, portfolio, and business purposes. I understand that I will not receive compensation for such use and that this waiver is irrevocable.',
  },
  nda: {
    title: 'Non-Disclosure Agreement',
    body: 'I agree to keep all information shared during the meeting titled "{meetingTitle}" strictly confidential. I will not disclose, share, or use any proprietary information, business strategies, or creative materials discussed without prior written consent from {brandName}. This obligation survives the conclusion of the meeting.',
  },
  documents_received: {
    title: 'Documents Received & Verified',
    body: 'I acknowledge that I have received and reviewed the documents and materials provided by {brandName} in connection with the meeting titled "{meetingTitle}". I confirm that the information I have provided is accurate and complete to the best of my knowledge.',
  },
};

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
    const { title, expiresInHours, maxUses, tagClients, tagUsers,
            consentRecording, consentTranscription, consentCustomText } = req.body;
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
      consent: {
        recordingNotice: consentRecording === 'on',
        transcriptionDisclaimer: consentTranscription === 'on',
        customText: (consentCustomText || '').trim().slice(0, 500) || null,
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

// ── Booking availability settings ─────────────────────────────────────────

// GET /admin/meetings/booking — availability settings page
router.get('/booking', async (req, res) => {
  try {
    const db = req.db;
    const doc = await db.collection('booking_settings').findOne({ key: 'config' });
    const settings = doc?.value || {
      enabled: false,
      mode: 'meeting',
      title: 'Book a Meeting',
      subtitle: 'Choose a time that works for you.',
      meetingLength: 30,
      bufferMinutes: 15,
      advanceDays: 14,
      minNoticeHours: 2,
      availability: {
        1: { enabled: true, start: '09:00', end: '17:00' },
        2: { enabled: true, start: '09:00', end: '17:00' },
        3: { enabled: true, start: '09:00', end: '17:00' },
        4: { enabled: true, start: '09:00', end: '17:00' },
        5: { enabled: true, start: '09:00', end: '17:00' },
      },
      serviceTypes: [],
    };
    if (!settings.mode) settings.mode = 'meeting';
    if (!Array.isArray(settings.serviceTypes)) settings.serviceTypes = [];

    // Upcoming bookings
    const bookings = await db.collection('bookings')
      .find({ startAt: { $gte: new Date() }, status: { $nin: ['cancelled'] } })
      .sort({ startAt: 1 }).limit(20).toArray();

    const domain = req.tenant?.domain ? 'https://' + req.tenant.domain : '';

    res.render('admin/meetings/booking', {
      user: req.adminUser,
      page: 'meetings',
      title: 'Booking Settings',
      settings,
      bookings,
      bookingUrl: domain + '/book',
      saved: req.query.saved === '1',
      error: req.query.error === '1',
    });
  } catch (err) {
    console.error('[meetings/booking] error:', err);
    res.status(500).send('Error loading booking settings');
  }
});

// POST /admin/meetings/booking — save settings
router.post('/booking', async (req, res) => {
  try {
    const db = req.db;
    const { enabled, mode, title, subtitle, meetingLength, bufferMinutes, advanceDays, minNoticeHours } = req.body;

    // Parse availability from form — days 0-6, each has enabled/start/end
    const availability = {};
    for (let d = 0; d <= 6; d++) {
      availability[d] = {
        enabled: req.body[`day_${d}_enabled`] === 'on',
        start: req.body[`day_${d}_start`] || '09:00',
        end:   req.body[`day_${d}_end`]   || '17:00',
      };
    }

    // Parse service types — repeating fields service_slug[], service_label[], service_vehicle[]
    const slugs   = [].concat(req.body.service_slug   || []);
    const labels  = [].concat(req.body.service_label  || []);
    const vehicles = [].concat(req.body.service_vehicle || []);
    const serviceTypes = [];
    const seenSlugs = new Set();
    for (let i = 0; i < slugs.length; i++) {
      const slug = String(slugs[i] || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
      const label = String(labels[i] || '').trim().slice(0, 80);
      if (!slug || !label || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      serviceTypes.push({
        slug,
        label,
        requiresVehicle: String(vehicles[i] || '') === 'on' || String(vehicles[i] || '') === '1',
      });
    }

    const settings = {
      enabled: enabled === 'on',
      mode: (mode === 'service-slots') ? 'service-slots' : 'meeting',
      title:   title?.trim()    || 'Book a Meeting',
      subtitle: subtitle?.trim() || '',
      meetingLength:  parseInt(meetingLength)  || 30,
      bufferMinutes:  parseInt(bufferMinutes)  || 15,
      advanceDays:    parseInt(advanceDays)    || 14,
      minNoticeHours: parseInt(minNoticeHours) || 2,
      availability,
      serviceTypes,
      updatedAt: new Date(),
    };

    await db.collection('booking_settings').updateOne(
      { key: 'config' },
      { $set: { key: 'config', value: settings } },
      { upsert: true },
    );

    res.redirect('/admin/meetings/booking?saved=1');
  } catch (err) {
    console.error('[meetings/booking] save error:', err);
    res.redirect('/admin/meetings/booking?error=1');
  }
});

// POST /admin/meetings/booking/:id/status — update a booking status
router.post('/booking/:id/status', express.json(), async (req, res) => {
  try {
    const { ObjectId } = await import('mongodb');
    const db = req.db;
    const { status } = req.body;
    if (!['confirmed', 'cancelled', 'completed', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await db.collection('bookings').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Calendar slots (service-slots booking mode) ─────────────────────────────
// These are tenant-managed time/location/service-type slots that customers book against.
// Only meaningful when booking_settings.value.mode === 'service-slots'.

// GET /admin/meetings/slots — list + create form
router.get('/slots', async (req, res) => {
  try {
    const db = req.db;
    const settingsDoc = await db.collection('booking_settings').findOne({ key: 'config' });
    const settings = settingsDoc?.value || { serviceTypes: [], mode: 'meeting' };

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const slots = await db.collection('calendar_slots')
      .find({ date: { $gte: today.toISOString().slice(0, 10) } })
      .sort({ date: 1, startTime: 1 })
      .toArray();

    res.render('admin/meetings/slots', {
      user: req.adminUser,
      page: 'meetings',
      title: 'Service Slots',
      settings,
      slots,
      saved: req.query.saved === '1',
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[meetings/slots] list error:', err);
    res.status(500).send('Error loading slots');
  }
});

// POST /admin/meetings/slots — create one slot
router.post('/slots', async (req, res) => {
  try {
    const db = req.db;
    const { date, startTime, endTime, serviceType, locationLabel, locationAddress, locationLat, locationLng, maxBookings, notes } = req.body;

    if (!date || !startTime || !endTime || !serviceType) {
      return res.redirect('/admin/meetings/slots?error=missing');
    }

    await db.collection('calendar_slots').insertOne({
      date: String(date).slice(0, 10),
      startTime: String(startTime).slice(0, 5),
      endTime:   String(endTime).slice(0, 5),
      serviceType: String(serviceType).trim(),
      location: {
        label: (locationLabel || '').trim(),
        address: (locationAddress || '').trim(),
        lat: locationLat ? parseFloat(locationLat) : null,
        lng: locationLng ? parseFloat(locationLng) : null,
      },
      maxBookings: Math.max(1, parseInt(maxBookings) || 1),
      currentBookings: 0,
      notes: (notes || '').trim().slice(0, 500),
      createdAt: new Date(),
    });

    res.redirect('/admin/meetings/slots?saved=1');
  } catch (err) {
    console.error('[meetings/slots] create error:', err);
    res.redirect('/admin/meetings/slots?error=create');
  }
});

// POST /admin/meetings/slots/:id/delete — remove a slot
router.post('/slots/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('calendar_slots').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/meetings/slots?saved=1');
  } catch (err) {
    console.error('[meetings/slots] delete error:', err);
    res.redirect('/admin/meetings/slots?error=delete');
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

    // Fetch agreements for this meeting
    const agreements = await db.collection('agreements')
      .find({ meetingId: meeting._id })
      .sort({ sentAt: -1 })
      .toArray();

    res.render('admin/meetings/detail', {
      user: req.adminUser,
      page: 'meetings',
      title: meeting.title,
      meeting,
      taggedClients,
      taggedUsers,
      allClients,
      allUsers,
      agreements,
      agreementTemplates: AGREEMENT_TEMPLATES,
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

// POST /admin/meetings/:id/agreements — send an agreement to a recipient
router.post('/:id/agreements', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const meeting = await db.collection('meetings').findOne({ _id: new ObjectId(req.params.id) });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const { type, recipientEmail, recipientName, customBody } = req.body;
    if (!recipientEmail) return res.status(400).json({ error: 'Recipient email is required' });

    const brandName = req.tenant?.brand?.name || 'Our Team';
    let title, body;

    if (type === 'custom') {
      title = 'Agreement';
      body = (customBody || '').trim();
      if (!body) return res.status(400).json({ error: 'Custom agreement body is required' });
    } else {
      const tmpl = AGREEMENT_TEMPLATES[type];
      if (!tmpl) return res.status(400).json({ error: 'Unknown agreement type' });
      title = tmpl.title;
      body = (customBody || tmpl.body)
        .replace(/\{brandName\}/g, brandName)
        .replace(/\{meetingTitle\}/g, meeting.title)
        .replace(/\{recipientName\}/g, recipientName || 'Participant');
    }

    const token = crypto.randomBytes(24).toString('hex');
    const domain = req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN;
    const viewUrl = `${domain}/meeting/agreement/${token}`;

    // Try to match recipient to a client
    let clientId = null;
    if (recipientEmail) {
      const client = await db.collection('clients').findOne(
        { email: new RegExp('^' + recipientEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
        { projection: { _id: 1 } }
      );
      if (client) clientId = client._id;
    }

    const agreement = {
      token,
      type: type || 'custom',
      title,
      body,
      meetingId: meeting._id,
      clientId,
      recipientName: (recipientName || '').trim() || null,
      recipientEmail: recipientEmail.trim(),
      sentBy: req.adminUser.email,
      sentAt: new Date(),
      viewedAt: null,
      acceptedAt: null,
      acceptedIp: null,
      status: 'sent',
    };

    await db.collection('agreements').insertOne(agreement);

    // Send email via sendClientEmail
    const emailBody = `
      <p>Hi ${recipientName || 'there'},</p>
      <p>Please review and acknowledge the following agreement related to <strong>${meeting.title}</strong>:</p>
      <p style="font-size:15px;font-weight:600;color:#1C2B4A;">${title}</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${viewUrl}" style="display:inline-block;padding:14px 40px;background:#C9A848;color:#0F1B30;text-decoration:none;border-radius:2px;font-size:14px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;">Review &amp; Accept</a>
      </p>
      <p style="font-size:13px;color:#6B7380;">If you have questions, reply to this email.</p>
    `;

    try {
      await sendClientEmail(recipientEmail, [], `${title} — ${meeting.title}`, emailBody, null, req.tenant);
    } catch (mailErr) {
      console.error('[agreements] email send error:', mailErr.message);
      // Agreement is still created — admin can share the link manually
    }

    res.json({ ok: true, agreementId: agreement._id, viewUrl });
  } catch (err) {
    console.error('[meetings] send agreement error:', err);
    res.status(500).json({ error: 'Failed to send agreement' });
  }
});


// POST /admin/meetings/:id/recordings/send-to-assets
// Copy a recording entry out of meetings.assets[] into the central `assets`
// collection under folder "video" so it shows up in /admin/assets. The S3 object
// is NOT duplicated — both records point to the same bucketKey/url. The new
// assets-collection record stores size: 0 to avoid double-counting toward the
// tenant storage quota (the bytes are already accounted for via meetings.assets).
router.post('/:id/recordings/send-to-assets', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { assetIndex, bucketKey } = req.body || {};

    const meeting = await db.collection('meetings').findOne({ _id: new ObjectId(req.params.id) });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const assets = Array.isArray(meeting.assets) ? meeting.assets : [];
    let asset = null;
    if (Number.isInteger(assetIndex) && assets[assetIndex]) asset = assets[assetIndex];
    else if (bucketKey) asset = assets.find(a => a.bucketKey === bucketKey);
    if (!asset) return res.status(404).json({ error: 'Recording not found on this meeting' });

    const kind = asset.kind || '';
    if (kind !== 'meeting-recording' && kind !== 'screen-recording') {
      return res.status(400).json({ error: 'Only meeting/screen recordings can be sent to the assets library.' });
    }

    // Idempotency — don't duplicate if the same bucketKey already exists in assets.
    if (asset.bucketKey) {
      const existing = await db.collection('assets').findOne({ bucketKey: asset.bucketKey });
      if (existing) {
        return res.json({ ok: true, asset: existing, alreadyExisted: true });
      }
    }

    // Make sure a "video" folder exists in the picker.
    try {
      await db.collection('asset_folders').updateOne(
        { slug: 'video' },
        { $setOnInsert: { name: 'Video', slug: 'video', createdAt: new Date() } },
        { upsert: true }
      );
    } catch (e) { /* non-fatal */ }

    const filename = asset.bucketKey ? asset.bucketKey.split('/').pop() : (asset.name || 'recording.webm');
    const titleBase = meeting.title || 'Meeting';
    const kindLabel = kind === 'screen-recording' ? 'Screen Recording' : 'Recording';

    const doc = {
      filename,
      originalName: asset.name || filename,
      folders: ['video'],
      folder: 'video',
      publicUrl: asset.url,
      bucketKey: asset.bucketKey || null,
      fileType: 'video',
      mimeType: asset.type || 'video/webm',
      // size:0 — bytes are already counted via meetings.assets aggregation.
      // Setting this to file.size would double-count against the tenant quota.
      size: 0,
      title: `${titleBase} — ${kindLabel}`,
      meetingId: meeting._id,
      kind,
      createdAt: asset.createdAt ? new Date(asset.createdAt) : new Date(),
      addedToLibraryAt: new Date(),
      addedToLibraryBy: req.adminUser?.email || null,
    };

    const result = await db.collection('assets').insertOne(doc);
    doc._id = result.insertedId;
    res.json({ ok: true, asset: doc });
  } catch (err) {
    console.error('[meetings] send-to-assets error:', err);
    res.status(500).json({ error: 'Failed to send recording to assets' });
  }
});


export default router;
