import express from 'express';
import { ObjectId } from 'mongodb';
import { getSlabDb } from '../../plugins/mongo.js';
import { VALID_BLOCK_TYPES, BLOCK_FIELDS, BLOCK_DEFAULTS } from '../../config/blocks.js';
import { DESIGN_DEFAULTS, THEME_KEYS } from './design.js';
import { enrichDesignContrast } from '../../plugins/colorContrast.js';

const router = express.Router();

// Visual skins a template can render through (see views/partials/skins/*.ejs).
// 'classic' = the built-in block renderer; the rest are full design worlds.
const VALID_SKINS = ['classic', 'lowlight', 'terminal', 'arena', 'gallery'];
const cleanSkin = (s) => (VALID_SKINS.includes(s) ? s : 'classic');

// Homepage "looks" = landing_layout themes. Switching a look is carbon-copy: index.ejs
// renders ALL the tenant's content/modules; [data-layout="<look>"] only re-styles it.
const VALID_LOOKS = [
  'classic', 'bold', 'minimal', 'magazine', 'dark', 'startup', 'showcase', 'industrial',
  'split', 'editorial', 'agency', 'clean', 'brutalist',
  'lowlight', 'terminal', 'arena', 'gallery',
];
const cleanLook = (s) => (VALID_LOOKS.includes(s) ? s : null);

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Backup ensurance for template switches ───────────────────────────────────
// Activating/deactivating a template changes what renders (blocks vs the copy
// layout). Copy is never deleted, but the switch LOOKS like data loss. Before
// every switch we snapshot the full render state (home_source, active_template,
// copy, design) into `template_switch_backups` so any switch is one-click
// recoverable. Keeps the most recent 10 snapshots per tenant.
async function snapshotBeforeSwitch(db, reason) {
  try {
    const [src, active, copy, design] = await Promise.all([
      db.collection('design').findOne({ key: 'home_source' }),
      db.collection('active_template').findOne({}),
      db.collection('copy').find({}).toArray(),
      db.collection('design').find({}).toArray(),
    ]);
    await db.collection('template_switch_backups').insertOne({
      reason: String(reason || 'switch').slice(0, 120),
      createdAt: new Date(),
      home_source: src?.value || null,
      active_template: active || null,
      copy, design,
      counts: { copy: copy.length, design: design.length },
    });
    // Trim to the last 10.
    const old = await db.collection('template_switch_backups')
      .find({}).sort({ createdAt: -1 }).skip(10).toArray();
    if (old.length) await db.collection('template_switch_backups').deleteMany({ _id: { $in: old.map(o => o._id) } });
  } catch (e) {
    console.error('[templates] snapshotBeforeSwitch failed (non-fatal):', e.message);
  }
}

/** Build a design snapshot from tenant's current design, capturing only THEME_KEYS */
async function captureDesignSnapshot(db) {
  const rows = await db.collection('design').find({}).toArray();
  const design = { ...DESIGN_DEFAULTS };
  for (const r of rows) design[r.key] = r.value;
  const snapshot = {};
  for (const k of THEME_KEYS) snapshot[k] = design[k];
  return snapshot;
}

/** Get full current design (for preview rendering) */
async function getDesign(db) {
  const rows = await db.collection('design').find({}).toArray();
  const design = { ...DESIGN_DEFAULTS };
  for (const r of rows) design[r.key] = r.value;
  return enrichDesignContrast(design);
}

// ── List ─────────────────────────────────────────────────────────────────────
// Standalone list page retired — template management lives in /admin/design Templates tab.
// Individual edit/preview/activate routes below stay reachable (builder + AJAX endpoints).
router.get('/', (req, res) => {
  const qs = req.query.msg || req.query.err
    ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(req.query).filter(([k]) => ['msg', 'err'].includes(k)))).toString()
    : '';
  res.redirect('/admin/design' + qs + '#tab=templates');
});

// ── New form ─────────────────────────────────────────────────────────────────
router.get('/new', async (req, res) => {
  try {
    const design = await getDesign(req.db);
    res.render('admin/templates/form', {
      user: req.adminUser, page: 'templates', title: 'New Template',
      tpl: null, design, error: null,
      BLOCK_FIELDS: JSON.stringify(BLOCK_FIELDS),
      BLOCK_DEFAULTS: JSON.stringify(BLOCK_DEFAULTS),
      VALID_BLOCK_TYPES,
      isActive: false, contentOverrides: {},
    });
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates');
  }
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { name, description, category, tags } = req.body;
    if (!name || !name.trim()) {
      return res.redirect('/admin/templates/new?err=Name+is+required');
    }
    const slug = toSlug(name);
    const existing = await db.collection('templates').findOne({ slug });
    if (existing) {
      return res.redirect('/admin/templates/new?err=A+template+with+that+name+already+exists');
    }

    let blocks = [];
    try { blocks = JSON.parse(req.body.blocksJson || '[]'); } catch {}
    blocks = blocks.filter(b => b && VALID_BLOCK_TYPES.includes(b.type));

    const designSnapshot = await captureDesignSnapshot(db);
    const now = new Date();

    await db.collection('templates').insertOne({
      name: name.trim(),
      slug,
      description: (description || '').trim(),
      category: ['landing', 'page'].includes(category) ? category : 'landing',
      tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean),
      skin: cleanSkin(req.body.skin),
      blocks,
      designSnapshot,
      thumbnail: '',
      isPublic: false,
      source: 'user',
      authorName: req.adminUser?.displayName || '',
      authorEmail: req.adminUser?.email || '',
      createdAt: now,
      updatedAt: now,
    });

    res.redirect('/admin/templates?msg=created');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=Failed+to+create+template');
  }
});

// ── Edit form ────────────────────────────────────────────────────────────────
router.get('/:id/edit', async (req, res) => {
  try {
    const db = req.db;
    const tpl = await db.collection('templates').findOne({ _id: new ObjectId(req.params.id) });
    if (!tpl) return res.redirect('/admin/templates');
    const design = await getDesign(db);
    const active = await db.collection('active_template').findOne({});
    const isActive = !!(active && active.templateId && active.templateId.toString() === tpl._id.toString());
    const contentOverrides = isActive ? (active.contentOverrides || {}) : {};
    res.render('admin/templates/form', {
      user: req.adminUser, page: 'templates', title: 'Edit Template',
      tpl, design, error: null,
      BLOCK_FIELDS: JSON.stringify(BLOCK_FIELDS),
      BLOCK_DEFAULTS: JSON.stringify(BLOCK_DEFAULTS),
      VALID_BLOCK_TYPES,
      isActive, contentOverrides,
    });
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates');
  }
});

// ── Update ───────────────────────────────────────────────────────────────────
router.post('/:id', async (req, res) => {
  try {
    const db = req.db;
    const { name, description, category, tags } = req.body;
    if (!name || !name.trim()) {
      return res.redirect(`/admin/templates/${req.params.id}/edit?err=Name+is+required`);
    }

    let blocks = [];
    try { blocks = JSON.parse(req.body.blocksJson || '[]'); } catch {}
    blocks = blocks.filter(b => b && VALID_BLOCK_TYPES.includes(b.type));

    const designSnapshot = await captureDesignSnapshot(db);

    await db.collection('templates').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: {
        name: name.trim(),
        slug: toSlug(name),
        description: (description || '').trim(),
        category: ['landing', 'page'].includes(category) ? category : 'landing',
        tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean),
        skin: cleanSkin(req.body.skin),
        blocks,
        designSnapshot,
        updatedAt: new Date(),
      }},
    );

    res.redirect('/admin/templates?msg=updated');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
  }
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('templates').deleteOne({ _id: new ObjectId(req.params.id) });
    // If this was the active template, remove the active pointer
    await db.collection('active_template').deleteOne({ templateId: new ObjectId(req.params.id) });
    res.redirect('/admin/templates?msg=deleted');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
  }
});

// ── Clone ────────────────────────────────────────────────────────────────────
router.post('/:id/clone', async (req, res) => {
  try {
    const db = req.db;
    const source = await db.collection('templates').findOne({ _id: new ObjectId(req.params.id) });
    if (!source) return res.redirect('/admin/templates');

    const now = new Date();
    const cloneName = source.name + ' (Copy)';
    let cloneSlug = toSlug(cloneName);
    // Ensure unique slug
    const existing = await db.collection('templates').findOne({ slug: cloneSlug });
    if (existing) cloneSlug += '-' + Date.now().toString(36);

    const { insertedId } = await db.collection('templates').insertOne({
      name: cloneName,
      slug: cloneSlug,
      description: source.description || '',
      category: source.category || 'landing',
      tags: source.tags || [],
      blocks: JSON.parse(JSON.stringify(source.blocks || [])),
      designSnapshot: source.designSnapshot || {},
      thumbnail: '',
      isPublic: false,
      source: 'user',
      authorName: req.adminUser?.displayName || '',
      authorEmail: req.adminUser?.email || '',
      createdAt: now,
      updatedAt: now,
    });

    res.redirect(`/admin/templates/${insertedId}/edit`);
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
  }
});

// ── Activate ─────────────────────────────────────────────────────────────────
router.post('/:id/activate', async (req, res) => {
  try {
    const db = req.db;
    const tpl = await db.collection('templates').findOne({ _id: new ObjectId(req.params.id) });
    if (!tpl) return res.redirect('/admin/templates');

    // Snapshot current state before switching render mode (recoverable).
    await snapshotBeforeSwitch(db, 'activate: ' + (tpl.name || tpl._id));

    // Preserve per-template content edits across switches. Overrides live on the
    // singleton active_template doc keyed by block id, so naively re-activating a
    // template used to blank them out (silent data loss). We stash every template's
    // overrides under overridesByTemplate.<templateId> and restore this template's
    // slice, so A → B → A brings A's edits back instead of erasing them.
    const cur = await db.collection('active_template').findOne({});
    const tid = tpl._id.toString();
    const stash = { ...(cur?.overridesByTemplate || {}) };
    if (cur?.templateId && cur.contentOverrides && Object.keys(cur.contentOverrides).length) {
      stash[cur.templateId.toString()] = cur.contentOverrides;
    }
    const restored = stash[tid] || {};

    await db.collection('active_template').updateOne(
      {},
      { $set: {
        templateId: tpl._id,
        appliedAt: new Date(),
        contentOverrides: restored,
        overridesByTemplate: stash,
      }},
      { upsert: true },
    );

    // Activating a template means "show it now" — force the render mode to 'slab'
    // so activation is never a silent no-op for a tenant whose home_source was
    // 'custom'/'auto' (they can switch the Homepage Source back explicitly).
    await db.collection('design').updateOne(
      { key: 'home_source' },
      { $set: { key: 'home_source', value: 'slab', updatedAt: new Date() } },
      { upsert: true },
    );

    res.redirect('/admin/templates/' + req.params.id + '/activate');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
  }
});

// ── Activate view (content mapping) ──────────────────────────────────────────
router.get('/:id/activate', async (req, res) => {
  try {
    const db = req.db;
    const tpl = await db.collection('templates').findOne({ _id: new ObjectId(req.params.id) });
    if (!tpl) return res.redirect('/admin/templates');
    const active = await db.collection('active_template').findOne({});

    res.render('admin/templates/activate', {
      user: req.adminUser, page: 'templates', title: 'Activate Template',
      tpl, active,
      BLOCK_FIELDS: JSON.stringify(BLOCK_FIELDS),
    });
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates');
  }
});

// ── Save content overrides ───────────────────────────────────────────────────
router.post('/:id/content', async (req, res) => {
  try {
    const db = req.db;
    let overrides = {};
    try { overrides = JSON.parse(req.body.overridesJson || '{}'); } catch {}

    await db.collection('active_template').updateOne(
      { templateId: new ObjectId(req.params.id) },
      { $set: {
        contentOverrides: overrides,
        ['overridesByTemplate.' + req.params.id]: overrides,
      } },
    );

    res.redirect('/admin/templates?msg=Content+mapping+saved');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
  }
});

// ── Save ONE block field override (granular, for the canvas editor) ───────────
// The whole-overrides POST above is a redirect-based bulk replace; the canvas
// editor commits one block field at a time and needs a JSON, non-clobbering
// upsert. Uses a dot-path $set so sibling overrides are preserved.
router.post('/:id/content-field', async (req, res) => {
  try {
    const blockId = String(req.body.blockId || '');
    const field = String(req.body.field || '');
    if (!/^[a-zA-Z0-9]+$/.test(blockId) || !/^[a-zA-Z0-9_]+$/.test(field)) {
      return res.status(400).json({ error: 'Invalid blockId/field' });
    }
    const value = String(req.body.value ?? '').slice(0, 20000);
    const r = await req.db.collection('active_template').updateOne(
      { templateId: new ObjectId(req.params.id) },
      { $set: {
        ['contentOverrides.' + blockId + '.' + field]: value,
        ['overridesByTemplate.' + req.params.id + '.' + blockId + '.' + field]: value,
      } },
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'No active template' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[templates] content-field:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Deactivate ───────────────────────────────────────────────────────────────
router.post('/:id/deactivate', async (req, res) => {
  try {
    await snapshotBeforeSwitch(req.db, 'deactivate');
    // Keep the singleton (and its overridesByTemplate stash) so re-activating a
    // template later restores its edits; just clear the active pointer so the
    // homepage falls through to the standard layout.
    const r = await req.db.collection('active_template').updateOne(
      {},
      { $set: { templateId: null, appliedAt: null, contentOverrides: {} } },
    );
    if (!r.matchedCount) await req.db.collection('active_template').deleteMany({});
    res.redirect('/admin/templates?msg=deactivated');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
  }
});

// ── Switch to the Standard Layout ────────────────────────────────────────────
// Unified look-switcher action: makes the built-in landing layout the live
// homepage — clears any active template AND forces home_source:'slab' so it's a
// one-click switch alongside the template cards (no separate Homepage Source step).
router.post('/use-standard', async (req, res) => {
  try {
    const db = req.db;
    await snapshotBeforeSwitch(db, 'use-standard');
    const r = await db.collection('active_template').updateOne(
      {}, { $set: { templateId: null, appliedAt: null, contentOverrides: {} } },
    );
    if (!r.matchedCount) await db.collection('active_template').deleteMany({});
    await db.collection('design').updateOne(
      { key: 'home_source' },
      { $set: { key: 'home_source', value: 'slab', updatedAt: new Date() } },
      { upsert: true },
    );
    res.redirect('/admin/design?msg=Standard+layout+is+now+live#tab=source');
  } catch (err) {
    console.error('[templates] use-standard:', err);
    res.redirect('/admin/design?err=1#tab=source');
  }
});

// ── Switch the homepage LOOK (landing_layout theme) — CARBON-COPY, lossless ──
// index.ejs renders ALL the tenant's content/modules; the look only re-styles via
// [data-layout]. Clears any active block template + forces home_source:slab so the
// full standard layout renders. Remembers the previous look so the design panel can
// offer a 20-second accept/undo.
router.post('/use-look', async (req, res) => {
  try {
    const db = req.db;
    const look = cleanLook(String(req.body.look || ''));
    if (!look) return res.redirect('/admin/design?err=Unknown+look#tab=source');
    const prev = (await db.collection('design').findOne({ key: 'landing_layout' }))?.value || 'classic';
    await snapshotBeforeSwitch(db, 'use-look: ' + look);
    const r = await db.collection('active_template').updateOne(
      {}, { $set: { templateId: null, appliedAt: null, contentOverrides: {} } },
    );
    if (!r.matchedCount) await db.collection('active_template').deleteMany({});
    await db.collection('design').updateOne(
      { key: 'home_source' },
      { $set: { key: 'home_source', value: 'slab', updatedAt: new Date() } }, { upsert: true },
    );
    await db.collection('design').updateOne(
      { key: 'landing_layout' },
      { $set: { key: 'landing_layout', value: look, updatedAt: new Date() } }, { upsert: true },
    );
    res.redirect(`/admin/design?look_to=${encodeURIComponent(look)}&look_from=${encodeURIComponent(prev)}#tab=source`);
  } catch (err) {
    console.error('[templates] use-look:', err);
    res.redirect('/admin/design?err=1#tab=source');
  }
});

// ── Template-switch backups: list + restore ──────────────────────────────────
// Recovery path for "my copy vanished after switching templates". Each snapshot
// holds the pre-switch home_source / active_template / copy / design.
router.get('/switch-backups', async (req, res) => {
  try {
    const rows = await req.db.collection('template_switch_backups')
      .find({}, { projection: { copy: 0, design: 0 } })
      .sort({ createdAt: -1 }).limit(10).toArray();
    res.json({ ok: true, backups: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore render mode from a snapshot. By default restores ONLY the render
// switch (home_source + active_template) — the safe, common fix. Pass
// restoreContent=1 to also roll copy + design back to the snapshot (rarely
// needed, since a switch never edits them).
router.post('/switch-backups/:id/restore', async (req, res) => {
  try {
    const db = req.db;
    const snap = await db.collection('template_switch_backups').findOne({ _id: new ObjectId(req.params.id) });
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

    // Take a snapshot of the CURRENT state first, so restore is itself undoable.
    await snapshotBeforeSwitch(db, 'pre-restore');

    // Render mode.
    if (snap.home_source != null) {
      await db.collection('design').updateOne(
        { key: 'home_source' },
        { $set: { key: 'home_source', value: snap.home_source, updatedAt: new Date() } },
        { upsert: true },
      );
    }
    await db.collection('active_template').deleteMany({});
    if (snap.active_template) {
      const { _id, ...at } = snap.active_template;
      await db.collection('active_template').insertOne(at);
    }

    // Optional full content roll-back.
    if (req.body.restoreContent === '1' || req.body.restoreContent === 'true') {
      if (Array.isArray(snap.copy)) {
        const ops = snap.copy.map(r => db.collection('copy').updateOne(
          { key: r.key }, { $set: { key: r.key, value: r.value, updatedAt: new Date() } }, { upsert: true }));
        await Promise.all(ops);
      }
      if (Array.isArray(snap.design)) {
        const ops = snap.design.map(r => db.collection('design').updateOne(
          { key: r.key }, { $set: { key: r.key, value: r.value, updatedAt: new Date() } }, { upsert: true }));
        await Promise.all(ops);
      }
    }
    res.json({ ok: true, restored: { home_source: snap.home_source, activeTemplate: !!snap.active_template, content: req.body.restoreContent === '1' } });
  } catch (err) {
    console.error('[templates] restore:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Publish / unpublish to store ─────────────────────────────────────────────
router.post('/:id/publish', async (req, res) => {
  try {
    const db = req.db;
    const tpl = await db.collection('templates').findOne({ _id: new ObjectId(req.params.id) });
    if (!tpl) return res.redirect('/admin/templates');

    const slab = getSlabDb();

    if (tpl.isPublic) {
      // Unpublish
      await slab.collection('template_store').updateOne(
        { sourceTemplateId: tpl._id, sourceTenantId: req.tenant?.db },
        { $set: { status: 'removed', updatedAt: new Date() } },
      );
      await db.collection('templates').updateOne(
        { _id: tpl._id },
        { $set: { isPublic: false, updatedAt: new Date() } },
      );
      return res.redirect('/admin/templates?msg=unpublished');
    }

    // Publish — validate
    if (!tpl.name || !tpl.description) {
      return res.redirect('/admin/templates?err=Template+needs+a+name+and+description+to+publish');
    }
    if (!tpl.blocks || tpl.blocks.length < 2) {
      return res.redirect('/admin/templates?err=Template+needs+at+least+2+blocks+to+publish');
    }

    const now = new Date();
    const storeDoc = {
      sourceTemplateId: tpl._id,
      sourceTenantId: req.tenant?.db || '',
      sourceTenantName: req.tenant?.brand?.name || '',
      name: tpl.name,
      slug: tpl.slug,
      description: tpl.description,
      category: tpl.category,
      tags: tpl.tags || [],
      thumbnail: tpl.thumbnail || '',
      blocks: tpl.blocks,
      designSnapshot: tpl.designSnapshot || {},
      upvotes: 0,
      downvotes: 0,
      score: 0,
      downloads: 0,
      authorName: tpl.authorName || req.adminUser?.displayName || '',
      status: 'active',
      submittedAt: now,
      updatedAt: now,
    };

    await slab.collection('template_store').updateOne(
      { sourceTemplateId: tpl._id, sourceTenantId: req.tenant?.db },
      { $set: storeDoc },
      { upsert: true },
    );

    await db.collection('templates').updateOne(
      { _id: tpl._id },
      { $set: { isPublic: true, updatedAt: now } },
    );

    res.redirect('/admin/templates?msg=published');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
  }
});

// ── Preview (iframe endpoint) ────────────────────────────────────────────────
router.get('/:id/preview', async (req, res) => {
  try {
    const db = req.db;
    const tpl = await db.collection('templates').findOne({ _id: new ObjectId(req.params.id) });
    if (!tpl) return res.status(404).send('Template not found');

    // Default: render the template in its OWN captured look (designSnapshot over the
    // tenant base) so library previews look distinct, not homogenized to one palette.
    // ?designMode=live forces the tenant's current live tokens instead.
    const forceLive = req.query.designMode === 'live';
    const baseDesign = await getDesign(db);
    const design = (!forceLive && tpl.designSnapshot && Object.keys(tpl.designSnapshot).length)
      ? enrichDesignContrast({ ...baseDesign, ...tpl.designSnapshot })
      : baseDesign;

    // Merge any active content overrides
    const active = await db.collection('active_template').findOne({ templateId: tpl._id });
    const blocks = (tpl.blocks || []).map(b => {
      const overrides = active?.contentOverrides?.[b.id] || {};
      return { ...b, fields: { ...b.fields, ...overrides } };
    });

    // Extra locals so skinned previews match the live render.
    const [logoRows, navLinks] = await Promise.all([
      db.collection('brand_images').find({ slot: { $in: ['logo_primary', 'logo_white'] } }).toArray(),
      db.collection('nav_links').find({}).sort({ order: 1, createdAt: 1 }).toArray(),
    ]);
    const logos = {};
    for (const r of logoRows) logos[r.slot] = r.url;
    const visibility = {
      header: design.vis_header !== 'false',
      footer: design.vis_footer !== 'false',
      blog: design.vis_blog === 'true',
    };

    // Allow the form's skin picker to preview a not-yet-saved skin via ?skin=.
    const previewTpl = req.query.skin ? { ...tpl, skin: cleanSkin(req.query.skin) } : tpl;

    res.render('admin/templates/preview', {
      design, blocks, tpl: previewTpl,
      brand: res.locals.brand || {},
      logos, navLinks, visibility,
      centralAuthUrl: '/admin/login',
    });
  } catch (err) {
    console.error('[templates/preview]', err);
    res.status(500).send('Preview error');
  }
});

// ── Preview for unsaved (POST with blocks JSON) ─────────────────────────────
router.post('/preview', async (req, res) => {
  try {
    const db = req.db;
    let blocks = [];
    try { blocks = JSON.parse(req.body.blocksJson || '[]'); } catch {}
    blocks = blocks.filter(b => b && VALID_BLOCK_TYPES.includes(b.type));

    const design = await getDesign(db);
    const visibility = { header: design.vis_header !== 'false', footer: design.vis_footer !== 'false', blog: design.vis_blog === 'true' };
    res.render('admin/templates/preview', {
      design, blocks,
      tpl: { name: 'Preview', skin: req.body.skin || 'classic' },
      brand: res.locals.brand || {}, logos: {}, navLinks: [], visibility,
      centralAuthUrl: '/admin/login',
    });
  } catch (err) {
    console.error('[templates/preview]', err);
    res.status(500).send('Preview error');
  }
});

export default router;
