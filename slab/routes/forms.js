/**
 * Slab — Public Onboarding Form pages
 * Lets a tenant share an onboarding form via QR / direct link.
 *   GET  /forms/:slug         → render the form standalone (branded)
 *   POST /forms/:slug/submit  → store a response in onboarding_responses
 *
 * Forms must be status:'active' to be publicly reachable.
 */

import express from 'express';

const router = express.Router();

// ── Render a public form ─────────────────────────────────────────────────────
router.get('/:slug', async (req, res, next) => {
  try {
    const db = req.db;
    if (!db) return next();
    const form = await db.collection('onboarding_forms').findOne({ slug: req.params.slug, status: 'active' });
    if (!form) return next();

    // Branding — pull the same colour/font keys the public site uses.
    const design = {};
    const rows = await db.collection('design')
      .find({ key: { $in: ['color_primary', 'color_white', 'color_accent', 'font_body', 'font_heading'] } })
      .toArray();
    for (const r of rows) design[r.key] = r.value;

    const logoRow = await db.collection('brand_images').findOne({ slot: 'logo_primary' });

    res.render('forms/public', {
      form,
      design,
      logo: logoRow?.url || '',
      brand: req.tenant?.brand || {},
    });
  } catch (err) {
    console.error('[forms] render error:', err);
    next();
  }
});

// ── Submit a public form response ────────────────────────────────────────────
router.post('/:slug/submit', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const db = req.db;
    const form = await db.collection('onboarding_forms').findOne({ slug: req.params.slug, status: 'active' });
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const { data, respondentEmail, respondentName } = req.body;

    await db.collection('onboarding_responses').insertOne({
      formId: form._id,
      formSlug: form.slug,
      clientId: null,
      respondentEmail: respondentEmail || '',
      respondentName: respondentName || '',
      data: data || {},
      pipedData: {},
      source: 'public',
      completedAt: new Date(),
      createdAt: new Date(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[forms] submit error:', err);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

export default router;
