import express from 'express';
import { ObjectId } from 'mongodb';
import { getSlabDb } from '../../plugins/mongo.js';
import { DESIGN_DEFAULTS } from './design.js';
import { enrichDesignContrast } from '../../plugins/colorContrast.js';
import { VALID_BLOCK_TYPES } from '../../config/blocks.js';

const router = express.Router();

// ── Browse store ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const slab = getSlabDb();
    const { category, sort, q } = req.query;

    const filter = { status: 'active' };
    if (category && category !== 'all') filter.category = category;
    if (q) filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { tags: { $regex: q, $options: 'i' } },
    ];

    const sortMap = {
      popular: { score: -1, downloads: -1 },
      downloads: { downloads: -1 },
      newest: { submittedAt: -1 },
      alpha: { name: 1 },
    };
    const sortBy = sortMap[sort] || sortMap.popular;

    const templates = await slab.collection('template_store')
      .find(filter).sort(sortBy).limit(60).toArray();

    // Get current user's votes
    const userId = req.adminUser?._id;
    const tenantId = req.tenant?.db || '';
    let userVotes = {};
    if (userId) {
      const votes = await slab.collection('template_votes')
        .find({ tenantId, userId: new ObjectId(userId) }).toArray();
      for (const v of votes) userVotes[v.storeTemplateId.toString()] = v.vote;
    }

    res.render('admin/template-store/index', {
      user: req.adminUser, page: 'template-store', title: 'Template Store',
      templates, userVotes,
      category: category || 'all', sort: sort || 'popular', q: q || '',
    });
  } catch (err) {
    console.error('[template-store]', err);
    res.redirect('/admin/templates');
  }
});

// ── AJAX browse (for filtering without page reload) ──────────────────────────
router.get('/api/browse', async (req, res) => {
  try {
    const slab = getSlabDb();
    const { category, sort, q, page: pg } = req.query;
    const pageNum = Math.max(parseInt(pg) || 1, 1);
    const perPage = 24;

    const filter = { status: 'active' };
    if (category && category !== 'all') filter.category = category;
    if (q) filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { tags: { $regex: q, $options: 'i' } },
    ];

    const sortMap = {
      popular: { score: -1 },
      downloads: { downloads: -1 },
      newest: { submittedAt: -1 },
      alpha: { name: 1 },
    };
    const sortBy = sortMap[sort] || sortMap.popular;

    const [templates, total] = await Promise.all([
      slab.collection('template_store')
        .find(filter).sort(sortBy).skip((pageNum - 1) * perPage).limit(perPage).toArray(),
      slab.collection('template_store').countDocuments(filter),
    ]);

    res.json({ templates, total, page: pageNum, perPage });
  } catch (err) {
    console.error('[template-store/api]', err);
    res.status(500).json({ error: 'Failed to browse templates' });
  }
});

// ── Template detail ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const slab = getSlabDb();
    const template = await slab.collection('template_store').findOne({ _id: new ObjectId(req.params.id) });
    if (!template) return res.redirect('/admin/template-store');

    // User's vote
    const userId = req.adminUser?._id;
    const tenantId = req.tenant?.db || '';
    let userVote = 0;
    if (userId) {
      const existing = await slab.collection('template_votes').findOne({
        storeTemplateId: template._id, tenantId, userId: new ObjectId(userId),
      });
      if (existing) userVote = existing.vote;
    }

    // Build design for preview
    const design = enrichDesignContrast({ ...DESIGN_DEFAULTS, ...template.designSnapshot });

    res.render('admin/template-store/detail', {
      user: req.adminUser, page: 'template-store', title: template.name,
      template, userVote, design,
    });
  } catch (err) {
    console.error('[template-store]', err);
    res.redirect('/admin/template-store');
  }
});

// ── Preview (iframe for detail page) ─────────────────────────────────────────
router.get('/:id/preview', async (req, res) => {
  try {
    const slab = getSlabDb();
    const template = await slab.collection('template_store').findOne({ _id: new ObjectId(req.params.id) });
    if (!template) return res.status(404).send('Not found');

    const useMyDesign = req.query.designMode === 'current';
    let design;
    if (useMyDesign) {
      const rows = await req.db.collection('design').find({}).toArray();
      const d = { ...DESIGN_DEFAULTS };
      for (const r of rows) d[r.key] = r.value;
      design = enrichDesignContrast(d);
    } else {
      design = enrichDesignContrast({ ...DESIGN_DEFAULTS, ...template.designSnapshot });
    }

    res.render('admin/templates/preview', { design, blocks: template.blocks || [], tpl: template });
  } catch (err) {
    console.error('[template-store/preview]', err);
    res.status(500).send('Preview error');
  }
});

// ── Vote (AJAX) ──────────────────────────────────────────────────────────────
router.post('/:id/vote', async (req, res) => {
  try {
    const slab = getSlabDb();
    const { vote } = req.body; // 1 or -1
    const voteVal = vote === 1 || vote === '1' ? 1 : -1;
    const storeTemplateId = new ObjectId(req.params.id);
    const userId = new ObjectId(req.adminUser._id);
    const tenantId = req.tenant?.db || '';

    const existing = await slab.collection('template_votes').findOne({
      storeTemplateId, tenantId, userId,
    });

    if (existing) {
      if (existing.vote === voteVal) {
        // Un-vote (toggle off)
        await slab.collection('template_votes').deleteOne({ _id: existing._id });
        const inc = voteVal === 1 ? { upvotes: -1, score: -1 } : { downvotes: -1, score: 1 };
        await slab.collection('template_store').updateOne({ _id: storeTemplateId }, { $inc: inc });
        return res.json({ userVote: 0 });
      } else {
        // Switch vote direction
        await slab.collection('template_votes').updateOne(
          { _id: existing._id },
          { $set: { vote: voteVal, createdAt: new Date() } },
        );
        const inc = voteVal === 1
          ? { upvotes: 1, downvotes: -1, score: 2 }
          : { upvotes: -1, downvotes: 1, score: -2 };
        await slab.collection('template_store').updateOne({ _id: storeTemplateId }, { $inc: inc });
        return res.json({ userVote: voteVal });
      }
    }

    // New vote
    await slab.collection('template_votes').insertOne({
      storeTemplateId, tenantId, userId,
      vote: voteVal,
      createdAt: new Date(),
    });
    const inc = voteVal === 1 ? { upvotes: 1, score: 1 } : { downvotes: 1, score: -1 };
    await slab.collection('template_store').updateOne({ _id: storeTemplateId }, { $inc: inc });
    res.json({ userVote: voteVal });
  } catch (err) {
    console.error('[template-store/vote]', err);
    res.status(500).json({ error: 'Vote failed' });
  }
});

// ── Download / install to tenant ─────────────────────────────────────────────
router.post('/:id/download', async (req, res) => {
  try {
    const slab = getSlabDb();
    const db = req.db;
    const storeTpl = await slab.collection('template_store').findOne({ _id: new ObjectId(req.params.id) });
    if (!storeTpl) return res.redirect('/admin/template-store');

    const now = new Date();
    let slug = storeTpl.slug || storeTpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await db.collection('templates').findOne({ slug });
    if (existing) slug += '-' + Date.now().toString(36);

    const { insertedId } = await db.collection('templates').insertOne({
      name: storeTpl.name,
      slug,
      description: storeTpl.description || '',
      category: storeTpl.category || 'landing',
      tags: storeTpl.tags || [],
      blocks: JSON.parse(JSON.stringify(storeTpl.blocks || [])),
      designSnapshot: storeTpl.designSnapshot || {},
      thumbnail: storeTpl.thumbnail || '',
      isPublic: false,
      source: 'store',
      authorName: storeTpl.authorName || '',
      authorEmail: '',
      createdAt: now,
      updatedAt: now,
    });

    // Increment download counter
    await slab.collection('template_store').updateOne(
      { _id: storeTpl._id },
      { $inc: { downloads: 1 } },
    );

    res.redirect('/admin/templates/' + insertedId + '/edit');
  } catch (err) {
    console.error('[template-store/download]', err);
    res.redirect('/admin/template-store?err=1');
  }
});

export default router;
