import express from 'express';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../plugins/mongo.js';
import { ObjectId } from 'mongodb';
import { config } from '../../config/config.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { agentLLMOpts } from '../../plugins/agentRegistry.js';
import {
  webSearch,
  callLLM,
  tryParseAgentResponse,
  generateSdImage,
  buildBrandedSdPrompt,
  recordTrainingCandidate,
} from '../../plugins/agentMcp.js';
import { s3Client, BUCKET, bucketUrl } from '../../plugins/s3.js';

const router = express.Router();

// ── WRITER CONTENT TYPES ─────────────────────────────────────────────────────
// The "blog" module is really a general content writer. Every document in the
// `blog` collection carries a `contentType`; legacy docs (no field) are treated
// as 'blog'. `publicAtBlog` marks types served under /blog/:slug.
// `publicBase` is the public archive path for a type (null = embed-only, no page).
// Items live at `${publicBase}/${slug}` with RSS/Atom at `${publicBase}/feed.*`.
export const CONTENT_TYPES = [
  { key: 'blog',       label: 'Blog Post',    icon: '✍',  desc: 'Published article with RSS/Atom feed', publicBase: '/blog' },
  { key: 'newsletter', label: 'Newsletter',   icon: '✉',  desc: 'Issue published to the newsletter archive + feed', publicBase: '/newsletter' },
  { key: 'help',       label: 'Help Article', icon: '?',  desc: 'Help-center article with its own page + feed', publicBase: '/help' },
  { key: 'snippet',    label: 'Snippet',      icon: '◧',  desc: 'Reusable block — embed into pages by tag', publicBase: null },
];
const CONTENT_TYPE_KEYS = CONTENT_TYPES.map(t => t.key);
function normalizeContentType(v) {
  return CONTENT_TYPE_KEYS.includes(v) ? v : 'blog';
}

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Blog hero image — fb-post (640x384) gives a 16:9-ish wide format suitable for
// blog featured images while keeping SD inference under ~30s.
const BLOG_FEATURED_SIZE = 'fb-post';

async function uploadBlogImage(buffer, s3Prefix) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${s3Prefix || 'default'}/assets/blog-featured/${ts}-${rand}.png`;
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
    ACL: 'public-read',
  }), { abortSignal: AbortSignal.timeout(60000) });
  return { key, url: bucketUrl(key) };
}

// Best-effort featured-image generation. Returns { url, key } on success, null
// on failure. Never throws — caller treats it as a bonus, not a hard dependency.
async function generateFeaturedImage({ seed, brandContext, tenant, db, userEmail }) {
  try {
    const branded = await buildBrandedSdPrompt(seed, brandContext, { sizePreset: BLOG_FEATURED_SIZE });
    const pngBuffer = await generateSdImage(branded.prompt, branded.negative, BLOG_FEATURED_SIZE);
    const { key, url } = await uploadBlogImage(pngBuffer, tenant?.s3Prefix);

    recordTrainingCandidate({
      prompt: branded.prompt,
      seedPrompt: seed,
      negativePrompt: branded.negative,
      sizePreset: BLOG_FEATURED_SIZE,
      bucketKey: key, publicUrl: url, byteSize: pngBuffer.length,
      source: `blog-agent:${branded.source}`,
      tenant: { db: tenant?.db, name: tenant?.brand?.name, prefix: tenant?.s3Prefix },
      userEmail: userEmail || null,
    });

    // Also drop it in the asset library so the user can reuse it from the picker.
    try {
      await db.collection('assets').insertOne({
        filename: key.split('/').pop(),
        originalName: 'blog-featured.png',
        folders: ['blog'], folder: 'blog',
        publicUrl: url, bucketKey: key,
        fileType: 'image', mimeType: 'image/png', size: pngBuffer.length,
        title: 'Blog featured image',
        tags: ['blog', 'ai-generated', 'featured'],
        generatedFrom: { prompt: seed, sdPrompt: branded.prompt, source: 'blog-agent', createdAt: new Date() },
        uploadedAt: new Date(),
      });
    } catch (e) {
      console.warn('[blog-agent] asset insert failed (non-fatal):', e.message);
    }

    return { url, key };
  } catch (e) {
    console.warn('[blog-agent] featured image generation failed (non-fatal):', e.message);
    return null;
  }
}

// List
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const all = await db.collection('blog').find({}).sort({ createdAt: -1 }).toArray();
    // Normalize legacy docs (missing contentType) to 'blog' for display/filtering.
    all.forEach(p => { p.contentType = normalizeContentType(p.contentType); });

    const counts = { all: all.length };
    for (const t of CONTENT_TYPES) counts[t.key] = all.filter(p => p.contentType === t.key).length;

    const activeType = CONTENT_TYPE_KEYS.includes(req.query.type) ? req.query.type : 'all';
    const posts = activeType === 'all' ? all : all.filter(p => p.contentType === activeType);

    res.render('admin/blog/index', {
      user: req.adminUser, page: 'blog', title: 'Writer', posts,
      contentTypes: CONTENT_TYPES, activeType, counts,
      msg: req.query.msg, err: req.query.err,
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin');
  }
});

// New form
router.get('/new', async (req, res) => {
  const db = req.db;
  const allPosts = await db.collection('blog').find({}, { projection: { tags: 1, category: 1 } }).toArray();
  const existingTags = [...new Set(allPosts.flatMap(p => Array.isArray(p.tags) ? p.tags : []))].sort();
  const existingCategories = [...new Set(allPosts.map(p => p.category).filter(Boolean))].sort();
  res.render('admin/blog/form', {
    user: req.adminUser, page: 'blog', title: 'New Post', post: null, error: null,
    existingTags, existingCategories, contentTypes: CONTENT_TYPES,
    defaultType: normalizeContentType(req.query.type),
  });
});

// Create
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { title, slug, excerpt, content, category, tags, status, featuredImageUrl, contentType, slidesFolder, slidesStyle } = req.body;
    const finalSlug = slug ? toSlug(slug) : toSlug(title);
    const existing = await db.collection('blog').findOne({ slug: finalSlug });
    if (existing) {
      return res.render('admin/blog/form', {
        user: req.adminUser, page: 'blog', title: 'New Post', post: req.body,
        contentTypes: CONTENT_TYPES, defaultType: normalizeContentType(contentType),
        error: 'A post with that slug already exists. Choose a different title or slug.',
      });
    }
    const now = new Date();
    await db.collection('blog').insertOne({
      title,
      slug: finalSlug,
      contentType: normalizeContentType(contentType),
      excerpt: excerpt || '',
      content: content || '',
      category: category || '',
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      featuredImageUrl: featuredImageUrl || '',
      slidesFolder: slidesFolder || '',
      slidesStyle: slidesStyle === 'grid' ? 'grid' : 'carousel',
      status: status || 'draft',
      publishedAt: status === 'published' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    res.redirect('/admin/blog?msg=created');
  } catch (err) {
    console.error(err);
    res.render('admin/blog/form', {
      user: req.adminUser, page: 'blog', title: 'New Post', post: req.body,
      contentTypes: CONTENT_TYPES, defaultType: normalizeContentType(req.body?.contentType),
      error: 'Failed to create post.',
    });
  }
});

// Edit form
router.get('/:id/edit', async (req, res) => {
  try {
    const db = req.db;
    const [post, allPosts] = await Promise.all([
      db.collection('blog').findOne({ _id: new ObjectId(req.params.id) }),
      db.collection('blog').find({}, { projection: { tags: 1, category: 1 } }).toArray(),
    ]);
    if (!post) return res.redirect('/admin/blog');
    const existingTags = [...new Set(allPosts.flatMap(p => Array.isArray(p.tags) ? p.tags : []))].sort();
    const existingCategories = [...new Set(allPosts.map(p => p.category).filter(Boolean))].sort();
    post.contentType = normalizeContentType(post.contentType);
    res.render('admin/blog/form', {
      user: req.adminUser, page: 'blog', title: 'Edit Post', post, error: null,
      existingTags, existingCategories, contentTypes: CONTENT_TYPES,
      defaultType: post.contentType,
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/blog');
  }
});

// Blog Agent
router.post('/agent', async (req, res) => {
  const { messages, currentPost } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  try {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const searchResults = await webSearch(lastUserMsg.slice(0, 200));

    const postCtx = currentPost?.title
      ? `\n\nExisting post — title: "${currentPost.title}", category: "${currentPost.category || ''}", tags: "${currentPost.tags || ''}"`
      : '';

    const researchCtx = searchResults && !searchResults.startsWith('Search')
      ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---`
      : '';

    const brandCtx = await loadBrandContext(req.tenant, req.db);

    const systemPrompt = `You are a blog writing assistant for the business.

${brandCtx}

Your output MUST follow this exact two-part shape — JSON metadata first, then the HTML content inside <CONTENT>…</CONTENT> sentinel tags. Nothing else: no prose before, between (other than a single newline), or after.

EXAMPLE STRUCTURE (shows the SHAPE only — replace every bracketed placeholder with content written specifically for the business and audience described above. Do NOT reuse this example's topic, wording, or industry):
{"message":"Wrote a post on [the requested topic]","fill":{"title":"[compelling headline about the topic, in the brand's voice]","excerpt":"[one-sentence summary tailored to this business and its audience]","category":"[relevant category]","tags":"[3-5 comma-separated tags relevant to the topic and business]"}}
<CONTENT>
<h2>[Opening heading relevant to the topic]</h2>
<p>[Opening paragraph grounded in THIS business's services, audience, and voice — use <strong>emphasis</strong> where it helps.]</p>
<h2>[Second heading]</h2>
<ul>
  <li>[Specific, useful point tied to the business]</li>
  <li>[Another relevant point]</li>
</ul>
<p>[Closing paragraph with a natural call to action for this business.]</p>
</CONTENT>

RULES:
- The JSON object must be on ONE LINE and contain ONLY title, excerpt, category, tags (NEVER include "content" in the JSON — it goes in the sentinel block).
- Use plain double quotes (") in the JSON. Do not use smart quotes.
- The <CONTENT> block holds raw HTML — no escaping, no JSON encoding. Real newlines and real " quotes are fine inside it.
- Write 400-800 words of HTML inside <CONTENT> using <h2>, <p>, <strong>, <ul>, <li>.
- End the HTML with a soft call-to-action mentioning the business by name.
- Tone: practical, approachable, not corporate. Tailor to the business and audience above.
${postCtx}${researchCtx}`;

    // Generate the featured image in parallel with the content LLM call.
    // SD takes 15-45s and the content call takes ~15-25s — running them
    // sequentially risks Apache proxy timeouts. Only generate when the user
    // doesn't already have a featured image set.
    const wantImage = !currentPost?.featuredImageUrl;
    const imagePromise = wantImage
      ? generateFeaturedImage({
          seed: lastUserMsg.slice(0, 300),
          brandContext: brandCtx,
          tenant: req.tenant,
          db: req.db,
          userEmail: req.adminUser?.email,
        })
      : Promise.resolve(null);

    const llmOpts = await agentLLMOpts(req.db, req.tenant, 'blog');
    const [raw, image] = await Promise.all([
      callLLM(messages, systemPrompt, 90000, llmOpts),
      imagePromise,
    ]);

    const parsed = tryParseAgentResponse(raw);
    if (!parsed.fill?.content) {
      console.warn('[blog-agent] content missing after parse — raw length:', raw.length);
    }
    if (image?.url) {
      parsed.fill = parsed.fill || {};
      parsed.fill.featuredImageUrl = image.url;
    }
    res.json(parsed);
  } catch (err) {
    console.error('Blog agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update
router.post('/:id', async (req, res) => {
  try {
    const db = req.db;
    const { title, slug, excerpt, content, category, tags, status, featuredImageUrl, contentType, slidesFolder, slidesStyle } = req.body;
    const finalSlug = slug ? toSlug(slug) : toSlug(title);
    const existing = await db.collection('blog').findOne({
      slug: finalSlug,
      _id: { $ne: new ObjectId(req.params.id) },
    });
    if (existing) {
      return res.render('admin/blog/form', {
        user: req.adminUser, page: 'blog', title: 'Edit Post',
        post: { ...req.body, _id: req.params.id },
        contentTypes: CONTENT_TYPES, defaultType: normalizeContentType(contentType),
        error: 'That slug is already used by another post.',
      });
    }
    const current = await db.collection('blog').findOne({ _id: new ObjectId(req.params.id) });
    const now = new Date();
    await db.collection('blog').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          title,
          slug: finalSlug,
          contentType: normalizeContentType(contentType),
          excerpt: excerpt || '',
          content: content || '',
          category: category || '',
          tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          featuredImageUrl: featuredImageUrl || '',
          slidesFolder: slidesFolder || '',
          slidesStyle: slidesStyle === 'grid' ? 'grid' : 'carousel',
          status: status || 'draft',
          publishedAt: status === 'published' && !current?.publishedAt ? now : current?.publishedAt || null,
          updatedAt: now,
        },
      }
    );
    res.redirect('/admin/blog?msg=updated');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/blog?err=1');
  }
});

// Quick publish
router.post('/:id/publish', async (req, res) => {
  try {
    const db = req.db;
    const now = new Date();
    await db.collection('blog').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'published', publishedAt: now, updatedAt: now } }
    );
    res.redirect('/admin/blog?msg=published');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/blog?err=1');
  }
});

// Delete
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('blog').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/blog?msg=deleted');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/blog?err=1');
  }
});

export default router;
