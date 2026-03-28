import express from 'express';
import { getDb } from '../../plugins/mongo.js';
import { ObjectId } from 'mongodb';
import { config } from '../../config/config.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { webSearch, callLLM, tryParseAgentResponse } from '../../plugins/agentMcp.js';

const router = express.Router();

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// List
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const posts = await db.collection('blog').find({}).sort({ createdAt: -1 }).toArray();
    res.render('admin/blog/index', {
      user: req.adminUser, page: 'blog', title: 'Blog Posts', posts,
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
    existingTags, existingCategories,
  });
});

// Create
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { title, slug, excerpt, content, category, tags, status, featuredImageUrl } = req.body;
    const finalSlug = slug ? toSlug(slug) : toSlug(title);
    const existing = await db.collection('blog').findOne({ slug: finalSlug });
    if (existing) {
      return res.render('admin/blog/form', {
        user: req.adminUser, page: 'blog', title: 'New Post', post: req.body,
        error: 'A post with that slug already exists. Choose a different title or slug.',
      });
    }
    const now = new Date();
    await db.collection('blog').insertOne({
      title,
      slug: finalSlug,
      excerpt: excerpt || '',
      content: content || '',
      category: category || '',
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      featuredImageUrl: featuredImageUrl || '',
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
    res.render('admin/blog/form', {
      user: req.adminUser, page: 'blog', title: 'Edit Post', post, error: null,
      existingTags, existingCategories,
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

Your ONLY job is to output a JSON object. No prose before or after it. No markdown code fences. Just the raw JSON.

The JSON must have exactly this shape:
{
  "message": "one short sentence describing what you wrote",
  "fill": {
    "title": "the post title",
    "excerpt": "1-2 sentence plain text summary",
    "content": "full HTML content as a single escaped string",
    "category": "one category",
    "tags": "tag1, tag2, tag3"
  }
}

Rules for the content field:
- Write 400-800 words of HTML using <h2>, <p>, <strong>, <ul>, <li> tags
- All double quotes inside the HTML must be escaped as \\"
- No literal newlines inside the JSON string — use \\n instead
- End with a soft call-to-action mentioning the business by name

Tailor content to the business and audience described above.
Tone: practical, approachable, not corporate.
${postCtx}${researchCtx}`;

    const raw = await callLLM(messages, systemPrompt);
    const parsed = tryParseAgentResponse(raw);
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
    const { title, slug, excerpt, content, category, tags, status, featuredImageUrl } = req.body;
    const finalSlug = slug ? toSlug(slug) : toSlug(title);
    const existing = await db.collection('blog').findOne({
      slug: finalSlug,
      _id: { $ne: new ObjectId(req.params.id) },
    });
    if (existing) {
      return res.render('admin/blog/form', {
        user: req.adminUser, page: 'blog', title: 'Edit Post',
        post: { ...req.body, _id: req.params.id },
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
          excerpt: excerpt || '',
          content: content || '',
          category: category || '',
          tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          featuredImageUrl: featuredImageUrl || '',
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
