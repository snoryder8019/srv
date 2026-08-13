/**
 * Field client portal — public, short-lived magic-link page for a field job.
 *
 * A client receives an emailed link (/field/:token) and lands here without
 * logging in — the unguessable token IS the credential, gated by a `validUntil`
 * expiry (never trust a cron to have flipped a flag first, per the engage/pay
 * precedent). From here they see their job status + technician ETA, view & sign
 * their quote (handing off to the existing /engage/:token flow), and view & pay
 * invoices (handing off to the existing /pay/:token flow). No payment or
 * signature logic is re-implemented here — this page only aggregates and links.
 *
 * Mirrors routes/pay.js: canonical-domain redirect + tenant design injection.
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import { config } from '../config/config.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';

const router = express.Router();

async function loadDesign(db) {
  const design = { ...DESIGN_DEFAULTS };
  try {
    const rows = await db.collection('design').find({}).toArray();
    for (const r of rows) design[r.key] = r.value;
  } catch { /* defaults */ }
  return enrichDesignContrast(design);
}

// Canonical-domain redirect so an emailed wildcard-host link lands correctly.
router.use((req, res, next) => {
  const canonical = req.tenant?.customDomain;
  if (canonical && req.hostname !== canonical) {
    return res.redirect(301, `https://${canonical}${req.originalUrl}`);
  }
  next();
});

// Inject tenant design into portal views.
router.use(async (req, res, next) => {
  res.locals.design = await loadDesign(req.db);
  next();
});

/** validUntil is the gate — a job link that's past its window is dead. */
function isExpired(job) {
  if (!job.accessToken) return true;
  if (job.linkRevoked) return true;
  if (job.linkValidUntil && new Date(job.linkValidUntil) < new Date()) return true;
  return false;
}

// ── Public field portal ──
router.get('/:token', async (req, res) => {
  try {
    const db = req.db;
    // The portal only exists for a real tenant workspace (a business's clients).
    // The platform host has no tenant DB — treat it as an invalid link.
    if (!db) return res.status(404).render('field/portal-error', { message: 'This link is invalid or has expired.' });
    const job = await db.collection('field_jobs').findOne({ accessToken: req.params.token });
    if (!job) return res.status(404).render('field/portal-error', { message: 'This link is invalid or has expired.' });
    if (isExpired(job)) return res.status(410).render('field/portal-error', { message: 'This link has expired. Please contact us for a new one.' });

    const clientDoc = job.clientId ? await db.collection('clients').findOne({ _id: job.clientId }) : null;

    // Linked quote (engagement), if any and not still a private draft.
    let engagement = null;
    if (job.engagementId) {
      engagement = await db.collection('engagements').findOne(
        { _id: job.engagementId, status: { $ne: 'draft' } },
        { projection: { engagementNumber: 1, status: 1, accessToken: 1, title: 1 } },
      );
    }

    // Payable invoices for this client (unguessable per-invoice paymentToken → /pay).
    let invoices = [];
    if (job.clientId) {
      invoices = await db.collection('invoices')
        .find({
          clientId: { $in: [job.clientId.toString(), job.clientId] },
          paymentToken: { $exists: true, $ne: null },
        })
        .project({ invoiceNumber: 1, title: 1, amount: 1, status: 1, paymentToken: 1, dueDate: 1 })
        .sort({ createdAt: -1 })
        .toArray();
    }

    const domain = req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN;

    res.render('field/portal', {
      job, clientDoc, engagement, invoices, domain,
      brand: res.locals.brand,
    });
  } catch (err) {
    console.error('[field portal] error:', err);
    res.status(500).render('field/portal-error', { message: 'Something went wrong. Please try again.' });
  }
});

export default router;
