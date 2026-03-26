import express from 'express';
import { getDb } from '../../plugins/mongo.js';
import { ObjectId } from 'mongodb';
import { webSearch, callLLM, tryParseAgentResponse } from '../../plugins/agentMcp.js';
import { buildBrandContext } from '../../plugins/brandContext.js';

const router = express.Router();

const ALLOWED_COLLECTIONS = ['blog', 'portfolio'];
const ALLOWED_PAGE_TYPES  = ['content', 'data-list', 'landing'];
const RESERVED_SLUGS      = ['blog', 'admin', 'auth', 'sitemap.xml'];

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function pageFields(body, current) {
  const now = new Date();
  const pageType = ALLOWED_PAGE_TYPES.includes(body.pageType) ? body.pageType : 'content';
  let blocks = [];
  try { blocks = JSON.parse(body.blocksJson || '[]'); } catch {}
  // Validate block types
  const VALID_BLOCK_TYPES = ['hero','text','split','cta','cards','faq'];
  blocks = blocks.filter(b => b && VALID_BLOCK_TYPES.includes(b.type));

  const dataCollection = ALLOWED_COLLECTIONS.includes(body.dataCollection) ? body.dataCollection : 'blog';
  const dataPageSize   = Math.min(Math.max(parseInt(body.dataPageSize) || 9, 1), 100);

  return {
    pageType,
    content:          body.content || '',
    dataCollection,
    dataPageSize,
    blocks,
    metaTitle:        body.metaTitle || body.title,
    metaDescription:  body.metaDescription || '',
    ogImage:          body.ogImage || '',
    canonicalUrl:     body.canonicalUrl || '',
    robotsMeta:       ['index,follow','noindex,follow','index,nofollow','noindex,nofollow'].includes(body.robotsMeta)
                        ? body.robotsMeta : 'index,follow',
    sitemapPriority:  Math.min(Math.max(parseFloat(body.sitemapPriority) || 0.5, 0), 1),
    sitemapChangefreq: ['always','hourly','daily','weekly','monthly','yearly','never'].includes(body.sitemapChangefreq)
                        ? body.sitemapChangefreq : 'monthly',
    showInNav:        body.showInNav === 'on',
    status:           body.status === 'published' ? 'published' : 'draft',
    publishedAt:      body.status === 'published' && !current?.publishedAt ? now : current?.publishedAt || null,
    updatedAt:        now,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const pages = await db.collection('pages').find({}).sort({ createdAt: -1 }).toArray();
    res.render('admin/pages/index', {
      user: req.adminUser, page: 'pages', title: 'Pages', pages,
      msg: req.query.msg, err: req.query.err,
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin');
  }
});

// ── Page Agent — MUST come before /:id ───────────────────────────────────────
router.post('/agent', async (req, res) => {
  const { messages, pageType, currentPage } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  try {
    const lastMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const searchResults = await webSearch(lastMsg.slice(0, 200));
    const researchCtx = searchResults && !searchResults.startsWith('Search')
      ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';

    const pageCtx = currentPage?.title
      ? `\n\nExisting page — title: "${currentPage.title}", type: "${currentPage.pageType || 'content'}"` : '';

    const isLanding   = (pageType || currentPage?.pageType) === 'landing';
    const isDataList  = (pageType || currentPage?.pageType) === 'data-list';

    const brandCtx = buildBrandContext(req.tenant?.brand || {});

    let systemPrompt;
    if (isLanding) {
      systemPrompt = `You are a web page builder assistant for the business.

${brandCtx}

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing what you built",
  "fill": {
    "title": "page title",
    "metaTitle": "SEO title",
    "metaDescription": "SEO description"
  },
  "suggestedBlocks": [
    { "type": "hero",  "fields": { "heading": "...", "subheading": "...", "cta_text": "...", "cta_link": "/#contact" } },
    { "type": "text",  "fields": { "heading": "...", "subheading": "...", "body": "<p>...</p>" } },
    { "type": "cards", "fields": { "heading": "...", "subtext": "...", "card1_title": "...", "card1_body": "...", "card2_title": "...", "card2_body": "...", "card3_title": "...", "card3_body": "..." } },
    { "type": "cta",   "fields": { "heading": "...", "subtext": "...", "btn_text": "...", "btn_link": "/#contact" } }
  ]
}

Block types available: hero, text, split, cta, cards, faq.
Design 3-5 blocks that make sense for the page purpose.
Tailor tone and content to the business and audience described above.${pageCtx}${researchCtx}`;
    } else {
      systemPrompt = `You are a web page content writer for the business.

${brandCtx}

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing what you wrote",
  "fill": {
    "title": "page title",
    "metaTitle": "SEO title",
    "metaDescription": "SEO description under 160 chars",
    "content": "full HTML content as single escaped string"
  }
}

Rules for content:
- Write 300-600 words using <h2>, <p>, <strong>, <ul>, <li> tags
- Escape all double quotes inside HTML as \\"
- No literal newlines in the JSON string — use \\n
- End with a mention of the business by name
Tailor tone and content to the business and audience described above.${pageCtx}${researchCtx}`;
    }

    const raw = await callLLM(messages, systemPrompt);
    const parsed = tryParseAgentResponse(raw);

    // Extract suggestedBlocks separately (tryParseAgentResponse only handles fill)
    let suggestedBlocks = [];
    try {
      const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        const full = JSON.parse(m[0]);
        if (Array.isArray(full.suggestedBlocks)) suggestedBlocks = full.suggestedBlocks;
      }
    } catch {}

    res.json({ ...parsed, suggestedBlocks });
  } catch (err) {
    console.error('[pages/agent]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── New form ──────────────────────────────────────────────────────────────────
router.get('/new', (req, res) => {
  res.render('admin/pages/form', {
    user: req.adminUser, page: 'pages', title: 'New Page', pg: null, error: null,
  });
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { title, slug } = req.body;
    const finalSlug = slug ? toSlug(slug) : toSlug(title);
    if (RESERVED_SLUGS.includes(finalSlug)) {
      return res.render('admin/pages/form', {
        user: req.adminUser, page: 'pages', title: 'New Page', pg: req.body,
        error: `"${finalSlug}" is a reserved path.`,
      });
    }
    const existing = await db.collection('pages').findOne({ slug: finalSlug });
    if (existing) {
      return res.render('admin/pages/form', {
        user: req.adminUser, page: 'pages', title: 'New Page', pg: req.body,
        error: 'A page with that slug already exists.',
      });
    }
    const now = new Date();
    const fields = pageFields(req.body, null);
    await db.collection('pages').insertOne({ title, slug: finalSlug, ...fields, createdAt: now });
    res.redirect('/admin/pages?msg=created');
  } catch (err) {
    console.error(err);
    res.render('admin/pages/form', {
      user: req.adminUser, page: 'pages', title: 'New Page', pg: req.body, error: 'Failed to create page.',
    });
  }
});

// ── Edit form ─────────────────────────────────────────────────────────────────
router.get('/:id/edit', async (req, res) => {
  try {
    const db = req.db;
    const pg = await db.collection('pages').findOne({ _id: new ObjectId(req.params.id) });
    if (!pg) return res.redirect('/admin/pages');
    res.render('admin/pages/form', {
      user: req.adminUser, page: 'pages', title: 'Edit Page', pg, error: null,
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/pages');
  }
});

// ── Update — MUST come after /agent ──────────────────────────────────────────
router.post('/:id', async (req, res) => {
  try {
    const db = req.db;
    const { title, slug } = req.body;
    const finalSlug = slug ? toSlug(slug) : toSlug(title);
    if (RESERVED_SLUGS.includes(finalSlug)) {
      return res.render('admin/pages/form', {
        user: req.adminUser, page: 'pages', title: 'Edit Page',
        pg: { ...req.body, _id: req.params.id }, error: `"${finalSlug}" is a reserved path.`,
      });
    }
    const existing = await db.collection('pages').findOne({
      slug: finalSlug, _id: { $ne: new ObjectId(req.params.id) },
    });
    if (existing) {
      return res.render('admin/pages/form', {
        user: req.adminUser, page: 'pages', title: 'Edit Page',
        pg: { ...req.body, _id: req.params.id }, error: 'That slug is already in use.',
      });
    }
    const current = await db.collection('pages').findOne({ _id: new ObjectId(req.params.id) });
    const fields = pageFields(req.body, current);
    await db.collection('pages').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title, slug: finalSlug, ...fields } }
    );
    res.redirect('/admin/pages?msg=updated');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/pages?err=1');
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('pages').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/pages?msg=deleted');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/pages?err=1');
  }
});

export default router;
