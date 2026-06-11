// editor.js — the pitch editor (template picker + content form).
//
// Mounted at /editor (see app bootstrap). Every route is gated on a signed-in
// madladslab user. Free users build a pitch by (1) picking reusable view-module
// TEMPLATES from the curated catalog, then (2) filling in content, scope items,
// packages, and pricing. They never write code or invent view types.
import express from 'express';
import { requireUser } from '../plugins/mllAuth.js';
import {
  MAX_PITCHES,
  countUserPitches,
  createPitch,
  getPitch,
  updatePitch,
} from '../lib/store.js';
import {
  CATALOG,
  catalogList,
  scaffoldFor,
  isTemplateSlug,
} from '../lib/templates.js';

const router = express.Router();

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Coerce a form value into a finite number, falling back to `dflt`. */
function num(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Normalize a value (or single value) from a form field into an array. */
function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Whether this user may edit this pitch (owner of a user pitch, or superadmin). */
function canEdit(user, pitch) {
  if (!pitch || pitch.source !== 'user') return false;
  return pitch.ownerId === user.id || !!user.isSuperadmin;
}

/**
 * Parse the repeating scope-row fields into clean scope items.
 * Form posts parallel arrays: item[<group>][id|title|hours] (+ description).
 * cost/firmCost are auto-computed from hours × rate so the client can't lie.
 */
function parseScopeRows(body, group, rate) {
  const ids = asArray(body[`${group}_id`]);
  const titles = asArray(body[`${group}_title`]);
  const descs = asArray(body[`${group}_desc`]);
  const hoursArr = asArray(body[`${group}_hours`]);
  const out = [];
  for (let i = 0; i < titles.length; i++) {
    const title = String(titles[i] || '').trim();
    if (!title) continue;
    const hours = Math.max(0, num(hoursArr[i], 0));
    const id = String(ids[i] || '').trim() || `${group}.${i + 1}`;
    out.push({
      id,
      title,
      description: String(descs[i] || '').trim(),
      hours,
      cost: Math.round(hours * rate),
      firmCost: Math.round(hours * rate * 3),
    });
  }
  return out;
}

/** Parse the repeating package-tier rows into clean package objects. */
function parsePackages(body, rate) {
  const ids = asArray(body.pkg_id);
  const names = asArray(body.pkg_name);
  const taglines = asArray(body.pkg_tagline);
  const monthlies = asArray(body.pkg_monthly);
  const hoursArr = asArray(body.pkg_hours);
  const colors = asArray(body.pkg_color);
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || '').trim();
    if (!name) continue;
    const monthly = Math.max(0, num(monthlies[i], 0));
    out.push({
      id: String(ids[i] || '').trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `tier-${i + 1}`,
      name,
      tagline: String(taglines[i] || '').trim(),
      monthly,
      firmMonthly: Math.round(monthly * 3),
      hoursPerMonth: Math.max(0, num(hoursArr[i], 0)),
      color: ['ok', 'accent', 'warn'].includes(colors[i]) ? colors[i] : 'accent',
      features: [],
      notIncluded: [],
    });
  }
  return out;
}

// ── new pitch ────────────────────────────────────────────────────────────────
router.get('/new', requireUser, (req, res) => {
  const user = req.mllUser;
  const atLimit = !user.isSuperadmin && countUserPitches(user.id) >= MAX_PITCHES;
  res.render('editor/new', {
    title: 'New pitch',
    catalog: catalogList(),
    atLimit,
    max: MAX_PITCHES,
    used: countUserPitches(user.id),
    error: null,
    form: {},
  });
});

router.post('/new', requireUser, (req, res) => {
  const user = req.mllUser;
  const b = req.body || {};
  const client = String(b.client || '').trim();
  const industry = String(b.industry || '').trim();
  const summary = String(b.summary || '').trim();
  const rate = Math.max(1, num(b.defaultRate, user.settings?.defaultRate || 75));
  const chosen = asArray(b.views).filter(isTemplateSlug);

  const reRender = (error) =>
    res.status(400).render('editor/new', {
      title: 'New pitch',
      catalog: catalogList(),
      atLimit: false,
      max: MAX_PITCHES,
      used: countUserPitches(user.id),
      error,
      form: { client, industry, summary, defaultRate: rate, views: chosen },
    });

  if (!client) return reRender('Please enter a client name.');

  const views = chosen.map((slug) => scaffoldFor(slug, rate)).filter(Boolean);

  const data = {
    client,
    industry,
    date: todayIso(),
    summary,
    defaultRate: rate,
    views,
    packages: [],
    alaCarte: [],
  };

  try {
    const pitch = createPitch(user.id, data);
    return res.redirect(`/editor/${pitch.slug}`);
  } catch (err) {
    if (err.message === 'pitch_limit') {
      return res.status(403).render('editor/new', {
        title: 'New pitch',
        catalog: catalogList(),
        atLimit: true,
        max: MAX_PITCHES,
        used: countUserPitches(user.id),
        error: null,
        form: {},
      });
    }
    if (err.message === 'unknown_user') return reRender('Your account could not be found. Try signing in again.');
    throw err;
  }
});

// ── edit pitch ───────────────────────────────────────────────────────────────
router.get('/:slug', requireUser, (req, res) => {
  const user = req.mllUser;
  const pitch = getPitch(req.params.slug);
  if (!pitch) {
    return res.status(404).render('error', { title: 'Not found', message: 'Unknown pitch.' });
  }
  if (!canEdit(user, pitch)) {
    return res.status(403).render('error', {
      title: 'Not allowed',
      message: 'This pitch is read-only — you can only edit pitches you created.',
    });
  }

  // Mark which catalog templates are already on the pitch.
  const activeSlugs = new Set((pitch.views || []).map((v) => v.slug));
  const catalog = catalogList().map((t) => ({ ...t, active: activeSlugs.has(t.slug) }));

  res.render('editor/edit', {
    title: `Edit · ${pitch.client}`,
    pitch,
    catalog,
    saved: req.query.saved === '1',
  });
});

router.post('/:slug', requireUser, (req, res) => {
  const user = req.mllUser;
  const existing = getPitch(req.params.slug);
  if (!existing) {
    return res.status(404).render('error', { title: 'Not found', message: 'Unknown pitch.' });
  }
  if (!canEdit(user, existing)) {
    return res.status(403).render('error', {
      title: 'Not allowed',
      message: 'This pitch is read-only — you can only edit pitches you created.',
    });
  }

  const b = req.body || {};
  const rate = Math.max(1, num(b.defaultRate, existing.defaultRate || 75));

  // Which catalog views should be on the pitch after this save.
  const wantSlugs = asArray(b.views).filter(isTemplateSlug);
  const wantSet = new Set(wantSlugs);

  // Keep existing scaffolds for views still toggled on (preserve user data on
  // catalog views; preserve any non-catalog seeded views untouched). Add fresh
  // scaffolds for newly-toggled-on catalog views. Drop toggled-off catalog views.
  const keptViews = (existing.views || []).filter(
    (v) => !isTemplateSlug(v.slug) || wantSet.has(v.slug),
  );
  const haveSlugs = new Set(keptViews.map((v) => v.slug));
  for (const slug of wantSlugs) {
    if (!haveSlugs.has(slug)) {
      const sc = scaffoldFor(slug, rate);
      if (sc) keptViews.push(sc);
    }
  }

  const patch = {
    client: String(b.client || existing.client || '').trim() || existing.client,
    industry: String(b.industry || '').trim(),
    summary: String(b.summary || '').trim(),
    date: String(b.date || '').trim() || existing.date || todayIso(),
    defaultRate: rate,
    status: b.status === 'published' ? 'published' : 'draft',
    views: keptViews,
    alaCarte: parseScopeRows(b, 'ala', rate),
    packages: parsePackages(b, rate),
  };

  const updated = updatePitch(req.params.slug, user.id, patch);
  if (!updated) {
    return res.status(403).render('error', {
      title: 'Not allowed',
      message: 'Could not save — you can only edit pitches you created.',
    });
  }
  return res.redirect(`/editor/${updated.slug}?saved=1`);
});

export default router;
export { CATALOG };
