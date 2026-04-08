import express from 'express';
import { ObjectId } from 'mongodb';
import { getSlabDb } from '../../plugins/mongo.js';
import { VALID_BLOCK_TYPES, BLOCK_FIELDS, BLOCK_DEFAULTS } from '../../config/blocks.js';
import { DESIGN_DEFAULTS, THEME_KEYS } from './design.js';
import { enrichDesignContrast } from '../../plugins/colorContrast.js';

const router = express.Router();

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const templates = await db.collection('templates').find({}).sort({ updatedAt: -1 }).toArray();
    const active = await db.collection('active_template').findOne({});
    res.render('admin/templates/index', {
      user: req.adminUser, page: 'templates', title: 'Templates',
      templates, activeId: active?.templateId?.toString() || null,
      msg: req.query.msg, err: req.query.err,
    });
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin');
  }
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
    res.render('admin/templates/form', {
      user: req.adminUser, page: 'templates', title: 'Edit Template',
      tpl, design, error: null,
      BLOCK_FIELDS: JSON.stringify(BLOCK_FIELDS),
      BLOCK_DEFAULTS: JSON.stringify(BLOCK_DEFAULTS),
      VALID_BLOCK_TYPES,
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

    await db.collection('active_template').updateOne(
      {},
      { $set: {
        templateId: tpl._id,
        appliedAt: new Date(),
        contentOverrides: {},
      }},
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
      { $set: { contentOverrides: overrides } },
    );

    res.redirect('/admin/templates?msg=Content+mapping+saved');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
  }
});

// ── Deactivate ───────────────────────────────────────────────────────────────
router.post('/:id/deactivate', async (req, res) => {
  try {
    await req.db.collection('active_template').deleteMany({});
    res.redirect('/admin/templates?msg=deactivated');
  } catch (err) {
    console.error('[templates]', err);
    res.redirect('/admin/templates?err=1');
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

    const useSnapshot = req.query.designMode === 'snapshot';
    let design;
    if (useSnapshot && tpl.designSnapshot) {
      design = enrichDesignContrast({ ...DESIGN_DEFAULTS, ...tpl.designSnapshot });
    } else {
      design = await getDesign(db);
    }

    // Merge any active content overrides
    const active = await db.collection('active_template').findOne({ templateId: tpl._id });
    const blocks = (tpl.blocks || []).map(b => {
      const overrides = active?.contentOverrides?.[b.id] || {};
      return { ...b, fields: { ...b.fields, ...overrides } };
    });

    res.render('admin/templates/preview', { design, blocks, tpl });
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
    res.render('admin/templates/preview', { design, blocks, tpl: { name: 'Preview' } });
  } catch (err) {
    console.error('[templates/preview]', err);
    res.status(500).send('Preview error');
  }
});

export default router;
