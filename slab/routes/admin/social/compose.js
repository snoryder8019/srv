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
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng, sliceSeamlessForPublish } from '../../../plugins/autoSocial.js';
import { uploadBuffer } from '../../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../../plugins/socialDesign.js';
import { suggestSlots, staggerByPlatform, newGroupId } from '../../../plugins/socialSchedule.js';
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
    // Reels only. DRAFT hands the reel to Facebook unpublished so a human can add
    // licensed music in the app — Meta's catalogue has no API. Ignored elsewhere.
    const fbVideoState = (format === 'reel' && req.body.fbVideoState === 'DRAFT') ? 'DRAFT' : 'PUBLISHED';
    let mediaUrls = parseMedia(media, format === 'single' ? 4 : 10);
    // Carousel/story only go to platforms that support the format — no coercing
    // the rest into a degraded single post.
    let platforms = parsePlatforms(req.body.platforms);
    if (format !== 'single') platforms = platforms.filter(p => platformSupportsFormat(p, format));

    const editId = (req.body.editId || '').trim();

    // Load the post being edited up front — "Save Changes" needs its current
    // status to avoid silently un-publishing or un-scheduling it, and the carousel
    // guard below needs to know whether this is a seamless (panorama) carousel.
    let existing = null;
    if (editId) {
      try { existing = await db.collection('social_posts').findOne({ _id: new ObjectId(editId) }); } catch { /* invalid id → handled below */ }
    }

    if (!body && !mediaUrls.length) return res.redirect('/admin/social?tab=compose&error=Write+something+to+post');
    // A seamless carousel legitimately carries a single wide panorama preview in
    // mediaUrls; it's sliced into real tiles at schedule/publish time (below), so
    // don't reject it here for being "under 2 images".
    if (format === 'carousel' && mediaUrls.length < 2 && !existing?.seamless) return res.redirect('/admin/social?tab=compose&error=A+carousel+needs+at+least+2+images');
    if (format === 'story' && !mediaUrls.length) return res.redirect('/admin/social?tab=compose&error=A+story+needs+at+least+one+image+or+video');
    // A reel is one video — catching it here beats a Meta error three phases in.
    if (format === 'reel' && !mediaUrls.length) return res.redirect('/admin/social?tab=compose&error=' + encodeURIComponent('A reel needs a video — attach one first'));
    if (!platforms.length) return res.redirect(`/admin/social?tab=compose&error=${encodeURIComponent(format === 'single' ? 'Pick at least one platform' : `No selected platform supports ${format} posts`)}`);

    // The datetime field is the schedule. Parse it once; a value that's a valid
    // future time means "this post is scheduled" regardless of which save button
    // was pressed. This is the fix for edited posts vanishing from the calendar:
    // "Save Changes" used to hard-reset status→draft / scheduledAt→null, which
    // unscheduled the post and threw away any new time the user had just typed.
    const wantAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
    const hasFutureSlot = !!(wantAt && !isNaN(wantAt) && wantAt.getTime() >= Date.now() - 60000);

    let scheduledAt = null;
    let status = 'draft';
    if (action === 'schedule') {
      if (!hasFutureSlot) {
        return res.redirect('/admin/social?tab=compose&error=Pick+a+future+date+%26+time');
      }
      scheduledAt = wantAt;
      status = 'scheduled';
    } else if (action === 'autoslot') {
      // Auto-slot builds a cadence: ONE post per selected network, each on its own
      // DAY (maxPerDay:1) so the brand keeps a steady daily presence instead of
      // firing every network at once. Works the same whether composing a new post
      // or auto-slotting an existing draft. A single network → one slot.
      const slots = await suggestSlots(db, Math.max(1, platforms.length), { maxPerDay: 1 });
      if (!slots.length) return res.redirect('/admin/social?tab=compose&error=No+open+calendar+slot+found');
      if (platforms.length > 1) {
        // A seamless carousel carries one wide preview → slice it once so every
        // network doc schedules the real tiles. Best-effort; falls through on error.
        let distMedia = mediaUrls;
        if (existing?.seamless && !existing.seamlessMaterialized) {
          try {
            const tiles = await sliceSeamlessForPublish(req.tenant, db, existing);
            if (tiles.length >= 2) {
              distMedia = tiles;
              await db.collection('social_posts').updateOne(
                { _id: existing._id },
                { $set: { seamlessMaterialized: true, previewUrl: existing.previewUrl || existing.mediaUrls?.[0] || null } },
              );
            }
          } catch (e) { console.error('[social] seamless slice failed:', e.message); }
        }
        // One groupId spans the whole run so the Calendar reads the spread as a
        // single staggered post (not N duplicate chips).
        const groupId = newGroupId();
        const base = {
          body: (body || '').trim(), link: (link || '').trim(), mediaUrls: distMedia, format, fbVideoState,
          publishedAt: null, results: [], suggestion: false,
          createdBy: req.adminUser?.email || existing?.createdBy || null,
          createdAt: existing?.createdAt || new Date(), updatedAt: new Date(),
        };
        if (editId && existing) {
          // Reuse the edited doc as the first network; clone the rest onto later days.
          await db.collection('social_posts').updateOne(
            { _id: existing._id },
            { $set: { ...base, platforms: [platforms[0]], status: 'scheduled', scheduledAt: slots[0], groupId } },
          );
          const extra = staggerByPlatform(base, platforms.slice(1), slots.slice(1), { groupId });
          if (extra.length) await db.collection('social_posts').insertMany(extra);
        } else {
          const docs = staggerByPlatform(base, platforms, slots, { groupId });
          await db.collection('social_posts').insertMany(docs);
        }
        return res.redirect(`/admin/social?tab=calendar&success=${encodeURIComponent(`Scheduled ${platforms.length} posts — one per network across ${platforms.length} days`)}`);
      }
      scheduledAt = slots[0];
      status = 'scheduled';
    } else if (action === 'publish') {
      status = 'publishing';
    } else {
      // 'draft' / "Save Changes" — honor the schedule field instead of wiping it.
      //  • a future time in the field  → keep (or make) the post scheduled at it
      //  • field empty, editing a live post → leave it published (just save edits)
      //  • otherwise                    → a plain draft
      if (hasFutureSlot) {
        scheduledAt = wantAt;
        status = 'scheduled';
      } else if (existing && existing.status === 'published') {
        status = 'published';
      } else {
        status = 'draft';
      }
    }

    // Seamless carousel → slice the panorama into real tiles the moment it leaves
    // the draft state, so the scheduler/publisher posts a true multi-image carousel
    // (mirrors the review-queue auto-slot path). Draft-saves keep the single preview
    // so the panorama stays re-editable. Never throws — on failure it falls through
    // with whatever mediaUrls it had rather than blocking the save.
    if (existing?.seamless && !existing.seamlessMaterialized && (status === 'scheduled' || status === 'publishing')) {
      try {
        const tiles = await sliceSeamlessForPublish(req.tenant, db, existing);
        if (tiles.length >= 2) {
          mediaUrls = tiles;
          await db.collection('social_posts').updateOne(
            { _id: existing._id },
            { $set: { seamlessMaterialized: true, previewUrl: existing.previewUrl || existing.mediaUrls?.[0] || null } },
          );
        }
      } catch (e) { console.error('[social] seamless slice failed:', e.message); }
    }

    // Edit mode: update the existing post in place instead of inserting a new one.
    let postId, doc;
    if (editId) {
      const _id = new ObjectId(editId);
      const set = {
        body: (body || '').trim(), link: (link || '').trim(),
        mediaUrls, platforms, format, fbVideoState, status, scheduledAt, updatedAt: new Date(),
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
        fbVideoState,
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

    // Land on the tab that matches what the post actually became, with an honest
    // message — a rescheduled edit goes to the calendar, a saved live post says so.
    let where = 'compose', msg = 'Draft saved';
    if (status === 'scheduled') { where = 'scheduled'; msg = editId ? 'Schedule updated' : 'Post scheduled'; }
    else if (status === 'published') { where = 'scheduled'; msg = 'Changes saved'; }
    res.redirect(`/admin/social?tab=${where}&success=${encodeURIComponent(msg)}`);
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
