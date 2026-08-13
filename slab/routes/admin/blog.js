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
  salvageBlogPost,
  isBlogFillComplete,
  generateSdImage,
  buildBrandedSdPrompt,
  recordTrainingCandidate,
} from '../../plugins/agentMcp.js';
import { s3Client, BUCKET, bucketUrl } from '../../plugins/s3.js';
import { autoSlotDrafts, schedulePost, unschedulePost, suggestBlogSlots } from '../../plugins/blogSchedule.js';

const router = express.Router();

// Resolve the publish-date fields a form (or the calendar) may post. Returns
// { status, scheduledAt, publishedAt } so create + update share ONE rule about
// what a status means, instead of each computing dates its own way:
//   published → live now, publishedAt stamped (kept if already set)
//   scheduled → needs a future scheduledAt; the blog publisher flips it live
//   draft     → no dates
function resolveSchedule(body, { now = new Date(), current = null } = {}) {
  let status = body.status || 'draft';
  let scheduledAt = null;
  let publishedAt = current?.publishedAt || null;

  if (status === 'scheduled') {
    const d = body.scheduledDate;
    const t = body.scheduledTime || '09:00';
    const when = d ? new Date(`${d}T${t}:00`) : null;
    if (!when || Number.isNaN(when.getTime())) {
      // A "schedule" with no date is really a draft — don't strand it as an
      // orphaned scheduled row the publisher can never fire.
      status = 'draft';
    } else if (when <= now) {
      // A past "schedule" is a publish-now — the publisher would fire it on its
      // next tick anyway, so skip the limbo and go straight live.
      status = 'published';
      publishedAt = publishedAt || when;
    } else {
      scheduledAt = when;
    }
  } else if (status === 'published') {
    publishedAt = publishedAt || now;
  }
  return { status, scheduledAt, publishedAt };
}

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

// A schedule action fired FROM the calendar (the chip's ⋯ menu posts view/date/
// src) should land back on the calendar, not the blog list. When those fields
// are absent it's a normal blog-surface action → back to the blog list.
function scheduleReturn(req, msg) {
  const { view, date, src, project, client } = req.body || {};
  if (view || date) {
    const q = new URLSearchParams();
    if (view) q.set('view', view);
    if (date) q.set('date', date);
    if (src) q.set('src', src);
    if (project) q.set('project', project);
    if (client) q.set('client', client);
    if (msg) q.set('success', msg);
    return '/admin/calendar?' + q.toString();
  }
  return '/admin/blog?msg=' + encodeURIComponent(msg || 'updated');
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
    const sched = resolveSchedule(req.body, { now });
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
      status: sched.status,
      scheduledAt: sched.scheduledAt,
      publishedAt: sched.publishedAt,
      createdAt: now,
      updatedAt: now,
    });
    res.redirect('/admin/blog?msg=' + (sched.status === 'scheduled' ? 'scheduled' : 'created'));
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

// ── Blog Agent — definitive requests get definitive outcomes ─────────────────
// "Write a blog post about X" is not a conversation opener: the outcome the user
// asked for is FIELDS IN THE FORM. Three things used to break that:
//   1. DRIFT — every prior assistant turn was replayed as its one-line summary,
//      so after a couple of exchanges the model had few-shot taught itself that
//      assistant replies are short prose, and it stopped emitting the envelope.
//   2. NO ENFORCEMENT — a prose reply parses to an empty fill; the panel then
//      said something friendly and filled nothing, with no error anywhere.
//   3. BLIND EDITS — the existing post BODY was never sent, so "tighten the
//      intro" rewrote from nothing.
// Fixed below with: history sanitation, a required-fields contract with one
// repair pass + salvage, and current-body context.

const WRITE_VERB_RE = /\b(write|draft|create|generate|compose|produce|rewrite|re-?do|make me|give me|do)\b/i;
const QUESTION_RE = /\?\s*$/;

/** Does this message demand a complete post in the form (title + body)? */
function wantsFullPost(text, currentPost) {
  const t = String(text || '').trim();
  if (t.length < 3) return false;
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|cool|nice|great)\b[\s!.?]*$/i.test(t)) return false;
  if (WRITE_VERB_RE.test(t)) return true;
  // A bare topic typed into an empty editor is a write request, not small talk.
  return !String(currentPost?.content || '').trim() && !QUESTION_RE.test(t);
}

/** "write a blog post about winter roof care" → "winter roof care" */
function topicFromRequest(text) {
  return String(text || '')
    .replace(/^\s*(?:please\s+)?(?:can you\s+|could you\s+|i want you to\s+|i need you to\s+)?/i, '')
    .replace(/^(?:write|draft|create|generate|compose|produce|make|do)\s+(?:me\s+)?(?:a|an|the)?\s*(?:new\s+)?(?:blog\s+)?(?:post|article|piece|newsletter|snippet|entry)?\s*(?:about|on|covering|re:?)?\s*/i, '')
    .replace(/["'`]/g, '')
    .trim()
    .slice(0, 200) || String(text || '').trim().slice(0, 200);
}

// The model is fed the user's side of the conversation plus the LIVE form state.
// Prior assistant turns are deliberately dropped: their stored form is a one-line
// summary, and replaying prose is exactly what taught the model to answer in
// prose. The form state below carries everything those turns would have.
function userTurns(messages, limit = 4) {
  return messages
    .filter((m) => m && m.role === 'user' && String(m.content || '').trim())
    .slice(-limit)
    .map((m) => ({ role: 'user', content: String(m.content).slice(0, 4000) }));
}

router.post('/agent', async (req, res) => {
  const { messages, currentPost } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  try {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const needPost = wantsFullPost(lastUserMsg, currentPost);
    const topic = topicFromRequest(lastUserMsg);
    const searchResults = await webSearch(lastUserMsg.slice(0, 200));

    // Existing draft state — including the BODY, so edit requests ("tighten the
    // intro", "add a section on pricing") work against the real text. Capped:
    // the house model runs a 4096-token context.
    const existingBody = String(currentPost?.content || '').trim();
    const postCtx = (currentPost?.title || existingBody)
      ? `\n\n--- CURRENT DRAFT IN THE EDITOR (what the user is looking at) ---\n` +
        `title: "${currentPost?.title || ''}"\ncategory: "${currentPost?.category || ''}"\ntags: "${currentPost?.tags || ''}"\n` +
        (existingBody
          ? `body:\n${existingBody.slice(0, 2400)}${existingBody.length > 2400 ? '\n…[truncated]' : ''}\n`
          : 'body: (empty)\n') +
        `--- END CURRENT DRAFT ---\nWhen the user asks for a change, REWRITE this draft and return the full updated post — never a description of the change.`
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
${needPost ? `
NON-NEGOTIABLE FOR THIS TURN: the user asked you to WRITE. You are filling a form, not chatting. Return the JSON line AND a full <CONTENT> block. Do NOT reply conversationally, do NOT ask a clarifying question, do NOT offer options, do NOT say what you are about to write — just write it. If a detail is missing, make a sensible choice for this business and note it in "message".
` : ''}${postCtx}${researchCtx}`;

    // Repair prompt — used only when the first pass drifted out of the envelope.
    // Deliberately stripped of research/history noise: one job, one shape.
    const repairPrompt = `You output ONLY a blog post in this exact two-part shape. No preamble, no explanation, no questions.
{"message":"one short sentence","fill":{"title":"…","excerpt":"…","category":"…","tags":"tag, tag, tag"}}
<CONTENT>
<h2>…</h2><p>…</p><ul><li>…</li></ul><p>closing paragraph with a soft call to action</p>
</CONTENT>

The JSON is ONE line, plain double quotes, and NEVER contains "content". The <CONTENT> block holds 400-800 words of raw HTML using only <h2>, <h3>, <p>, <strong>, <em>, <ul>, <li>.
${brandCtx}`;

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
    const convo = userTurns(messages);
    const [raw, image] = await Promise.all([
      callLLM(convo.length ? convo : [{ role: 'user', content: lastUserMsg }], systemPrompt, 90000, llmOpts),
      imagePromise,
    ]);

    let parsed = tryParseAgentResponse(raw);
    let repaired = false;

    // ── Contract enforcement ──
    // A write request that came back without title+content is a FAILURE, not a
    // chat reply. Retry once against the stripped repair prompt (a fresh, single
    // instruction beats arguing with a drifted context), keeping any good fields
    // from pass 1, then salvage a body out of whatever prose we got.
    if (needPost && !isBlogFillComplete(parsed.fill)) {
      console.warn('[blog-agent] pass 1 missed the envelope — repairing. topic:', topic.slice(0, 80), 'raw len:', raw.length);
      try {
        const retryRaw = await callLLM(
          [{ role: 'user', content: `Write the blog post now. Topic: ${topic}` }],
          repairPrompt, 90000, llmOpts,
        );
        const retry = tryParseAgentResponse(retryRaw);
        // Merge: pass 2 fills the gaps, pass 1 keeps whatever it got right.
        const merged = { ...(retry.fill || {}), ...(parsed.fill || {}) };
        for (const [k, v] of Object.entries(retry.fill || {})) {
          if (!String(merged[k] || '').trim()) merged[k] = v;
        }
        parsed = salvageBlogPost(
          { message: parsed.message || retry.message, fill: merged },
          { topic, raw: retryRaw + '\n' + raw },
        );
        repaired = true;
      } catch (e) {
        console.warn('[blog-agent] repair pass failed:', e.message);
        parsed = salvageBlogPost(parsed, { topic, raw });
        repaired = true;
      }
    }

    if (image?.url) {
      parsed.fill = parsed.fill || {};
      parsed.fill.featuredImageUrl = image.url;
    }

    // Tell the panel the truth about what happened, so it can hold a hard line
    // instead of rendering a friendly sentence over an empty form.
    const complete = isBlogFillComplete(parsed.fill);
    if (needPost && !complete) {
      console.error('[blog-agent] WRITE REQUEST PRODUCED NO POST — topic:', topic.slice(0, 120));
    }
    res.json({
      ...parsed,
      required: needPost,
      complete,
      // The salvage/repair path produced a draft the model didn't hand over cleanly.
      degraded: needPost && complete && (repaired || parsed.recovered === true),
      failed: needPost && !complete,
    });
  } catch (err) {
    console.error('Blog agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-slot: drop drafts onto the calendar at the next open reading hours ──
// Mirrors social's ⚡ Auto-slot. `ids` (comma-separated) slots just those posts;
// omit it to sweep the oldest drafts. Returns JSON for the async button, or
// redirects for a plain form post.
router.post('/auto-slot', async (req, res) => {
  try {
    const ids = req.body.ids
      ? String(req.body.ids).split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    const perDay = Math.max(1, parseInt(req.body.perDay, 10) || 1);
    const spacingDays = Math.max(1, parseInt(req.body.spacingDays, 10) || 1);
    const out = await autoSlotDrafts(req.db, { ids, perDay, spacingDays, limit: 20 });
    if (req.accepts(['json', 'html']) === 'json' || req.xhr) {
      return res.json({ ok: true, ...out });
    }
    res.redirect('/admin/blog?msg=' + encodeURIComponent(`Scheduled ${out.scheduled.length} post(s)`));
  } catch (err) {
    console.error('[blog] auto-slot error:', err);
    if (req.xhr) return res.status(500).json({ ok: false, error: err.message });
    res.redirect('/admin/blog?err=1');
  }
});

// Suggest the next N open slots without committing — for a "when would this go
// out?" preview in the UI.
router.get('/next-slots', async (req, res) => {
  try {
    const n = Math.max(1, Math.min(parseInt(req.query.n, 10) || 3, 20));
    const slots = await suggestBlogSlots(req.db, n, {
      perDay: Math.max(1, parseInt(req.query.perDay, 10) || 1),
      spacingDays: Math.max(1, parseInt(req.query.spacingDays, 10) || 1),
    });
    res.json({ ok: true, slots: slots.map((d) => d.toISOString()) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
    const sched = resolveSchedule(req.body, { now, current });
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
          status: sched.status,
          scheduledAt: sched.scheduledAt,
          publishedAt: sched.publishedAt,
          updatedAt: now,
        },
      }
    );
    res.redirect('/admin/blog?msg=' + (sched.status === 'scheduled' ? 'scheduled' : 'updated'));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/blog?err=1');
  }
});

// Schedule / move one post to an explicit date+time.
router.post('/:id/schedule', async (req, res) => {
  try {
    const { date, time } = req.body;
    if (!date) throw Object.assign(new Error('A date is required'), { status: 400 });
    const when = await schedulePost(req.db, req.params.id, new Date(`${date}T${time || '09:00'}:00`));
    if (req.xhr) return res.json({ ok: true, scheduledAt: when.toISOString() });
    res.redirect(scheduleReturn(req, 'Scheduled'));
  } catch (err) {
    console.error('[blog] schedule error:', err);
    if (req.xhr) return res.status(err.status || 500).json({ ok: false, error: err.message });
    res.redirect('/admin/blog?err=1');
  }
});

// Pull a post back off the calendar, to draft.
router.post('/:id/unschedule', async (req, res) => {
  try {
    await unschedulePost(req.db, req.params.id);
    if (req.xhr) return res.json({ ok: true });
    res.redirect(scheduleReturn(req, 'Unscheduled'));
  } catch (err) {
    console.error('[blog] unschedule error:', err);
    if (req.xhr) return res.status(500).json({ ok: false, error: err.message });
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
