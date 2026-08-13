import express from 'express';
import { ObjectId } from 'mongodb';
import rateLimit from 'express-rate-limit';
import { config } from '../config/config.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';
import { sendClientEmail } from '../plugins/mailer.js';
import {
  hashDocument, logEvent, validateSelections, selectedItems,
  timeframeLabel, priceLabel, TERMINAL_STATUSES, SIGNABLE_STATUSES,
} from '../plugins/engagements.js';

const router = express.Router();

/** Load tenant design settings with defaults + contrast vars (mirrors pay.js) */
async function loadDesign(db) {
  const design = { ...DESIGN_DEFAULTS };
  try {
    const rows = await db.collection('design').find({}).toArray();
    for (const r of rows) design[r.key] = r.value;
  } catch { /* use defaults */ }
  return enrichDesignContrast(design);
}

// Canonical-domain redirect — emailed links may carry the wildcard host
router.use((req, res, next) => {
  const canonical = req.tenant?.customDomain;
  if (canonical && req.hostname !== canonical) {
    return res.redirect(301, `https://${canonical}${req.originalUrl}`);
  }
  next();
});

router.use(async (req, res, next) => {
  res.locals.design = await loadDesign(req.db);
  next();
});

// A signature is at stake — rate-limit the write endpoints by IP
const signLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: 'Too many attempts. Please try again shortly.',
});

/** Shared lookup */
async function findEngagement(req, token) {
  const db = req.db;
  const engagement = await db.collection('engagements').findOne({ accessToken: token });
  if (!engagement) return { engagement: null, clientDoc: null, error: 'not_found' };
  const clientDoc = await db.collection('clients').findOne({ _id: new ObjectId(engagement.clientId) });
  return { engagement, clientDoc, error: null };
}

/** validUntil is the gate — never trust the cron to have flipped status first */
function isExpired(engagement) {
  if (engagement.status === 'expired') return true;
  if (engagement.validUntil && new Date(engagement.validUntil) < new Date()) return true;
  return false;
}

// ── Review page ──
router.get('/:token', async (req, res) => {
  try {
    const { engagement, clientDoc, error } = await findEngagement(req, req.params.token);
    if (error === 'not_found' || engagement.status === 'draft') {
      return res.status(404).render('engage-error', { message: res.locals.t('engage.err_not_found') });
    }
    const expired = isExpired(engagement);
    const terminal = TERMINAL_STATUSES.includes(engagement.status);

    // First-view bookkeeping
    if (!terminal && !expired) {
      const set = { viewedAt: engagement.viewedAt || new Date() };
      if (engagement.status === 'sent') set.status = 'viewed';
      await req.db.collection('engagements').updateOne(
        { _id: engagement._id },
        { $set: set, $inc: { viewCount: 1 } }
      );
      if (engagement.status === 'sent') await logEvent(req.db, engagement._id, 'viewed', req);
    }

    res.render('engage', {
      e: engagement, cl: clientDoc,
      expired, terminal,
      signable: !expired && SIGNABLE_STATUSES.includes(engagement.status),
      sharedNotes: (engagement.notes || []).filter(n => n.visibility === 'shared' || n.author === 'client'),
      timeframeLabel, priceLabel,
      domain: req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN,
    });
  } catch (err) {
    console.error('Engage page error:', err);
    res.status(500).render('engage-error', { message: res.locals.t('booking.error_generic') });
  }
});

// ── Autosave selection ──
router.post('/:token/select', express.json(), async (req, res) => {
  try {
    const { engagement, error } = await findEngagement(req, req.params.token);
    if (error || isExpired(engagement) || !SIGNABLE_STATUSES.includes(engagement.status)) {
      return res.status(409).json({ error: res.locals.t('engage.err_selections_closed') });
    }
    const raw = req.body.selections || {};
    // Sanitize against the frozen packages — only known keys survive
    const clean = {};
    for (const pkg of engagement.packages || []) {
      const validKeys = new Set((pkg.options || []).map(o => o.key));
      let chosen = Array.isArray(raw[pkg.key]) ? raw[pkg.key].filter(k => validKeys.has(k)) : [];
      if (pkg.selectMode === 'one' && chosen.length > 1) chosen = [chosen[0]];
      clean[pkg.key] = chosen;
    }
    await req.db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: { selections: clean, updatedAt: new Date() } }
    );
    await logEvent(req.db, engagement._id, 'selection_changed', req, { selections: clean });
    res.json({ ok: true, selections: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Client note ──
router.post('/:token/note', express.json(), async (req, res) => {
  try {
    const { engagement, error } = await findEngagement(req, req.params.token);
    if (error || TERMINAL_STATUSES.includes(engagement.status)) {
      return res.status(409).json({ error: res.locals.t('engage.err_notes_closed') });
    }
    const body = (req.body.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: res.locals.t('engage.err_note_empty') });
    const note = {
      _id: new ObjectId(), body,
      author: 'client', authorName: req.body.name || 'Client',
      kind: 'note', visibility: 'shared',
      notify: { sent: false, at: null }, locked: true, resolved: false,
      createdAt: new Date(),
    };
    await req.db.collection('engagements').updateOne({ _id: engagement._id }, { $push: { notes: note } });
    await logEvent(req.db, engagement._id, 'note_added', req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Revision request — the non-binding route. Letter stays signable. ──
router.post('/:token/revise', express.json(), async (req, res) => {
  try {
    const { engagement, error } = await findEngagement(req, req.params.token);
    if (error || isExpired(engagement) || !SIGNABLE_STATUSES.includes(engagement.status)) {
      return res.status(409).json({ error: res.locals.t('engage.err_revision_closed') });
    }
    const body = (req.body.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: res.locals.t('engage.err_revision_empty') });
    const note = {
      _id: new ObjectId(), body,
      author: 'client', authorName: req.body.name || 'Client',
      kind: 'revision_request', visibility: 'shared',
      notify: { sent: false, at: null }, locked: true, resolved: false,
      createdAt: new Date(),
    };
    await req.db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $push: { notes: note }, $set: { status: 'revision_requested', updatedAt: new Date() } }
    );
    await logEvent(req.db, engagement._id, 'revision_requested', req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Decline — terminal. Reason optional, never required. ──
router.post('/:token/decline', express.json(), async (req, res) => {
  try {
    const { engagement, error } = await findEngagement(req, req.params.token);
    if (error || TERMINAL_STATUSES.includes(engagement.status) || isExpired(engagement)) {
      return res.status(409).json({ error: res.locals.t('engage.err_already_closed') });
    }
    await req.db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: {
        status: 'declined',
        declined: { reason: (req.body.reason || '').trim().slice(0, 2000), at: new Date(), ip: req.ip, userAgent: req.headers['user-agent'] || null },
        updatedAt: new Date(),
      } }
    );
    await logEvent(req.db, engagement._id, 'declined', req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SIGN — consent (separate) + typed name + title. Hash at the moment of signing. ──
router.post('/:token/sign', signLimiter, express.json(), async (req, res) => {
  try {
    const { engagement, clientDoc, error } = await findEngagement(req, req.params.token);
    if (error) return res.status(404).json({ error: res.locals.t('engage.err_letter_not_found') });
    // validUntil checked directly — the gate, not the cron
    if (isExpired(engagement)) return res.status(409).json({ error: res.locals.t('engage.err_expired_sign') });
    if (!SIGNABLE_STATUSES.includes(engagement.status)) return res.status(409).json({ error: res.locals.t('engage.err_not_signable') });

    const { typedName, title, consent } = req.body;
    if (!consent) return res.status(400).json({ error: res.locals.t('engage.err_consent_required') });
    if (!typedName || typedName.trim().length < 2) return res.status(400).json({ error: res.locals.t('engage.err_name_required') });

    // Never sign an incomplete selection into a binding document
    const missing = validateSelections(engagement);
    if (missing.length) return res.status(400).json({ error: res.locals.t('engage.err_missing_selection', { fields: missing.join(', ') }) });

    const now = new Date();
    const documentHash = hashDocument(engagement);
    await req.db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: {
        status: 'signed',
        signature: {
          typedName: typedName.trim().slice(0, 200),
          title: (title || '').trim().slice(0, 200),
          consentedAt: now, signedAt: now,
          ip: req.ip, userAgent: req.headers['user-agent'] || null,
          documentHash,
        },
        updatedAt: now,
      } }
    );
    await logEvent(req.db, engagement._id, 'consented', req);
    await logEvent(req.db, engagement._id, 'signed', req, { documentHash });

    // Client gets confirmation + link to their copy; you get the action-required nudge
    try {
      if (clientDoc?.email) {
        const url = `${req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN}/engage/${engagement.accessToken}/copy`;
        await sendClientEmail(clientDoc.email, [],
          `Signed — ${engagement.title} (${engagement.engagementNumber})`,
          `<p>Hi ${clientDoc.name?.split(' ')[0] || 'there'},</p><p>Your engagement letter has been signed. Keep this for your records:</p><p><a href="${url}" style="display:inline-block;padding:12px 28px;background:#1C2B4A;color:#F5F3EF;text-decoration:none;border-radius:3px;font-weight:600;">View Your Signed Copy</a></p><p style="color:#6B7380;font-size:13px;">Document hash: ${engagement.signature?.documentHash || documentHash}</p><p>We'll follow up shortly to confirm receipt and kick things off.</p>`,
          null, req.tenant);
      }
    } catch (emailErr) {
      console.error('[engage] sign confirmation email failed:', emailErr.message);
      // signing succeeded — email is best-effort
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Engage sign error:', err);
    res.status(500).json({ error: res.locals.t('engage.err_sign_failed') });
  }
});

// ── Renewal request — expired letters only. Changes no status. ──
router.post('/:token/renew', express.json(), async (req, res) => {
  try {
    const { engagement, error } = await findEngagement(req, req.params.token);
    if (error) return res.status(404).json({ error: res.locals.t('engage.err_letter_not_found') });
    if (!isExpired(engagement)) return res.status(409).json({ error: res.locals.t('engage.err_not_expired') });
    const note = {
      _id: new ObjectId(),
      body: (req.body.body || 'Client requested a renewed letter of engagement.').trim().slice(0, 2000),
      author: 'client', authorName: req.body.name || 'Client',
      kind: 'renewal_request', visibility: 'shared',
      notify: { sent: false, at: null }, locked: true, resolved: false,
      createdAt: new Date(),
    };
    await req.db.collection('engagements').updateOne({ _id: engagement._id }, { $push: { notes: note } });
    await logEvent(req.db, engagement._id, 'renewal_requested', req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── W-9 request — signed/acknowledged ONLY. Requests, never serves. ──
router.post('/:token/request-w9', express.json(), async (req, res) => {
  try {
    const { engagement, error } = await findEngagement(req, req.params.token);
    if (error) return res.status(404).json({ error: res.locals.t('engage.err_letter_not_found') });
    if (!['signed', 'acknowledged'].includes(engagement.status)) {
      return res.status(409).json({ error: res.locals.t('engage.err_w9_after_sign') });
    }
    if (engagement.w9?.requestedAt) return res.json({ ok: true, already: true });
    await req.db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: {
        'w9.requestedAt': new Date(),
        'w9.requestedBy': engagement.signature?.typedName || 'Client',
        updatedAt: new Date(),
      } }
    );
    await logEvent(req.db, engagement._id, 'w9_requested', req);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Printable signed copy ──
router.get('/:token/copy', async (req, res) => {
  try {
    const { engagement, clientDoc, error } = await findEngagement(req, req.params.token);
    if (error || !['signed', 'acknowledged'].includes(engagement.status)) {
      return res.status(404).render('engage-error', { message: res.locals.t('engage.err_no_copy') });
    }
    res.render('engage', {
      e: engagement, cl: clientDoc,
      expired: false, terminal: true, signable: false, printMode: true,
      sharedNotes: [],
      timeframeLabel, priceLabel,
      domain: req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN,
    });
  } catch (err) {
    res.status(500).render('engage-error', { message: res.locals.t('booking.error_generic') });
  }
});

export default router;
