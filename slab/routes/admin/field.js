/**
 * In the Field — mobile field-ops admin surface.
 *
 * The initialization surface for "in the field" features: assign staff as field
 * techs, dispatch them to on-site jobs, capture on-site quotes/notes/uploads/
 * waivers, and (in later phases) stream live GPS location, estimate route ETAs,
 * and hand the client a short-lived magic link to view + pay.
 *
 * Experimental-stage feature (plugins/featureRegistry.js key 'field') — gated by
 * the shared admin middleware in routes/admin.js; no local auth needed.
 *
 * Collections (all tenant-scoped via req.db):
 *   users       — a field tech is a user with `fieldEnabled: true`
 *   field_jobs  — one on-site visit; see the JOB shape in POST /jobs
 *   engagements — quotes reuse the existing engagements system (tagged fieldJobId)
 *
 * Private uploads (waivers, site photos, signed docs) go to private S3 via
 * uploadPrivateBuffer and are served back only through the authed
 * GET /jobs/:id/files/:fileId route (never a public URL).
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import multer from 'multer';
import { uploadPrivateBuffer, getObjectStream } from '../../plugins/s3.js';
import {
  generateEngagementNumber, generateEngagementToken, DEFAULT_TERM_SECTIONS,
} from '../../plugins/engagements.js';
import { buildRoute, etaFrom, jobPin } from '../../plugins/fieldRoute.js';
import { sendClientEmail } from '../../plugins/mailer.js';
import { config } from '../../config/config.js';

const router = express.Router();

const oid = (v) => { try { return new ObjectId(v); } catch { return null; } };

// Render with a one-shot retry. Under NODE_ENV=production Express caches compiled
// EJS views, and the very first render of a view that pulls in partials can
// intermittently throw "include is not a function" on a cold cache race. A single
// retry compiles cleanly the second time; only a repeat failure surfaces an error.
function renderSafe(res, view, data) {
  res.render(view, data, (err, html) => {
    if (!err) return res.send(html);
    console.error(`[admin/field] render ${view} failed, retrying:`, err.message);
    res.render(view, data, (err2, html2) => {
      if (!err2) return res.send(html2);
      console.error(`[admin/field] render ${view} failed again:`, err2.message);
      if (!res.headersSent) res.status(500).send('Error loading this page. Please refresh.');
    });
  });
}

// Job lifecycle states — kept in step with locales `field.status.*`.
export const FIELD_STATUSES = ['scheduled', 'en_route', 'on_site', 'complete', 'canceled'];

// On-site captures (waivers / photos / signed docs) — in memory, then straight
// to private object storage. 12 MB is generous for a phone photo or PDF.
const fieldUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

// Load one job (+ null-safe) for a :id route.
async function loadJob(req) {
  const id = oid(req.params.id);
  if (!id) return null;
  return req.db.collection('field_jobs').findOne({ _id: id });
}

// ── GET /admin/field — dispatch board ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const [users, clients, jobs] = await Promise.all([
      db.collection('users')
        .find({ $or: [{ isAdmin: true }, { role: 'admin' }, { fieldEnabled: true }] })
        .project({ displayName: 1, email: 1, fieldEnabled: 1 })
        .sort({ displayName: 1 })
        .toArray(),
      db.collection('clients')
        .find({}, { projection: { name: 1, email: 1, company: 1 } })
        .sort({ name: 1 })
        .toArray(),
      db.collection('field_jobs')
        .find({ status: { $ne: 'canceled' } })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);

    const clientMap = {};
    clients.forEach((c) => { clientMap[c._id.toString()] = c.name || c.company || c.email || 'Client'; });
    const userMap = {};
    users.forEach((u) => { userMap[u._id.toString()] = u.displayName || u.email || 'Staff'; });
    const techs = users.filter((u) => u.fieldEnabled === true);

    renderSafe(res, 'admin/field/index', {
      user: req.adminUser, page: 'field', title: 'In the Field',
      users, techs, clients, clientMap, userMap, jobs,
      statuses: FIELD_STATUSES,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[admin/field] list error:', err);
    res.status(500).send('Error loading field board');
  }
});

// ── POST /admin/field/techs/:id — toggle a user's field-tech flag ─────────────
router.post('/techs/:id', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.redirect('/admin/field?error=' + encodeURIComponent('Unknown user.'));
    const enabled = req.body.enabled === 'true' || req.body.enabled === 'on' || req.body.enabled === true;
    await req.db.collection('users').updateOne({ _id: id }, { $set: { fieldEnabled: enabled } });
    res.redirect('/admin/field?success=tech_updated');
  } catch (err) {
    console.error('[admin/field] tech toggle error:', err);
    res.redirect('/admin/field?error=' + encodeURIComponent('Could not update staff.'));
  }
});

// ── POST /admin/field/jobs — create a field job ───────────────────────────────
router.post('/jobs', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const db = req.db;
    const { title, clientId, assignedTo, address, scheduledAt, estimatedMinutes } = req.body;
    if (!title?.trim()) return res.redirect('/admin/field?error=title_required');

    const now = new Date();
    const est = parseInt(estimatedMinutes, 10);
    const doc = {
      title: title.trim(),
      clientId: oid(clientId),
      assignedTo: assignedTo ? [oid(assignedTo)].filter(Boolean) : [],
      address: (address || '').trim(),
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      estimatedMinutes: Number.isFinite(est) && est > 0 ? est : null,
      status: 'scheduled',
      // Grown in later phases: location{lat,lng,at}, eta{minutes,at}, accessToken,
      // validUntil, invoiceId.
      location: null,
      eta: null,
      notes: [],
      uploads: [],   // { id, key, name, type, size, at, by }
      waivers: [],   // { id, key, name, signedBy, signedAt, by }
      engagementId: null,
      createdBy: req.adminUser?.email || '',
      createdAt: now,
      updatedAt: now,
    };
    const r = await db.collection('field_jobs').insertOne(doc);
    res.redirect('/admin/field/jobs/' + r.insertedId + '?success=job_created');
  } catch (err) {
    console.error('[admin/field] job create error:', err);
    res.redirect('/admin/field?error=' + encodeURIComponent('Could not create job.'));
  }
});

// ── GET /admin/field/jobs/:id — job detail ────────────────────────────────────
router.get('/jobs/:id', async (req, res) => {
  try {
    const db = req.db;
    const job = await loadJob(req);
    if (!job) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));

    const [techs, clients, engagement] = await Promise.all([
      db.collection('users')
        .find({ fieldEnabled: true }).project({ displayName: 1, email: 1 }).sort({ displayName: 1 }).toArray(),
      db.collection('clients')
        .find({}, { projection: { name: 1, email: 1, company: 1 } }).sort({ name: 1 }).toArray(),
      job.engagementId
        ? db.collection('engagements').findOne({ _id: job.engagementId }, { projection: { engagementNumber: 1, status: 1, accessToken: 1, title: 1 } })
        : null,
    ]);

    const clientMap = {};
    clients.forEach((c) => { clientMap[c._id.toString()] = c.name || c.company || c.email || 'Client'; });
    const techMap = {};
    techs.forEach((u) => { techMap[u._id.toString()] = u.displayName || u.email || 'Staff'; });
    const client = job.clientId ? clients.find((c) => c._id.toString() === job.clientId.toString()) : null;

    const domain = req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN;
    renderSafe(res, 'admin/field/job', {
      user: req.adminUser, page: 'field', title: job.title,
      job, techs, clients, clientMap, techMap, client, engagement, domain,
      statuses: FIELD_STATUSES,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[admin/field] job detail error:', err);
    res.status(500).send('Error loading job');
  }
});

// ── POST /admin/field/jobs/:id/status — change lifecycle status ───────────────
router.post('/jobs/:id/status', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const id = oid(req.params.id);
    const status = String(req.body.status || '');
    if (!id || !FIELD_STATUSES.includes(status)) return res.redirect('/admin/field?error=' + encodeURIComponent('Invalid status.'));
    await req.db.collection('field_jobs').updateOne({ _id: id }, { $set: { status, updatedAt: new Date() } });
    res.redirect('/admin/field/jobs/' + id + '?success=status_updated');
  } catch (err) {
    console.error('[admin/field] status error:', err);
    res.redirect('/admin/field?error=' + encodeURIComponent('Could not update status.'));
  }
});

// ── POST /admin/field/jobs/:id/assign — set assigned staff (multi) ────────────
router.post('/jobs/:id/assign', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));
    // Checkboxes: assignedTo may be a single value or an array; normalize.
    let raw = req.body.assignedTo || [];
    if (!Array.isArray(raw)) raw = [raw];
    const assignedTo = raw.map(oid).filter(Boolean);
    await req.db.collection('field_jobs').updateOne({ _id: id }, { $set: { assignedTo, updatedAt: new Date() } });
    res.redirect('/admin/field/jobs/' + id + '?success=assigned');
  } catch (err) {
    console.error('[admin/field] assign error:', err);
    res.redirect('/admin/field?error=' + encodeURIComponent('Could not assign staff.'));
  }
});

// ── POST /admin/field/jobs/:id/notes — add an on-site note ────────────────────
router.post('/jobs/:id/notes', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const id = oid(req.params.id);
    const body = (req.body.body || '').trim();
    if (!id) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));
    if (!body) return res.redirect('/admin/field/jobs/' + id + '?error=' + encodeURIComponent('Note is empty.'));
    const note = { id: new ObjectId(), body, by: req.adminUser?.email || '', at: new Date() };
    await req.db.collection('field_jobs').updateOne(
      { _id: id },
      { $push: { notes: note }, $set: { updatedAt: new Date() } },
    );
    res.redirect('/admin/field/jobs/' + id + '?success=note_added');
  } catch (err) {
    console.error('[admin/field] note error:', err);
    res.redirect('/admin/field?error=' + encodeURIComponent('Could not add note.'));
  }
});

// ── POST /admin/field/jobs/:id/uploads — attach a private file ────────────────
router.post('/jobs/:id/uploads', fieldUpload.single('file'), async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));
    if (!req.file) return res.redirect('/admin/field/jobs/' + id + '?error=' + encodeURIComponent('No file selected.'));
    const up = await uploadPrivateBuffer(req.file.buffer, {
      prefix: req.tenant?.s3Prefix,
      folder: 'field/' + id,
      name: req.file.originalname,
      contentType: req.file.mimetype,
    });
    const entry = {
      id: new ObjectId(), key: up.key, name: req.file.originalname,
      type: req.file.mimetype, size: req.file.size, by: req.adminUser?.email || '', at: new Date(),
    };
    await req.db.collection('field_jobs').updateOne(
      { _id: id },
      { $push: { uploads: entry }, $set: { updatedAt: new Date() } },
    );
    res.redirect('/admin/field/jobs/' + id + '?success=file_uploaded');
  } catch (err) {
    console.error('[admin/field] upload error:', err);
    res.redirect('/admin/field/jobs/' + req.params.id + '?error=' + encodeURIComponent('Upload failed.'));
  }
});

// ── POST /admin/field/jobs/:id/waivers — capture a signed waiver ──────────────
// Accepts a signature data URL (canvas) + a waiver label; stores the signature
// image privately and records who signed.
router.post('/jobs/:id/waivers', express.urlencoded({ extended: false, limit: '3mb' }), async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));
    const label = (req.body.label || 'Waiver').trim();
    const signedBy = (req.body.signedBy || '').trim();
    const dataUrl = String(req.body.signature || '');
    const m = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
    if (!m || !signedBy) return res.redirect('/admin/field/jobs/' + id + '?error=' + encodeURIComponent('A name and signature are required.'));

    const buf = Buffer.from(m[2], 'base64');
    const up = await uploadPrivateBuffer(buf, {
      prefix: req.tenant?.s3Prefix,
      folder: 'field/' + id + '/waivers',
      name: 'signature.png',
      contentType: m[1],
    });
    const entry = {
      id: new ObjectId(), key: up.key, name: label,
      signedBy, signedAt: new Date(), by: req.adminUser?.email || '',
    };
    await req.db.collection('field_jobs').updateOne(
      { _id: id },
      { $push: { waivers: entry }, $set: { updatedAt: new Date() } },
    );
    res.redirect('/admin/field/jobs/' + id + '?success=waiver_saved');
  } catch (err) {
    console.error('[admin/field] waiver error:', err);
    res.redirect('/admin/field/jobs/' + req.params.id + '?error=' + encodeURIComponent('Could not save waiver.'));
  }
});

// ── GET /admin/field/jobs/:id/files/:fileId — authed private-file stream ───────
// Serves an upload or a waiver signature by its record id (never a public URL).
router.get('/jobs/:id/files/:fileId', async (req, res) => {
  try {
    const job = await loadJob(req);
    if (!job) return res.status(404).send('Not found');
    const all = [...(job.uploads || []), ...(job.waivers || [])];
    const rec = all.find((f) => f.id?.toString() === req.params.fileId);
    if (!rec) return res.status(404).send('Not found');

    const obj = await getObjectStream(rec.key);
    res.setHeader('Content-Type', obj.ContentType || 'application/octet-stream');
    if (obj.ContentLength != null) res.setHeader('Content-Length', obj.ContentLength);
    const fname = (rec.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-');
    res.setHeader('Content-Disposition', 'inline; filename="' + fname + '"');
    res.setHeader('Cache-Control', 'private, no-store');
    obj.Body.pipe(res);
  } catch (err) {
    console.error('[admin/field] file stream error:', err);
    if (!res.headersSent) res.status(500).send('Could not load file.');
  }
});

// ── POST /admin/field/jobs/:id/quote — create a linked engagement (quote) ─────
// Reuses the existing engagements system: creates a draft engagement for the
// job's client, tags it fieldJobId, links it back onto the job, and hands off to
// the standard engagement editor.
router.post('/jobs/:id/quote', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const db = req.db;
    const job = await loadJob(req);
    if (!job) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));
    if (!job.clientId) return res.redirect('/admin/field/jobs/' + job._id + '?error=' + encodeURIComponent('Assign a client before quoting.'));
    if (job.engagementId) return res.redirect('/admin/clients/' + job.clientId + '/engagements/' + job.engagementId);

    const client = await db.collection('clients').findOne({ _id: job.clientId });
    if (!client) return res.redirect('/admin/field/jobs/' + job._id + '?error=' + encodeURIComponent('Client not found.'));

    const engagementNumber = await generateEngagementNumber(db, req.tenant);
    const now = new Date();
    const r = await db.collection('engagements').insertOne({
      clientId: client._id.toString(),
      engagementNumber,
      title: 'Field Quote — ' + job.title,
      status: 'draft',
      accessToken: generateEngagementToken(),
      intro: '',
      termsSections: DEFAULT_TERM_SECTIONS.map((s) => ({ ...s })),
      validUntil: null,
      draftPackages: [], packages: [], selections: {}, notes: [],
      declined: null, signature: null, acknowledgedAt: null, acknowledgedBy: null,
      w9: { requestedAt: null, requestedBy: null, releasedAt: null, releasedBy: null, fileId: null, revision: null },
      auditLog: [], sentAt: null, sentTo: null, viewedAt: null, viewCount: 0,
      invoiceIds: [],
      fieldJobId: job._id,   // backlink so the quote knows its field job
      createdAt: now, updatedAt: now,
    });
    await db.collection('field_jobs').updateOne(
      { _id: job._id },
      { $set: { engagementId: r.insertedId, updatedAt: now } },
    );
    // Hand off to the existing engagement editor.
    res.redirect('/admin/clients/' + client._id + '/engagements/' + r.insertedId);
  } catch (err) {
    console.error('[admin/field] quote error:', err);
    res.redirect('/admin/field/jobs/' + req.params.id + '?error=' + encodeURIComponent('Could not create quote.'));
  }
});

// ── POST /admin/field/jobs/:id/geo — pin the site location ────────────────────
// lat/lng come either from the live GPS map ("use current location") or manual
// entry. Used for route sequencing + client ETA math.
router.post('/jobs/:id/geo', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.redirect('/admin/field/jobs/' + id + '?error=' + encodeURIComponent('Enter a valid latitude and longitude.'));
    }
    await req.db.collection('field_jobs').updateOne(
      { _id: id },
      { $set: { geo: { lat, lng }, updatedAt: new Date() } },
    );
    res.redirect('/admin/field/jobs/' + id + '?success=geo_set');
  } catch (err) {
    console.error('[admin/field] geo error:', err);
    res.redirect('/admin/field/jobs/' + req.params.id + '?error=' + encodeURIComponent('Could not set location.'));
  }
});

// ── POST /admin/field/jobs/:id/eta — compute + report ETA to the client ───────
// Body { lat, lng } = the tech's current position (from the live map). Computes
// drive time to this job's pin, stores it, and emails the client if requested.
router.post('/jobs/:id/eta', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const db = req.db;
    const job = await loadJob(req);
    if (!job) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));
    const dest = jobPin(job);
    if (!dest) return res.redirect('/admin/field/jobs/' + job._id + '?error=' + encodeURIComponent('Pin the site location first.'));

    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    const from = (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
    const eta = etaFrom(from, dest, new Date());
    if (!eta) return res.redirect('/admin/field/jobs/' + job._id + '?error=' + encodeURIComponent('No current location to measure from — start live sharing first.'));

    const notify = req.body.notify === 'true' || req.body.notify === 'on';
    const record = { minutes: eta.minutes, arriveBy: eta.arriveBy, reportedAt: new Date(), notified: false };

    if (notify && job.clientId) {
      const client = await db.collection('clients').findOne({ _id: job.clientId }, { projection: { name: 1, email: 1 } });
      if (client?.email) {
        const when = eta.arriveBy ? eta.arriveBy.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const brandName = req.tenant?.brand?.name || req.tenant?.public?.businessName || 'Your technician';
        try {
          await sendClientEmail(
            client.email, [],
            `On our way — ~${eta.minutes} min out`,
            `<p>Hi ${client.name || 'there'},</p>` +
            `<p>${brandName} is on the way to <strong>${job.title}</strong> and is about ` +
            `<strong>${eta.minutes} minutes</strong> away${when ? ` (arriving around <strong>${when}</strong>)` : ''}.</p>`,
            null, req.tenant,
          );
          record.notified = true;
        } catch (e) { console.error('[admin/field] eta email error:', e.message); }
      }
    }

    await db.collection('field_jobs').updateOne({ _id: job._id }, { $set: { eta: record, updatedAt: new Date() } });
    res.redirect('/admin/field/jobs/' + job._id + '?success=' + (record.notified ? 'eta_sent' : 'eta_saved'));
  } catch (err) {
    console.error('[admin/field] eta error:', err);
    res.redirect('/admin/field/jobs/' + req.params.id + '?error=' + encodeURIComponent('Could not compute ETA.'));
  }
});

// ── POST /admin/field/jobs/:id/client-link — mint + email a short-lived link ──
// Generates (or refreshes) the job's magic-link token, sets an expiry, and emails
// the client a link to the public /field/:token portal (view ETA, sign quote, pay).
router.post('/jobs/:id/client-link', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const db = req.db;
    const job = await loadJob(req);
    if (!job) return res.redirect('/admin/field?error=' + encodeURIComponent('Job not found.'));
    if (!job.clientId) return res.redirect('/admin/field/jobs/' + job._id + '?error=' + encodeURIComponent('Assign a client with an email first.'));
    const client = await db.collection('clients').findOne({ _id: job.clientId }, { projection: { name: 1, email: 1 } });
    if (!client?.email) return res.redirect('/admin/field/jobs/' + job._id + '?error=' + encodeURIComponent('This client has no email on file.'));

    // Reuse the existing token if it's still valid; else mint a fresh one.
    const now = new Date();
    const stillValid = job.accessToken && !job.linkRevoked && job.linkValidUntil && new Date(job.linkValidUntil) > now;
    const token = stillValid ? job.accessToken : generateEngagementToken();
    const validUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days
    await db.collection('field_jobs').updateOne(
      { _id: job._id },
      { $set: { accessToken: token, linkValidUntil: validUntil, linkRevoked: false, updatedAt: now } },
    );

    const base = req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN;
    const url = base + '/field/' + token;
    const brandName = req.tenant?.brand?.name || req.tenant?.public?.businessName || 'Your service team';
    try {
      await sendClientEmail(
        client.email, [],
        'Your job with ' + brandName,
        `<p>Hi ${client.name || 'there'},</p>` +
        `<p>Here's your secure link for <strong>${job.title}</strong> — check your technician's ETA, ` +
        `review and sign your quote, and pay any invoices, all in one place.</p>` +
        `<p><a href="${url}">Open your secure link</a></p>` +
        `<p style="color:#888;font-size:12px;">This link expires in 14 days.</p>`,
        null, req.tenant,
      );
    } catch (e) {
      console.error('[admin/field] client-link email error:', e.message);
      return res.redirect('/admin/field/jobs/' + job._id + '?error=' + encodeURIComponent('Link saved but the email could not be sent.'));
    }
    res.redirect('/admin/field/jobs/' + job._id + '?success=link_sent');
  } catch (err) {
    console.error('[admin/field] client-link error:', err);
    res.redirect('/admin/field/jobs/' + req.params.id + '?error=' + encodeURIComponent('Could not send link.'));
  }
});

// ── GET /admin/field/route — a tech's day, sequenced with commute + arrival ───
router.get('/route', async (req, res) => {
  try {
    const db = req.db;
    const techs = await db.collection('users')
      .find({ fieldEnabled: true }).project({ displayName: 1, email: 1 }).sort({ displayName: 1 }).toArray();

    const techId = oid(req.query.tech);
    // Default to today (local server day) when no date given.
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(dateStr + 'T00:00:00');
    const dayEnd = new Date(dateStr + 'T23:59:59.999');

    let route = null, jobs = [];
    if (techId) {
      jobs = await db.collection('field_jobs')
        .find({
          assignedTo: techId,
          status: { $nin: ['canceled', 'complete'] },
          $or: [
            { scheduledAt: { $gte: dayStart, $lte: dayEnd } },
            { scheduledAt: null },
          ],
        })
        .sort({ scheduledAt: 1, createdAt: 1 })
        .toArray();
      route = buildRoute(jobs);
    }

    const clients = await db.collection('clients')
      .find({}, { projection: { name: 1, email: 1, company: 1 } }).toArray();
    const clientMap = {};
    clients.forEach((c) => { clientMap[c._id.toString()] = c.name || c.company || c.email || 'Client'; });

    renderSafe(res, 'admin/field/route', {
      user: req.adminUser, page: 'field', title: 'Field Route',
      techs, route, clientMap,
      selectedTech: req.query.tech || '',
      selectedDate: dateStr,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[admin/field] route error:', err);
    res.status(500).send('Error building route');
  }
});

export default router;
