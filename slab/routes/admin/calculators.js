/**
 * routes/admin/calculators.js — Tenant-configurable calculator CRUD
 *
 * Each calculator doc in the tenant DB describes a parametric pricing form:
 *   - baseFields:        primary inputs multiplied by costPerUnit (e.g. RV length × $/ft)
 *   - multiplierFields:  count fields multiplied by costPerUnit (e.g. AC units × $/ea)
 *   - addOns:            checkbox (flat) or count (qty × cost) extras
 *
 * Public side fetches /calculators/:slug.json and renders via <slab-calculator>.
 */

import express from 'express';
import { ObjectId } from 'mongodb';

const router = express.Router();

function emptyCalc() {
  return {
    slug: '',
    title: '',
    description: '',
    noteText: 'Estimate only — final price confirmed on inspection.',
    enabled: true,
    baseFields: [],
    multiplierFields: [],
    addOns: [],
    primaryCta: { label: 'Book Service', url: '/book' },
  };
}

function parseFields(body) {
  // baseFields/multiplierFields/addOns come as parallel arrays from form
  const out = { baseFields: [], multiplierFields: [], addOns: [] };

  const arr = (v) => v == null ? [] : (Array.isArray(v) ? v : [v]);

  const baseIds       = arr(body.base_id);
  const baseLabels    = arr(body.base_label);
  const baseMins      = arr(body.base_min);
  const baseMaxes     = arr(body.base_max);
  const baseCosts     = arr(body.base_cost);
  for (let i = 0; i < baseIds.length; i++) {
    const id = String(baseIds[i] || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    const label = String(baseLabels[i] || '').trim().slice(0, 80);
    if (!id || !label) continue;
    out.baseFields.push({
      id, label,
      min: parseFloat(baseMins[i]) || 0,
      max: parseFloat(baseMaxes[i]) || 1000,
      costPerUnit: parseFloat(baseCosts[i]) || 0,
    });
  }

  const multIds    = arr(body.mult_id);
  const multLabels = arr(body.mult_label);
  const multMins   = arr(body.mult_min);
  const multMaxes  = arr(body.mult_max);
  const multCosts  = arr(body.mult_cost);
  for (let i = 0; i < multIds.length; i++) {
    const id = String(multIds[i] || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    const label = String(multLabels[i] || '').trim().slice(0, 80);
    if (!id || !label) continue;
    out.multiplierFields.push({
      id, label,
      min: parseInt(multMins[i]) || 0,
      max: parseInt(multMaxes[i]) || 10,
      costPerUnit: parseFloat(multCosts[i]) || 0,
    });
  }

  const addIds    = arr(body.add_id);
  const addLabels = arr(body.add_label);
  const addTypes  = arr(body.add_type);
  const addCosts  = arr(body.add_cost);
  const addMaxes  = arr(body.add_max);
  for (let i = 0; i < addIds.length; i++) {
    const id = String(addIds[i] || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    const label = String(addLabels[i] || '').trim().slice(0, 80);
    if (!id || !label) continue;
    const type = (String(addTypes[i] || 'checkbox') === 'count') ? 'count' : 'checkbox';
    const addOn = { id, label, type, cost: parseFloat(addCosts[i]) || 0 };
    if (type === 'count') addOn.max = parseInt(addMaxes[i]) || 10;
    out.addOns.push(addOn);
  }

  return out;
}

// GET /admin/calculators — list
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const calcs = await db.collection('calculators').find({}).sort({ updatedAt: -1, createdAt: -1 }).toArray();
    res.render('admin/calculators/index', {
      user: req.adminUser,
      page: 'calculators',
      title: 'Calculators',
      calcs,
      saved: req.query.saved === '1',
      deleted: req.query.deleted === '1',
    });
  } catch (err) {
    console.error('[calculators] list error:', err);
    res.status(500).send('Error loading calculators');
  }
});

// GET /admin/calculators/new — create form
router.get('/new', (req, res) => {
  res.render('admin/calculators/form', {
    user: req.adminUser,
    page: 'calculators',
    title: 'New Calculator',
    calc: emptyCalc(),
    isNew: true,
    saved: false,
    error: req.query.error || null,
  });
});

// POST /admin/calculators — create
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { slug, title, description, noteText, enabled, ctaLabel, ctaUrl } = req.body;
    const cleanSlug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!cleanSlug || !title) return res.redirect('/admin/calculators/new?error=missing');

    const existing = await db.collection('calculators').findOne({ slug: cleanSlug });
    if (existing) return res.redirect('/admin/calculators/new?error=duplicate');

    const fields = parseFields(req.body);
    const now = new Date();
    const result = await db.collection('calculators').insertOne({
      slug: cleanSlug,
      title: title.trim().slice(0, 120),
      description: (description || '').trim().slice(0, 500),
      noteText: (noteText || '').trim().slice(0, 300),
      enabled: enabled === 'on',
      ...fields,
      primaryCta: { label: (ctaLabel || 'Book').trim().slice(0, 40), url: (ctaUrl || '/book').trim().slice(0, 200) },
      createdAt: now,
      updatedAt: now,
    });

    res.redirect(`/admin/calculators/${result.insertedId}?saved=1`);
  } catch (err) {
    console.error('[calculators] create error:', err);
    res.redirect('/admin/calculators/new?error=create');
  }
});

// GET /admin/calculators/:id — edit form
router.get('/:id', async (req, res) => {
  try {
    const db = req.db;
    let oid;
    try { oid = new ObjectId(req.params.id); } catch { return res.redirect('/admin/calculators'); }
    const calc = await db.collection('calculators').findOne({ _id: oid });
    if (!calc) return res.redirect('/admin/calculators');

    res.render('admin/calculators/form', {
      user: req.adminUser,
      page: 'calculators',
      title: calc.title,
      calc,
      isNew: false,
      saved: req.query.saved === '1',
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[calculators] edit error:', err);
    res.status(500).send('Error loading calculator');
  }
});

// POST /admin/calculators/:id — update
router.post('/:id', async (req, res) => {
  try {
    const db = req.db;
    const oid = new ObjectId(req.params.id);
    const { title, description, noteText, enabled, ctaLabel, ctaUrl } = req.body;
    const fields = parseFields(req.body);

    await db.collection('calculators').updateOne(
      { _id: oid },
      { $set: {
          title: (title || '').trim().slice(0, 120),
          description: (description || '').trim().slice(0, 500),
          noteText: (noteText || '').trim().slice(0, 300),
          enabled: enabled === 'on',
          ...fields,
          primaryCta: { label: (ctaLabel || 'Book').trim().slice(0, 40), url: (ctaUrl || '/book').trim().slice(0, 200) },
          updatedAt: new Date(),
      } }
    );
    res.redirect(`/admin/calculators/${req.params.id}?saved=1`);
  } catch (err) {
    console.error('[calculators] update error:', err);
    res.redirect(`/admin/calculators/${req.params.id}?error=update`);
  }
});

// POST /admin/calculators/:id/delete — delete
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('calculators').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/calculators?deleted=1');
  } catch (err) {
    console.error('[calculators] delete error:', err);
    res.redirect('/admin/calculators');
  }
});

export default router;
