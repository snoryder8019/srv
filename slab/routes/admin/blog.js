import express from 'express';
import { getDb } from '../../plugins/mongo.js';
import { ObjectId } from 'mongodb';
import { config } from '../../config/config.js';
import { buildBrandContext } from '../../plugins/brandContext.js';

const OLLAMA_KEY = config.OLLAMA_KEY;
const OLLAMA_URL = config.OLLAMA_URL;

async function webSearch(query) {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&text_decorations=false`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': config.SEARCH_API_KEY,
      },
    });
    if (!res.ok) return 'Search unavailable.';
    const data = await res.json();
    const results = (data.web?.results || []).map(r => `${r.title}\n${r.description || ''}\n${r.url}`);
    return results.length ? results.join('\n\n') : 'No results found.';
  } catch (e) {
    return 'Search failed: ' + e.message;
  }
}

async function fetchUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    return text || 'Page fetched but no readable content found.';
  } catch (e) {
    return 'Fetch failed: ' + e.message;
  }
}

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

    const brandCtx = buildBrandContext(req.tenant?.brand || {});

    // Two-pass approach: first generate content freely, then we wrap it
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

    const llmRes = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({
        model: 'qwen2.5:7b',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        stream: false,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error('LLM error:', errText);
      return res.status(502).json({ error: 'LLM request failed' });
    }

    const data = await llmRes.json();
    const raw = data.choices?.[0]?.message?.content || '';
    console.log('[blog-agent] raw LLM response length:', raw.length);

    let parsed = tryParseAgentResponse(raw);
    console.log('[blog-agent] fill keys:', Object.keys(parsed.fill || {}));

    res.json(parsed);
  } catch (err) {
    console.error('Blog agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

function tryParseAgentResponse(raw) {
  // Strip markdown fences
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Attempt 1: standard JSON.parse on the outermost {...}
  try {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (p.fill && typeof p.fill === 'object') return p;
    }
  } catch { /* fall through */ }

  // Attempt 2: the model may have emitted literal newlines inside JSON strings —
  // collapse them inside string values only, then retry
  try {
    // Replace newlines that appear between quotes with \n
    const fixed = cleaned.replace(/("(?:[^"\\]|\\.)*")/g, s => s.replace(/\n/g, '\\n').replace(/\r/g, ''));
    const m = fixed.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (p.fill && typeof p.fill === 'object') return p;
    }
  } catch { /* fall through */ }

  // Attempt 3: pull individual fields out with regex if JSON is too broken
  const fill = {};
  const fieldRe = {
    title:    /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    excerpt:  /"excerpt"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    category: /"category"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    tags:     /"tags"\s*:\s*"((?:[^"\\]|\\.)*)"/,
    // content is large — grab everything between "content": " ... " (greedy)
    content:  /"content"\s*:\s*"([\s\S]*?)(?<!\\)"\s*[,}]/,
  };
  for (const [key, re] of Object.entries(fieldRe)) {
    const m = cleaned.match(re);
    if (m) fill[key] = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  const msgMatch = cleaned.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const message = msgMatch ? msgMatch[1] : (Object.keys(fill).length ? 'Fields filled.' : cleaned.slice(0, 200));

  return { message, fill };
}

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
