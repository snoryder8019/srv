/**
 * Slab — Content Pipes catalog
 * Feeds the {{ }} autocomplete in the content editors. Returns the tokens
 * available to THIS tenant (brand vars, design colors/fonts, active forms,
 * reusable copy keys, brand image slots). See plugins/pipes.js for the engine.
 */
import express from 'express';
import { DESIGN_DEFAULTS } from './design.js';

const router = express.Router();

// Static brand expressions — always available (resolve from tenant.brand).
const BRAND_VARS = [
  ['brand.name',        'Business name'],
  ['brand.tagline',     'Tagline'],
  ['brand.email',       'Contact email'],
  ['brand.phone',       'Phone number'],
  ['brand.location',    'Location'],
  ['brand.serviceArea', 'Service area'],
  ['brand.description', 'Business description'],
  ['brand.ownerName',   'Owner name'],
];

router.get('/catalog', async (req, res) => {
  const tokens = [];
  try {
    const db = req.db;

    for (const [insert, detail] of BRAND_VARS) {
      tokens.push({ insert, label: insert, detail, group: 'Brand' });
    }

    for (const k of Object.keys(DESIGN_DEFAULTS)) {
      if (k.startsWith('color_')) {
        const n = 'color.' + k.slice(6);
        tokens.push({ insert: n, label: n, detail: 'Design color', group: 'Design' });
      } else if (k.startsWith('font_')) {
        const n = 'font.' + k.slice(5);
        tokens.push({ insert: n, label: n, detail: 'Design font', group: 'Design' });
      }
    }

    if (db) {
      const [forms, copyDocs, imgs] = await Promise.all([
        db.collection('onboarding_forms').find({ status: 'active' }).project({ name: 1, slug: 1 }).toArray(),
        db.collection('copy').find({}).project({ key: 1 }).toArray(),
        db.collection('brand_images').find({}).project({ slot: 1 }).toArray(),
      ]);

      for (const f of forms) {
        tokens.push({ insert: `form "${f.slug}"`, label: `form "${f.slug}"`, detail: `${f.name || f.slug} — embed form`, group: 'Forms' });
      }
      for (const c of copyDocs) {
        if (c.key) tokens.push({ insert: `copy "${c.key}"`, label: `copy "${c.key}"`, detail: 'Reuse copy block', group: 'Copy' });
      }
      const seen = new Set();
      for (const i of imgs) {
        if (i.slot && !seen.has(i.slot)) {
          seen.add(i.slot);
          tokens.push({ insert: `img "${i.slot}"`, label: `img "${i.slot}"`, detail: 'Brand image', group: 'Images' });
        }
      }
    }

    res.json({ tokens });
  } catch (err) {
    console.error('[pipes] catalog error:', err.message);
    res.json({ tokens });
  }
});

export default router;
