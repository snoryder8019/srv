/**
 * Admin — Careers
 *
 * Two collections back this module:
 *   jobs              — postings (mirrors the blog doc shape + hiring fields)
 *   job_applications  — one doc per submission; `resumeKey` points at a PRIVATE
 *                       S3 object (never public — see plugins/s3.js).
 *
 * Postings are managed here; applications are received by the public apply
 * handler in routes/index.js and read back through the inbox below. Résumés are
 * streamed via an authed route (getObjectStream) so a CV never sits behind a
 * guessable public URL.
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import { getObjectStream } from '../../plugins/s3.js';
import { jobLocationParts, jobLocationDisplay } from '../../plugins/jobFeeds.js';
import { publishToPlatform } from '../../plugins/socialPublish.js';
import { loadAccountMap } from './social/shared.js';

// Auto-announce a newly-opened posting to LinkedIn via the tenant's connected
// account, when the tenant has enabled it (design KV careers_announce_linkedin).
// Best-effort, idempotent, and non-blocking: never throws, runs in the background
// after the response, and records job.announce.linkedin so re-opening the same
// posting won't re-post. Manual re-share is always available via the Share button.
async function maybeAnnounceOnLinkedIn(req, jobId) {
  try {
    const db = req.db;
    const flag = await db.collection('design').findOne({ key: 'careers_announce_linkedin' });
    if (flag?.value !== 'true') return;

    const job = await db.collection('jobs').findOne({ _id: jobId });
    if (!job || job.status !== 'open') return;
    if (job.announce?.linkedin?.at) return; // already announced once

    const account = (await loadAccountMap(db))?.linkedin;
    if (!account) return; // LinkedIn not connected

    const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const url = `${proto}://${req.tenant?.domain || req.hostname}/careers/${job.slug}`;
    const loc = jobLocationDisplay(job) || job.location || (job.remote ? 'Remote' : '');
    const body = [
      `We're hiring: ${job.title}${loc ? ` — ${loc}` : ''}.`,
      job.department ? `Team: ${job.department}.` : '',
      'Apply here:',
    ].filter(Boolean).join(' ');

    const result = await publishToPlatform('linkedin',
      { body, link: url, platforms: ['linkedin'], format: 'single', mediaUrls: [] }, account);

    await db.collection('jobs').updateOne({ _id: jobId }, {
      $set: { 'announce.linkedin': {
        at: new Date(), ok: !!result.ok, id: result.id || null,
        url: result.url || null, error: result.ok ? null : (result.error || 'failed'),
      } },
    });
    if (!result.ok) console.warn('[careers] LinkedIn announce failed:', result.error);
  } catch (err) {
    console.warn('[careers] announce error (non-fatal):', err.message);
  }
}

const router = express.Router();

// Application pipeline stages — mirrors how clients/inquiries model progress.
export const STAGES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'];
const STAGE_SET = new Set(STAGES);

const EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'temporary', 'internship'];
// applyMode decides whether job_applications is populated per posting:
//   internal → on-site form (populates job_applications)
//   external → link out to an ATS/board (Indeed, LinkedIn, "Made In", …)
//   email    → mailto: the tenant recipient
export const APPLY_MODES = ['internal', 'external', 'email'];

function toSlug(str) {
  return String(str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Per-process guard so we ensure the jobs.slug unique index once per tenant DB.
// Existing tenants get `jobs` lazily on first insert, so the index can't live in
// provision.js alone — precedent: ensureShareIndexes() in plugins/shareLink.js.
const _indexed = new Set();
async function ensureCareerIndexes(db) {
  const name = db.databaseName;
  if (_indexed.has(name)) return;
  _indexed.add(name);
  try {
    await db.collection('jobs').createIndex({ slug: 1 }, { unique: true });
    await db.collection('job_applications').createIndex({ jobId: 1, createdAt: -1 });
  } catch (e) {
    _indexed.delete(name); // let a later call retry
    console.warn('[careers] index ensure failed (non-fatal):', e.message);
  }
}

// Build a job doc from the posting form. Shared by create + update.
function jobFromBody(body) {
  const employmentType = EMPLOYMENT_TYPES.includes(body.employmentType) ? body.employmentType : 'full-time';
  const applyMode = APPLY_MODES.includes(body.applyMode) ? body.applyMode : 'internal';
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  // Structured location. `location` is kept as a derived display string (and for
  // legacy back-compat); the feed/schema builders read the structured parts.
  const city = (body.city || '').trim();
  const region = (body.region || '').trim();
  const country = (body.country || '').trim();
  const postalCode = (body.postalCode || '').trim();
  const location = [city, region, country].filter(Boolean).join(', ') || (body.location || '').trim();
  return {
    title: (body.title || '').trim(),
    department: (body.department || '').trim(),
    city, region, country, postalCode,
    location,
    employmentType,
    remote: body.remote === 'on' || body.remote === 'true' || body.remote === true,
    salaryMin: num(body.salaryMin),
    salaryMax: num(body.salaryMax),
    salaryCurrency: (body.salaryCurrency || 'USD').trim().slice(0, 8).toUpperCase() || 'USD',
    description: body.description || '',
    requirements: (body.requirements || '').split('\n').map((s) => s.trim()).filter(Boolean),
    benefits: (body.benefits || '').split('\n').map((s) => s.trim()).filter(Boolean),
    applyMode,
    applyUrl: (body.applyUrl || '').trim(),      // external mode
    applyEmail: (body.applyEmail || '').trim(),  // email mode
    closesAt: body.closesAt ? new Date(body.closesAt) : null,
  };
}

// ── Postings ─────────────────────────────────────────────────────────────────

// List postings + application counts.
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    await ensureCareerIndexes(db);
    const jobs = await db.collection('jobs').find({}).sort({ createdAt: -1 }).toArray();
    // Attach application counts (open pipeline = everything not hired/rejected).
    const counts = await db.collection('job_applications').aggregate([
      { $group: { _id: '$jobId', total: { $sum: 1 },
        open: { $sum: { $cond: [{ $in: ['$stage', ['hired', 'rejected']] }, 0, 1] } } } },
    ]).toArray();
    const byJob = {};
    counts.forEach((c) => { byJob[String(c._id)] = c; });
    jobs.forEach((j) => { j.appCount = byJob[String(j._id)] || { total: 0, open: 0 }; });

    res.render('admin/careers/index', {
      user: req.adminUser, page: 'careers', title: 'Careers', jobs,
      msg: req.query.msg, err: req.query.err,
    });
  } catch (err) {
    console.error('[careers] list error:', err);
    res.redirect('/admin');
  }
});

// New posting form.
router.get('/new', async (req, res) => {
  const db = req.db;
  const departments = (await db.collection('jobs').distinct('department')).filter(Boolean).sort();
  res.render('admin/careers/form', {
    user: req.adminUser, page: 'careers', title: 'New Posting', job: null, error: null,
    employmentTypes: EMPLOYMENT_TYPES, applyModes: APPLY_MODES, departments,
  });
});

// Create posting.
router.post('/', async (req, res) => {
  const db = req.db;
  try {
    const doc = jobFromBody(req.body);
    if (!doc.title) throw new Error('Title is required.');
    doc.slug = req.body.slug ? toSlug(req.body.slug) : toSlug(doc.title);
    const dup = await db.collection('jobs').findOne({ slug: doc.slug });
    if (dup) {
      const departments = (await db.collection('jobs').distinct('department')).filter(Boolean).sort();
      return res.render('admin/careers/form', {
        user: req.adminUser, page: 'careers', title: 'New Posting', job: req.body,
        employmentTypes: EMPLOYMENT_TYPES, applyModes: APPLY_MODES, departments,
        error: 'A posting with that slug already exists. Choose a different title or slug.',
      });
    }
    const now = new Date();
    const status = req.body.status === 'open' ? 'open' : 'draft';
    const { insertedId } = await db.collection('jobs').insertOne({
      ...doc, status,
      publishedAt: status === 'open' ? now : null,
      createdAt: now, updatedAt: now,
    });
    if (status === 'open') maybeAnnounceOnLinkedIn(req, insertedId); // background
    res.redirect('/admin/careers?msg=created');
  } catch (err) {
    console.error('[careers] create error:', err);
    const departments = (await db.collection('jobs').distinct('department')).filter(Boolean).sort();
    res.render('admin/careers/form', {
      user: req.adminUser, page: 'careers', title: 'New Posting', job: req.body,
      employmentTypes: EMPLOYMENT_TYPES, applyModes: APPLY_MODES, departments,
      error: err.message || 'Failed to create posting.',
    });
  }
});

// Edit posting form.
router.get('/:id/edit', async (req, res) => {
  try {
    const db = req.db;
    if (!ObjectId.isValid(req.params.id)) return res.redirect('/admin/careers');
    const job = await db.collection('jobs').findOne({ _id: new ObjectId(req.params.id) });
    if (!job) return res.redirect('/admin/careers');
    // Prefill structured parts for legacy docs that only stored free-text location.
    if (!(job.city || job.region || job.country || job.postalCode)) {
      const p = jobLocationParts(job);
      job.city = p.city; job.region = p.region; job.country = p.country; job.postalCode = p.postalCode;
    }
    const departments = (await db.collection('jobs').distinct('department')).filter(Boolean).sort();
    res.render('admin/careers/form', {
      user: req.adminUser, page: 'careers', title: 'Edit Posting', job, error: null,
      employmentTypes: EMPLOYMENT_TYPES, applyModes: APPLY_MODES, departments,
    });
  } catch (err) {
    console.error('[careers] edit form error:', err);
    res.redirect('/admin/careers');
  }
});

// Update posting.
router.post('/:id', async (req, res) => {
  const db = req.db;
  try {
    if (!ObjectId.isValid(req.params.id)) return res.redirect('/admin/careers');
    const _id = new ObjectId(req.params.id);
    const doc = jobFromBody(req.body);
    if (!doc.title) throw new Error('Title is required.');
    doc.slug = req.body.slug ? toSlug(req.body.slug) : toSlug(doc.title);
    const dup = await db.collection('jobs').findOne({ slug: doc.slug, _id: { $ne: _id } });
    if (dup) throw new Error('That slug is already used by another posting.');
    const now = new Date();
    const status = req.body.status === 'open' ? 'open' : 'draft';
    const existing = await db.collection('jobs').findOne({ _id });
    await db.collection('jobs').updateOne({ _id }, {
      $set: {
        ...doc, status, updatedAt: now,
        // Stamp publishedAt the first time it goes open; keep it thereafter.
        publishedAt: status === 'open' ? (existing?.publishedAt || now) : (existing?.publishedAt || null),
      },
    });
    if (status === 'open') maybeAnnounceOnLinkedIn(req, _id); // background; guard prevents re-posting
    res.redirect('/admin/careers?msg=updated');
  } catch (err) {
    console.error('[careers] update error:', err);
    const departments = (await db.collection('jobs').distinct('department')).filter(Boolean).sort();
    res.render('admin/careers/form', {
      user: req.adminUser, page: 'careers', title: 'Edit Posting',
      job: { ...req.body, _id: req.params.id },
      employmentTypes: EMPLOYMENT_TYPES, applyModes: APPLY_MODES, departments,
      error: err.message || 'Failed to update posting.',
    });
  }
});

// Toggle open/close.
router.post('/:id/publish', async (req, res) => {
  try {
    const db = req.db;
    if (!ObjectId.isValid(req.params.id)) return res.redirect('/admin/careers');
    const _id = new ObjectId(req.params.id);
    const job = await db.collection('jobs').findOne({ _id });
    const now = new Date();
    const open = job?.status !== 'open';
    await db.collection('jobs').updateOne({ _id }, {
      $set: { status: open ? 'open' : 'draft', updatedAt: now,
        publishedAt: open ? (job?.publishedAt || now) : (job?.publishedAt || null) },
    });
    if (open) maybeAnnounceOnLinkedIn(req, _id); // background
    res.redirect(`/admin/careers?msg=${open ? 'published' : 'closed'}`);
  } catch (err) {
    console.error('[careers] publish error:', err);
    res.redirect('/admin/careers?err=1');
  }
});

// Delete posting.
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    if (!ObjectId.isValid(req.params.id)) return res.redirect('/admin/careers');
    await db.collection('jobs').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/careers?msg=deleted');
  } catch (err) {
    console.error('[careers] delete error:', err);
    res.redirect('/admin/careers?err=1');
  }
});

// ── Connectors / syndication (outbound feeds) ────────────────────────────────
// Boards ingest postings by polling a feed URL — no per-tenant API key. This page
// hands the tenant those URLs. Google Jobs is automatic via JobPosting structured
// data; other boards take the XML or RSS feed.
router.get('/connectors', async (req, res) => {
  try {
    const db = req.db;
    // Canonical public domain (custom domain preferred), so the feed URLs we hand
    // to boards point at the real site, not the wildcard subdomain.
    const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const origin = `${proto}://${req.tenant?.domain || req.hostname}`;
    const openCount = await db.collection('jobs').countDocuments({ status: 'open' });
    const feeds = {
      xml: `${origin}/careers/feed.xml`,
      rss: `${origin}/careers/feed.rss`,
      atom: `${origin}/careers/feed.atom`,
      careers: `${origin}/careers`,
    };
    const boards = [
      { name: 'Google Jobs', how: 'Automatic — every open posting emits JobPosting structured data. Submit /careers in Google Search Console to speed indexing.', url: feeds.careers, badge: 'structured-data' },
      { name: 'Job boards (XML feed)', how: 'Most boards accept a standard XML job feed — give them this URL in their feed settings.', url: feeds.xml, badge: 'xml' },
      { name: 'RSS / Zapier / Make', how: 'Standard RSS — wire into Zapier/Make to fan out to your own channels.', url: feeds.rss, badge: 'rss' },
    ];
    // LinkedIn auto-announce: on/off + whether a LinkedIn account is connected.
    const flag = await db.collection('design').findOne({ key: 'careers_announce_linkedin' });
    const announce = {
      enabled: flag?.value === 'true',
      linkedinConnected: !!(await loadAccountMap(db))?.linkedin,
    };
    res.render('admin/careers/connectors', {
      user: req.adminUser, page: 'careers', title: 'Connectors',
      feeds, boards, openCount, origin, announce, msg: req.query.msg,
    });
  } catch (err) {
    console.error('[careers] connectors error:', err);
    res.redirect('/admin/careers');
  }
});

// Toggle LinkedIn auto-announce-on-publish (stored in the design KV).
router.post('/connectors/announce', async (req, res) => {
  try {
    const db = req.db;
    const on = req.body.enabled === 'on' || req.body.enabled === 'true';
    await db.collection('design').updateOne(
      { key: 'careers_announce_linkedin' },
      { $set: { key: 'careers_announce_linkedin', value: on ? 'true' : 'false', updatedAt: new Date() } },
      { upsert: true },
    );
    res.redirect('/admin/careers/connectors?msg=announce');
  } catch (err) {
    console.error('[careers] announce toggle error:', err);
    res.redirect('/admin/careers/connectors?err=1');
  }
});

// ── Applications inbox ───────────────────────────────────────────────────────

// All applications, optionally filtered by ?job=<id> and ?stage=<stage>.
router.get('/applications', async (req, res) => {
  try {
    const db = req.db;
    const query = {};
    if (req.query.job && ObjectId.isValid(req.query.job)) query.jobId = new ObjectId(req.query.job);
    if (req.query.stage && STAGE_SET.has(req.query.stage)) query.stage = req.query.stage;

    const [applications, jobs] = await Promise.all([
      db.collection('job_applications').find(query).sort({ createdAt: -1 }).toArray(),
      db.collection('jobs').find({}, { projection: { title: 1, slug: 1 } }).toArray(),
    ]);
    const jobTitle = {};
    jobs.forEach((j) => { jobTitle[String(j._id)] = j.title; });
    applications.forEach((a) => { a.jobTitle = jobTitle[String(a.jobId)] || '—'; });

    res.render('admin/careers/applications', {
      user: req.adminUser, page: 'careers', title: 'Applications',
      applications, jobs, stages: STAGES,
      activeJob: req.query.job || '', activeStage: req.query.stage || '',
      msg: req.query.msg, err: req.query.err,
    });
  } catch (err) {
    console.error('[careers] applications error:', err);
    res.redirect('/admin/careers');
  }
});

// Application detail.
router.get('/applications/:id', async (req, res) => {
  try {
    const db = req.db;
    if (!ObjectId.isValid(req.params.id)) return res.redirect('/admin/careers/applications');
    const application = await db.collection('job_applications').findOne({ _id: new ObjectId(req.params.id) });
    if (!application) return res.redirect('/admin/careers/applications');
    const job = application.jobId
      ? await db.collection('jobs').findOne({ _id: new ObjectId(application.jobId) })
      : null;
    res.render('admin/careers/application', {
      user: req.adminUser, page: 'careers', title: 'Application',
      application, job, stages: STAGES, msg: req.query.msg,
    });
  } catch (err) {
    console.error('[careers] application detail error:', err);
    res.redirect('/admin/careers/applications');
  }
});

// Move an application through the pipeline.
router.post('/applications/:id/stage', async (req, res) => {
  try {
    const db = req.db;
    if (!ObjectId.isValid(req.params.id)) return res.redirect('/admin/careers/applications');
    const stage = STAGE_SET.has(req.body.stage) ? req.body.stage : 'new';
    await db.collection('job_applications').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { stage, updatedAt: new Date() } },
    );
    res.redirect(`/admin/careers/applications/${req.params.id}?msg=stage`);
  } catch (err) {
    console.error('[careers] stage error:', err);
    res.redirect('/admin/careers/applications?err=1');
  }
});

// Authed résumé download — streams the PRIVATE S3 object. There is no public URL
// for this key; access is gated by the same admin middleware as the rest of
// /admin/careers, so a CV (with PII) is never reachable by guessing the path.
router.get('/applications/:id/resume', async (req, res) => {
  try {
    const db = req.db;
    if (!ObjectId.isValid(req.params.id)) return res.status(404).send('Not found');
    const application = await db.collection('job_applications').findOne({ _id: new ObjectId(req.params.id) });
    if (!application?.resumeKey) return res.status(404).send('No résumé on file');

    const obj = await getObjectStream(application.resumeKey);
    res.setHeader('Content-Type', obj.ContentType || 'application/octet-stream');
    if (obj.ContentLength != null) res.setHeader('Content-Length', obj.ContentLength);
    // inline so it previews in-browser; the filename is the applicant's own.
    const fname = (application.resumeName || 'resume').replace(/[^a-zA-Z0-9._-]+/g, '-');
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    obj.Body.pipe(res);
  } catch (err) {
    console.error('[careers] resume stream error:', err);
    if (!res.headersSent) res.status(500).send('Could not load résumé.');
  }
});

export default router;
