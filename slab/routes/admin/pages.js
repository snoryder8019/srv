import express from 'express';
import { getDb } from '../../plugins/mongo.js';
import { ObjectId } from 'mongodb';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { webSearch, callLLM, tryParseAgentResponse, generateSdImage, buildBrandedSdPrompt, recordTrainingCandidate } from '../../plugins/agentMcp.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { agentLLMOpts } from '../../plugins/agentRegistry.js';
import { s3Client, BUCKET, bucketUrl } from '../../plugins/s3.js';
import { BLOCK_FIELDS, PAGE_BLOCK_TYPES, PAGE_BLOCK_DEFAULTS, PAGE_BLOCK_META } from '../../config/blocks.js';
import { PAGE_SOURCE_KEYS, PAGE_SOURCES, resolveSource, synthesizeLegacyBlocks } from '../../plugins/pageSources.js';

const router = express.Router();

const RESERVED_SLUGS = ['blog', 'newsletter', 'help', 'admin', 'auth', 'sitemap.xml'];

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Unified page builder: every page is a block stack. The view still expects the
// `VALID_BLOCK_TYPES` key, but for pages we feed it the PAGE superset (visual
// blocks + html + datalist). PAGE_SOURCE_KEYS/labels drive the datalist <select>.
function blockCatalog() {
  return {
    VALID_BLOCK_TYPES: PAGE_BLOCK_TYPES,
    BLOCK_FIELDS: JSON.stringify(BLOCK_FIELDS),
    BLOCK_DEFAULTS: JSON.stringify(PAGE_BLOCK_DEFAULTS),
    BLOCK_META: JSON.stringify(PAGE_BLOCK_META),
    PAGE_SOURCES: JSON.stringify(PAGE_SOURCE_KEYS.map(k => ({ key: k, label: PAGE_SOURCES[k].label, group: !!PAGE_SOURCES[k].groupField }))),
  };
}

// Sanitize one datalist block's fields against the source registry.
function sanitizeDatalistFields(fields) {
  const source = resolveSource(fields.source);
  const hasGroup = !!PAGE_SOURCES[source].groupField;
  return {
    heading: typeof fields.heading === 'string' ? fields.heading : '',
    source,
    pageSize: String(Math.min(Math.max(parseInt(fields.pageSize) || 9, 1), 100)),
    group: hasGroup && typeof fields.group === 'string' ? fields.group.trim() : '',
    paginate: fields.paginate === 'true' || fields.paginate === true ? 'true' : '',
  };
}

// Which image slots each block type supports (mirror of BLOCK_IMAGE_SLOTS in the form view).
const BLOCK_IMAGE_SLOTS = {
  hero:         ['background'],
  text:         ['background'],
  split:        ['main_image'],
  cta:          ['background'],
  cards:        ['background', 'card1_image', 'card2_image', 'card3_image', 'card4_image'],
  faq:          ['background'],
  pricing:      ['background'],
  testimonials: ['background', 't1_avatar', 't2_avatar', 't3_avatar'],
  stats:        ['background'],
  ticker:       [],
};

const BLOCK_SD_PRESET = {
  hero: 'fb-cover', cta: 'fb-cover', split: 'fb-post',
  cards: 'fb-post', testimonials: 'ig-post', text: 'fb-post',
  pricing: 'fb-post', faq: 'fb-post', stats: 'fb-post',
};

async function uploadPageImage(buffer, s3Prefix) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${s3Prefix || 'default'}/assets/pages/${ts}-${rand}.png`;
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer,
    ContentType: 'image/png', ACL: 'public-read',
  }), { abortSignal: AbortSignal.timeout(60000) });
  return { key, url: bucketUrl(key) };
}

// Generate one SD image and stash it in the assets collection so the user can
// re-pick it later. Best-effort — never throws.
async function generateBlockImageForAgent({ seedPrompt, sizePreset, brandContext, tenant, db, userEmail }) {
  try {
    const branded = await buildBrandedSdPrompt(seedPrompt, brandContext, { sizePreset });
    const png = await generateSdImage(branded.prompt, branded.negative, sizePreset);
    const { key, url } = await uploadPageImage(png, tenant?.s3Prefix);

    recordTrainingCandidate({
      prompt: branded.prompt, seedPrompt, negativePrompt: branded.negative,
      sizePreset, bucketKey: key, publicUrl: url, byteSize: png.length,
      source: `pages-agent:${branded.source}`,
      tenant: { db: tenant?.db, name: tenant?.brand?.name, prefix: tenant?.s3Prefix },
      userEmail: userEmail || null,
    });

    try {
      await db.collection('assets').insertOne({
        filename: key.split('/').pop(),
        originalName: 'page-block.png',
        folders: ['pages'], folder: 'pages',
        publicUrl: url, bucketKey: key,
        fileType: 'image', mimeType: 'image/png', size: png.length,
        title: 'Page block image',
        tags: ['pages', 'ai-generated'],
        generatedFrom: { prompt: seedPrompt, sdPrompt: branded.prompt, source: 'pages-agent', createdAt: new Date() },
        uploadedAt: new Date(),
      });
    } catch (e) {
      console.warn('[pages-agent] asset insert failed (non-fatal):', e.message);
    }
    return { url, key };
  } catch (e) {
    console.warn('[pages-agent] block image generation failed (non-fatal):', e.message);
    return null;
  }
}

function pageFields(body, current) {
  const now = new Date();
  let blocks = [];
  try { blocks = JSON.parse(body.blocksJson || '[]'); } catch {}
  blocks = blocks
    .filter(b => b && PAGE_BLOCK_TYPES.includes(b.type))
    .map(b => {
      const fields = b.fields && typeof b.fields === 'object' ? b.fields : {};
      return {
        id: b.id || undefined,
        type: b.type,
        // datalist config is validated against the source registry; other block
        // types (incl. html — same <%- trust boundary as legacy `content`) pass through.
        fields: b.type === 'datalist' ? sanitizeDatalistFields(fields) : fields,
        images: b.images && typeof b.images === 'object' ? b.images : {},
      };
    });

  return {
    // Unified pages are always a block stack. 'landing' is the block-stack render
    // path, so every saved page keeps it — no more content/data-list page modes.
    pageType: 'landing',
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
      ? `\n\nExisting page — title: "${currentPage.title}"` : '';

    const brandCtx = await loadBrandContext(req.tenant, req.db);

    // ONE unified builder prompt. A page is a block stack; the agent may mix
    // visual blocks, an "html" block (rich HTML prose), and a "datalist" block
    // that pipes in another module's content (blog, portfolio, careers, …).
    const systemPrompt = `You are a web page builder assistant for the business.

${brandCtx}

A page is a STACK of blocks rendered top-to-bottom. Compose whatever mix best serves the page's purpose.

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing what you built",
  "fill": {
    "title": "page title",
    "slug": "url-slug",
    "status": "draft | published",
    "showInNav": true,
    "metaTitle": "SEO title",
    "metaDescription": "SEO description under 160 chars",
    "ogImage": "https://… (optional)",
    "robotsMeta": "index,follow"
  },
  "suggestedBlocks": [
    { "type": "hero",  "fields": { "heading": "...", "subheading": "...", "cta_text": "...", "cta_link": "/#contact" },
      "sd_prompts": { "background": "atmospheric dark steel workshop, sparks, navy palette — no text" } },
    { "type": "html",  "fields": { "html": "<h2>...</h2><p>...</p>" } },
    { "type": "cards", "fields": { "heading": "...", "subtext": "...", "card1_title": "...", "card1_body": "...", "card2_title": "...", "card2_body": "...", "card3_title": "...", "card3_body": "..." } },
    { "type": "datalist", "fields": { "heading": "Latest from the blog", "source": "blog", "pageSize": "6", "paginate": "true" } },
    { "type": "cta",   "fields": { "heading": "...", "subtext": "...", "btn_text": "...", "btn_link": "/#contact" } }
  ]
}

Visual block types: hero, text, split, cta, cards, faq, pricing, testimonials, stats, ticker.
"html" block — fields.html is a single HTML string (<h2>,<p>,<strong>,<ul>,<li>,<a>). Escape inner quotes as \\" and use \\n for newlines. Use for long-form prose.
"datalist" block — pipes in a module's published content. fields.source ∈ [${PAGE_SOURCE_KEYS.join(', ')}]. Optional fields.pageSize (default 9), fields.group (only for portfolio/careers/marketplace), fields.paginate ("true"/"false"). Use when the user wants a list of posts, portfolio work, jobs, or listings.

Image slots (use the "sd_prompts" map keyed by slot name; the server generates the image and attaches the URL):
- hero, cta, faq, pricing, stats, text: "background"
- split: "main_image"
- cards: "background", "card1_image" … "card4_image"
- testimonials: "background", "t1_avatar" … "t3_avatar"
- html, datalist, ticker: (none)

SD prompt rules:
- Describe textures, palette, mood, lighting only. NEVER include text, letters, logos, or brand names.
- Pull palette hints from the business brand context above.
- Use sd_prompts only for the 1-2 blocks that genuinely need imagery (usually the hero).

Design 3-6 blocks that make sense for the page purpose. If the user is clearly asking for a single long article, one "html" block is fine.
Tailor tone and content to the business and audience described above.${pageCtx}${researchCtx}`;

    const raw = await callLLM(messages, systemPrompt, 90000, await agentLLMOpts(req.db, req.tenant, 'page'));
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

    // Materialize per-block SD images. We do these in parallel but cap to a
    // reasonable budget so a 6-block page doesn't queue up 30 SD calls. Blocks
    // with no image slots (html, datalist, ticker) are skipped automatically.
    if (suggestedBlocks.length) {
      const userEmail = req.adminUser?.email || null;
      const jobs = [];
      const MAX_IMAGES = 4;
      for (const block of suggestedBlocks) {
        if (!block || !PAGE_BLOCK_TYPES.includes(block.type)) continue;
        const slots = BLOCK_IMAGE_SLOTS[block.type] || [];
        const sdMap = block.sd_prompts || {};
        for (const slot of slots) {
          if (jobs.length >= MAX_IMAGES) break;
          const seed = sdMap[slot];
          if (!seed || typeof seed !== 'string') continue;
          jobs.push((async () => {
            const out = await generateBlockImageForAgent({
              seedPrompt: seed,
              sizePreset: BLOCK_SD_PRESET[block.type] || 'fb-post',
              brandContext: brandCtx,
              tenant: req.tenant, db: req.db, userEmail,
            });
            if (out?.url) {
              if (!block.images) block.images = {};
              block.images[slot] = out.url;
            }
          })());
        }
        if (jobs.length >= MAX_IMAGES) break;
      }
      if (jobs.length) await Promise.all(jobs);
      // Strip sd_prompts before sending to the client — they're an LLM-only hint.
      suggestedBlocks = suggestedBlocks.map(b => {
        const { sd_prompts, ...rest } = b;
        return rest;
      });
    }

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
    ...blockCatalog(),
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
        ...blockCatalog(),
      });
    }
    const existing = await db.collection('pages').findOne({ slug: finalSlug });
    if (existing) {
      return res.render('admin/pages/form', {
        user: req.adminUser, page: 'pages', title: 'New Page', pg: req.body,
        error: 'A page with that slug already exists.',
        ...blockCatalog(),
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
      ...blockCatalog(),
    });
  }
});

// ── Edit form ─────────────────────────────────────────────────────────────────
router.get('/:id/edit', async (req, res) => {
  try {
    const db = req.db;
    const pg = await db.collection('pages').findOne({ _id: new ObjectId(req.params.id) });
    if (!pg) return res.redirect('/admin/pages');
    // Legacy content/data-list pages open in the unified builder as synthesized blocks.
    pg.blocks = synthesizeLegacyBlocks(pg);
    pg.pageType = 'landing';
    res.render('admin/pages/form', {
      user: req.adminUser, page: 'pages', title: 'Edit Page', pg, error: null,
      ...blockCatalog(),
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
        ...blockCatalog(),
      });
    }
    const existing = await db.collection('pages').findOne({
      slug: finalSlug, _id: { $ne: new ObjectId(req.params.id) },
    });
    if (existing) {
      return res.render('admin/pages/form', {
        user: req.adminUser, page: 'pages', title: 'Edit Page',
        pg: { ...req.body, _id: req.params.id }, error: 'That slug is already in use.',
        ...blockCatalog(),
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
