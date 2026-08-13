/**
 * Public — Careers
 *
 * GET  /careers            → list of OPEN postings
 * GET  /careers/:slug      → posting detail + apply form (internal mode)
 * POST /careers/:slug/apply→ receive an application; résumé is stored PRIVATELY
 *                            (uploadPrivateBuffer) and never gets a public URL.
 *
 * Only `applyMode: 'internal'` postings populate job_applications here; external
 * and email modes link out (an ATS/board or mailto) and are rendered as such.
 */
import express from 'express';
import multer from 'multer';
import { uploadPrivateBuffer } from '../plugins/s3.js';
import { notifyAdmin } from '../plugins/notify.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { buildRssFeed, buildAtomFeed } from '../plugins/feeds.js';
import { buildJobPostingLd, buildJobListLd, buildJobFeedXml, jobLocationDisplay } from '../plugins/jobFeeds.js';

const router = express.Router();

// Absolute origin for this tenant, e.g. https://acme.com (no trailing /). Uses
// the tenant's CANONICAL public domain (custom domain preferred — see
// middleware/tenant.js), NOT req.hostname, so feed + JobPosting URLs always point
// at the canonical site even when the feed is fetched via the wildcard subdomain.
// Boards/Google index whatever URL we emit, so this must be the real public host.
const siteOrigin = (req) => {
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${proto}://${req.tenant?.domain || req.hostname}`;
};

// Résumés only — small, in-memory, streamed straight to private S3.
const RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (RESUME_TYPES.has(file.mimetype)) return cb(null, true);
    cb(null, false); // reject quietly; handler treats a missing file as "no résumé"
  },
});

async function getDesign(db) {
  const design = { ...DESIGN_DEFAULTS };
  if (!db) return design;
  const rows = await db.collection('design').find({}).toArray();
  for (const item of rows) design[item.key] = item.value;
  return design;
}

// Public projection of a posting — drop internal/PII-adjacent fields.
function publicJob(j) {
  return {
    _id: j._id, title: j.title, slug: j.slug, department: j.department,
    location: jobLocationDisplay(j) || j.location || '', employmentType: j.employmentType, remote: !!j.remote,
    salaryMin: j.salaryMin, salaryMax: j.salaryMax, salaryCurrency: j.salaryCurrency,
    description: j.description, requirements: j.requirements || [], benefits: j.benefits || [],
    applyMode: j.applyMode || 'internal', applyUrl: j.applyUrl || '', applyEmail: j.applyEmail || '',
    publishedAt: j.publishedAt, closesAt: j.closesAt,
  };
}

// A posting is live if open and not past its close date.
function isLive(j) {
  if (j.status !== 'open') return false;
  if (j.closesAt && new Date(j.closesAt) < new Date()) return false;
  return true;
}

// ── List ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    if (!req.db) return next();
    const [design, jobsRaw] = await Promise.all([
      getDesign(req.db),
      req.db.collection('jobs').find({ status: 'open' }).sort({ publishedAt: -1, createdAt: -1 }).toArray(),
    ]);
    const jobs = jobsRaw.filter(isLive).map(publicJob);
    const brand = res.locals.brand || {};
    const origin = siteOrigin(req);
    const jsonLd = jobs.length ? buildJobListLd({ jobs, siteOrigin: origin, brandName: brand.name }) : null;
    res.setSeo?.({
      title: `Careers — ${brand.name || 'Home'}`,
      description: `Open positions at ${brand.name || 'our team'}.`,
      canonical: `${origin}/careers`,
      ...(jsonLd ? { jsonLd: [jsonLd] } : {}),
    });
    res.render('careers/index', { design, brand, jobs, jsonLd });
  } catch (err) {
    console.error('[careers/public] list error:', err);
    next(err);
  }
});

// ── Syndication feeds ──────────────────────────────────────────────────────
// Registered BEFORE `/:slug` so "feed.xml" / "feed.rss" aren't read as a slug.
// Fetch the same live, open postings the public list shows.
async function liveJobs(db) {
  const raw = await db.collection('jobs').find({ status: 'open' })
    .sort({ publishedAt: -1, createdAt: -1 }).toArray();
  return raw.filter(isLive);
}

// Indeed / ZipRecruiter / generic job-board XML feed. This is the "connector":
// a tenant pastes this URL into a board's feed settings and postings syndicate.
router.get('/feed.xml', async (req, res, next) => {
  try {
    if (!req.db) return next();
    const jobs = await liveJobs(req.db);
    const brand = res.locals.brand || {};
    // Indeed marks <email> (account contact) required — use the tenant's configured
    // contact email, falling back to the brand email.
    const contactEmail = req.tenant?.meta?.contactEmail || brand.email || '';
    const xml = buildJobFeedXml({
      jobs, brandName: brand.name || req.hostname,
      siteOrigin: siteOrigin(req), publisherUrl: siteOrigin(req), contactEmail,
    });
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('[careers/public] indeed feed error:', err);
    res.status(500).send('Error generating feed');
  }
});

function jobsFeedHandler(fmt) {
  return async (req, res, next) => {
    try {
      if (!req.db) return next();
      const jobs = await liveJobs(req.db);
      const brand = res.locals.brand || {};
      const brandName = brand.name || req.hostname;
      const origin = siteOrigin(req);
      const siteUrl = `${origin}/careers`;
      const items = jobs.map((j) => ({
        title: j.title,
        url: `${origin}/careers/${j.slug}`,
        excerpt: [j.department, j.location || (j.remote ? 'Remote' : '')].filter(Boolean).join(' · '),
        content: j.description || '',
        category: j.department || '',
        publishedAt: j.publishedAt || j.createdAt,
        updatedAt: j.updatedAt || j.publishedAt || j.createdAt,
      }));
      const opts = {
        title: `${brandName} — Careers`, description: `Open positions at ${brandName}.`,
        siteUrl, feedUrl: `${siteUrl}/feed.${fmt}`, authorName: brandName, items,
      };
      const xml = fmt === 'atom' ? buildAtomFeed(opts) : buildRssFeed(opts);
      res.type(fmt === 'atom' ? 'application/atom+xml' : 'application/rss+xml').send(xml);
    } catch (err) {
      console.error('[careers/public] feed error:', err);
      res.status(500).send('Error generating feed');
    }
  };
}
router.get('/feed.rss', jobsFeedHandler('rss'));
router.get('/feed.atom', jobsFeedHandler('atom'));

// ── Detail + apply form ────────────────────────────────────────────────────
router.get('/:slug', async (req, res, next) => {
  try {
    if (!req.db) return next();
    const [design, raw] = await Promise.all([
      getDesign(req.db),
      req.db.collection('jobs').findOne({ slug: req.params.slug }),
    ]);
    if (!raw || !isLive(raw)) return next(); // 404 via app fallthrough
    const brand = res.locals.brand || {};
    const origin = siteOrigin(req);
    const jobUrl = `${origin}/careers/${raw.slug}`;
    // Best-effort org logo for the JobPosting hiringOrganization.
    let logoUrl = '';
    try {
      const logo = await req.db.collection('brand_images').findOne({ slot: 'logo_primary' });
      logoUrl = logo?.url || '';
    } catch { /* logo is optional */ }
    const jsonLd = buildJobPostingLd({ job: raw, brandName: brand.name, siteOrigin: origin, jobUrl, logoUrl });
    res.setSeo?.({
      title: brand.name ? `${raw.title} — ${brand.name}` : raw.title,
      description: (raw.description || '').replace(/<[^>]+>/g, '').slice(0, 180),
      canonical: jobUrl, ogType: 'article',
      jsonLd: [jsonLd],
    });
    res.render('careers/detail', {
      design, brand, job: publicJob(raw),
      submitted: req.query.applied === '1', error: null, formData: {}, jsonLd,
    });
  } catch (err) {
    console.error('[careers/public] detail error:', err);
    next(err);
  }
});

// ── Apply (private résumé upload) ──────────────────────────────────────────
router.post('/:slug/apply', resumeUpload.single('resume'), async (req, res, next) => {
  try {
    if (!req.db) return next();
    const db = req.db;
    const job = await db.collection('jobs').findOne({ slug: req.params.slug });
    if (!job || !isLive(job)) return next();

    // Only internal postings accept on-site applications.
    if ((job.applyMode || 'internal') !== 'internal') {
      return res.redirect(`/careers/${job.slug}`);
    }

    const rerender = (error) => getDesign(db).then((design) => res.status(400).render('careers/detail', {
      design, brand: res.locals.brand || {}, job: publicJob(job),
      submitted: false, error, formData: req.body, jsonLd: null,
    }));

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    if (!name || !email) return rerender(res.locals.t('careers.err_name_email_required'));

    // Honeypot — silent success (see /contact rationale).
    const honeypot = !!(req.body.website2 || req.body._hp || '').trim();

    // Store the résumé privately. It is NEVER public-read: only reachable via the
    // authed admin stream route (/admin/careers/applications/:id/resume).
    let resumeKey = null, resumeName = null, resumeType = null, resumeSize = null;
    if (req.file && req.file.buffer?.length) {
      const up = await uploadPrivateBuffer(req.file.buffer, {
        prefix: req.tenant?.s3Prefix,
        folder: 'resumes',
        name: req.file.originalname,
        contentType: req.file.mimetype,
      });
      resumeKey = up.key;
      resumeName = req.file.originalname;
      resumeType = req.file.mimetype;
      resumeSize = req.file.size;
    }

    const now = new Date();
    const application = {
      jobId: job._id,
      jobSlug: job.slug,
      jobTitleSnapshot: job.title,
      name,
      email,
      phone: (req.body.phone || '').trim().slice(0, 40),
      linkedin: (req.body.linkedin || '').trim().slice(0, 300),
      portfolio: (req.body.portfolio || '').trim().slice(0, 300),
      coverLetter: (req.body.coverLetter || '').trim().slice(0, 20000),
      resumeKey, resumeName, resumeType, resumeSize,
      stage: honeypot ? 'rejected' : 'new',
      source: 'public-form',
      spam: honeypot || undefined,
      tenantDomain: req.tenant?.domain || '',
      createdAt: now,
      updatedAt: now,
    };
    await db.collection('job_applications').insertOne(application);

    if (!honeypot) {
      const brand = res.locals.brand || {};
      notifyAdmin({
        type: 'application', app: 'slab', email, name, ip: req.ip,
        data: {
          'Brand': brand.name || req.tenant?.domain || 'sLab tenant',
          'Position': job.title,
          'Résumé': resumeKey ? 'attached' : 'none',
          'Phone': application.phone || '—',
        },
      }).catch(() => {});
    }

    res.redirect(`/careers/${job.slug}?applied=1`);
  } catch (err) {
    console.error('[careers/public] apply error:', err);
    next(err);
  }
});

export default router;
