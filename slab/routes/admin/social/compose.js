import express from 'express';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';
import { config } from '../../../config/config.js';
import { callLLM, tryParseAgentResponse, hasCJK, stripCJK } from '../../../plugins/agentMcp.js';
import { agentLLMOpts } from '../../../plugins/agentRegistry.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { logActivity } from '../../../plugins/activityLog.js';
import {
  PLATFORMS, PLATFORM_LIST, LIVE_PLATFORMS,
  packCredentials, unpackCredentials, maskAccount, isAccountConfigured,
  publishToPlatform, publishPost, verifyPlatform, discoverInstagramFromPage,
  platformSupportsFormat,
} from '../../../plugins/socialPublish.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { fetchEngagement, postReply, allEngageCaps, engageCaps } from '../../../plugins/socialEngage.js';
import { encrypt, decrypt } from '../../../plugins/crypto.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng } from '../../../plugins/autoSocial.js';
import { uploadBuffer } from '../../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../../plugins/socialDesign.js';
import { suggestSlots, staggerByPlatform } from '../../../plugins/socialSchedule.js';
import { fetchAllFollows, followsAction } from '../../../plugins/socialFollows.js';
import {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseFormat, parseMedia, publishPostBackground, loadAccountMap,
} from './shared.js';

const router = express.Router();

// ── AI compose helper — drafts platform-aware copy ────────────────────────────
router.post('/agent', express.json(), async (req, res) => {
  try {
    const { prompt, platforms } = req.body;
    const brandCtx = await loadBrandContext(req.tenant, req.db);
    const targets = parsePlatforms(platforms);
    const tnames = targets.map(t => PLATFORMS[t].name).join(', ') || 'general social media';

    const systemPrompt = `You write engaging social media posts.

${brandCtx}

Target platform(s): ${tnames}.

Output ONLY a raw JSON object (no prose, no code fences) of this exact shape:
{
  "message": "one short sentence describing the post you wrote",
  "fill": {
    "body": "the post text — punchy, on-brand, with relevant emoji and 2-4 hashtags",
    "link": "a URL to include, or empty string"
  }
}

Rules:
- Keep it under 280 characters so it fits every platform (including X).
- Match the brand voice above. No markdown. Escape double quotes as \\".
The admin's brief: "${(prompt || 'an engaging update about the business').slice(0, 400)}"`;

    const raw = await callLLM([{ role: 'user', content: prompt || 'Write a social post.' }], systemPrompt, 90000, await agentLLMOpts(req.db, req.tenant, 'social'));
    res.json(tryParseAgentResponse(raw));
  } catch (err) {
    console.error('[social] agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Create a post (draft / schedule / publish now) ────────────────────────────
router.post('/posts', async (req, res) => {
  const db = req.db;
  try {
    const { body, link, media, action } = req.body;
    const format = parseFormat(req.body.format);
    const mediaUrls = parseMedia(media, format === 'single' ? 4 : 10);
    // Carousel/story only go to platforms that support the format — no coercing
    // the rest into a degraded single post.
    let platforms = parsePlatforms(req.body.platforms);
    if (format !== 'single') platforms = platforms.filter(p => platformSupportsFormat(p, format));

    if (!body && !mediaUrls.length) return res.redirect('/admin/social?tab=compose&error=Write+something+to+post');
    if (format === 'carousel' && mediaUrls.length < 2) return res.redirect('/admin/social?tab=compose&error=A+carousel+needs+at+least+2+images');
    if (format === 'story' && !mediaUrls.length) return res.redirect('/admin/social?tab=compose&error=A+story+needs+at+least+one+image+or+video');
    if (!platforms.length) return res.redirect(`/admin/social?tab=compose&error=${encodeURIComponent(format === 'single' ? 'Pick at least one platform' : `No selected platform supports ${format} posts`)}`);

    const editId = (req.body.editId || '').trim();

    let scheduledAt = null;
    let status = 'draft';
    if (action === 'schedule') {
      scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
      if (!scheduledAt || isNaN(scheduledAt) || scheduledAt.getTime() < Date.now() - 60000) {
        return res.redirect('/admin/social?tab=compose&error=Pick+a+future+date+%26+time');
      }
      status = 'scheduled';
    } else if (action === 'autoslot') {
      // Auto-slot picks well-spaced calendar times. A brand-new multi-platform
      // post is STAGGERED — one scheduled post per network, each at its own slot
      // — so the networks don't all fire at the same single time. Editing an
      // existing post keeps the single-doc behavior (one slot).
      const slots = await suggestSlots(db, Math.max(1, platforms.length));
      if (!slots.length) return res.redirect('/admin/social?tab=compose&error=No+open+calendar+slot+found');
      if (!editId && platforms.length > 1) {
        const base = {
          body: (body || '').trim(), link: (link || '').trim(), mediaUrls, format,
          publishedAt: null, results: [], suggestion: false,
          createdBy: req.adminUser?.email || null, createdAt: new Date(), updatedAt: new Date(),
        };
        const docs = staggerByPlatform(base, platforms, slots);
        await db.collection('social_posts').insertMany(docs);
        return res.redirect(`/admin/social?tab=calendar&success=${encodeURIComponent(`Scheduled ${docs.length} posts, staggered across the calendar`)}`);
      }
      scheduledAt = slots[0];
      status = 'scheduled';
    } else if (action === 'publish') {
      status = 'publishing';
    }

    // Edit mode: update the existing post in place instead of inserting a new one.
    let postId, doc;
    if (editId) {
      const _id = new ObjectId(editId);
      const set = {
        body: (body || '').trim(), link: (link || '').trim(),
        mediaUrls, platforms, format, status, scheduledAt, updatedAt: new Date(),
      };
      // Republishing an edited post clears the old results so stale failures don't linger.
      if (action === 'publish') set.results = [];
      await db.collection('social_posts').updateOne({ _id }, { $set: set });
      postId = _id;
      doc = { _id, ...set };
    } else {
      doc = {
        body: (body || '').trim(),
        link: (link || '').trim(),
        mediaUrls,
        platforms,
        format,
        status,
        scheduledAt,
        publishedAt: null,
        results: [],
        createdBy: req.adminUser?.email || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const ins = await db.collection('social_posts').insertOne(doc);
      postId = ins.insertedId;
    }

    if (action === 'publish') {
      const accountMap = await loadAccountMap(db);
      // Fire-and-forget: publishing (esp. video) can outlast the proxy timeout.
      publishPostBackground(db, postId, doc, accountMap, {
        tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id,
        actorEmail: req.adminUser?.email, ip: req.ip,
      });
      const hasVideo = mediaUrls.some(u => /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i.test(u));
      const msg = hasVideo
        ? 'Publishing… video can take a minute or two to process. Refresh to see status.'
        : 'Publishing… refresh in a moment to see the result.';
      return res.redirect(`/admin/social?tab=scheduled&success=${encodeURIComponent(msg)}`);
    }

    const where = status === 'scheduled' ? 'scheduled' : 'compose';
    res.redirect(`/admin/social?tab=${where}&success=${encodeURIComponent(status === 'scheduled' ? 'Post scheduled' : 'Draft saved')}`);
  } catch (err) {
    console.error('[social] create post error:', err);
    res.redirect('/admin/social?tab=compose&error=' + encodeURIComponent(err.message || 'Failed'));
  }
});

// ── Upload composer media (image or video) → S3, returns a public URL ─────────
router.post('/upload', mediaUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file (must be an image or mp4/mov/webm video under 200MB)' });
    const isVideo = /^video\//i.test(req.file.mimetype);
    const up = await uploadBuffer(req.file.buffer, {
      prefix: req.tenant?.s3Prefix,
      folder: 'social',
      name: req.file.originalname,
      contentType: req.file.mimetype,
    });
    res.json({ ok: true, url: up.url, type: isVideo ? 'video' : 'image' });
  } catch (err) {
    console.error('[social] media upload error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Upload failed' });
  }
});

// ── Publish an existing draft/scheduled post immediately ──────────────────────
router.post('/posts/:id/publish', async (req, res) => {
  const db = req.db;
  try {
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.redirect('/admin/social?tab=scheduled&error=Post+not+found');

    const accountMap = await loadAccountMap(db);
    await db.collection('social_posts').updateOne(
      { _id: post._id },
      { $set: { status: 'publishing', updatedAt: new Date() } },
    );
    // Fire-and-forget so video publishes don't outlast the proxy timeout.
    publishPostBackground(db, post._id, post, accountMap, {
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id,
      actorEmail: req.adminUser?.email, ip: req.ip,
    });
    const hasVideo = (post.mediaUrls || []).some(u => /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i.test(u));
    const msg = hasVideo
      ? 'Publishing… video can take a minute or two to process. Refresh to see status.'
      : 'Publishing… refresh in a moment to see the result.';
    res.redirect(`/admin/social?tab=scheduled&success=${encodeURIComponent(msg)}`);
  } catch (err) {
    console.error('[social] publish post error:', err);
    res.redirect('/admin/social?tab=scheduled&error=' + encodeURIComponent(err.message || 'Failed'));
  }
});

// ── Archive a post (soft-delete) ──────────────────────────────────────────────
// The "Delete" button archives rather than destroys: the post is flagged and
// hidden from the default list but kept for the record. Hard delete lives behind
// the archived view (/posts/:id/destroy).
router.post('/posts/:id/delete', async (req, res) => {
  const db = req.db;
  await db.collection('social_posts').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { archived: true, archivedAt: new Date(), updatedAt: new Date() } },
  );
  res.redirect('/admin/social?tab=scheduled&success=Post+archived');
});

// ── Restore an archived post ──────────────────────────────────────────────────
router.post('/posts/:id/unarchive', async (req, res) => {
  const db = req.db;
  await db.collection('social_posts').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { archived: false, updatedAt: new Date() }, $unset: { archivedAt: '' } },
  );
  res.redirect('/admin/social?tab=scheduled&view=archived&success=Post+restored');
});

// ── Permanently delete a post (only from the archived view) ───────────────────
router.post('/posts/:id/destroy', async (req, res) => {
  const db = req.db;
  await db.collection('social_posts').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/social?tab=scheduled&view=archived&success=Post+permanently+deleted');
});

// ── Export posts (CSV or JSON) ────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  const db = req.db;
  const fmt = req.query.format === 'json' ? 'json' : 'csv';
  const posts = await db.collection('social_posts').find({}).sort({ createdAt: -1 }).toArray();
  const stamp = new Date().toISOString().slice(0, 10);

  if (fmt === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="social-posts-${stamp}.json"`);
    return res.send(JSON.stringify(posts, null, 2));
  }

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const rows = [['status', 'platforms', 'scheduledAt', 'publishedAt', 'body', 'link', 'mediaUrls', 'results'].join(',')];
  for (const p of posts) {
    rows.push([
      esc(p.status), esc((p.platforms || []).join('; ')),
      esc(p.scheduledAt ? new Date(p.scheduledAt).toISOString() : ''),
      esc(p.publishedAt ? new Date(p.publishedAt).toISOString() : ''),
      esc(p.body), esc(p.link), esc((p.mediaUrls || []).join('; ')),
      esc((p.results || []).map(r => `${r.platform}:${r.ok ? 'ok' : 'fail'}`).join('; ')),
    ].join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="social-posts-${stamp}.csv"`);
  res.send(rows.join('\n'));
});



export default router;
