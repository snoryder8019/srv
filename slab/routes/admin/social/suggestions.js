import express from 'express';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';
import { config } from '../../../config/config.js';
import { callLLM, tryParseAgentResponse, hasCJK, stripCJK } from '../../../plugins/agentMcp.js';
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
import { bustTenantCache } from '../../../middleware/tenant.js';
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng, sliceSeamlessForPublish } from '../../../plugins/autoSocial.js';
import { uploadBuffer } from '../../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../../plugins/socialDesign.js';
import { scoreLivePosts, getReliability } from '../../../plugins/socialScore.js';
import { suggestSlots, staggerByPlatform, newGroupId } from '../../../plugins/socialSchedule.js';
import { fetchAllFollows, followsAction } from '../../../plugins/socialFollows.js';
import {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseMedia, publishPostBackground, loadAccountMap,
} from './shared.js';

const router = express.Router();

// Resolve the platforms a review-queue action should target. `requested` comes
// from the card's account chips; we keep only platforms that are actually
// connected AND can carry this post's format (e.g. a story can't cross-post to X).
// Falls back to the post's own platforms when nothing valid was requested.
async function resolveTargetPlatforms(db, post, requested) {
  const connected = new Set(
    (await db.collection('social_accounts').find({}).project({ platform: 1, enabled: 1 }).toArray())
      .filter(a => a.enabled !== false).map(a => a.platform),
  );
  const fmt = post.format || 'single';
  const clean = (arr) => [...new Set((arr || []).map(String))]
    .filter(p => PLATFORMS[p] && !PLATFORMS[p].comingSoon && !PLATFORMS[p].connectOnly)
    .filter(p => connected.has(p) && platformSupportsFormat(p, fmt));
  const picked = clean(Array.isArray(requested) ? requested : []);
  return picked.length ? picked : clean(post.platforms);
}

// A seamless carousel stores a wide PREVIEW in mediaUrls and defers slicing until
// it's actually sent. This cuts the panorama into ordered tiles and swaps them
// into mediaUrls so the normal publish/schedule path posts a real carousel.
// Idempotent (seamlessMaterialized guard) and mutates `post` in place. Never
// throws — on failure it leaves the preview so nothing publishes half-baked.
async function materializeSeamless(req, post) {
  if (!post.seamless || post.seamlessMaterialized) return post.mediaUrls || [];
  try {
    const tiles = await sliceSeamlessForPublish(req.tenant, req.db, post);
    if (tiles.length >= 2) {
      await req.db.collection('social_posts').updateOne(
        { _id: post._id },
        { $set: { mediaUrls: tiles, seamlessMaterialized: true, previewUrl: post.previewUrl || post.mediaUrls?.[0] || null, updatedAt: new Date() } },
      );
      post.mediaUrls = tiles;
    }
  } catch (e) { console.error('[social] seamless slice failed:', e.message); }
  return post.mediaUrls || [];
}

// ── AUTO SOCIAL SUGGESTIONS ───────────────────────────────────────────────────
// A review dashboard: AI drafts on-brand posts (copy + platform-sized image) as
// suggestions; the admin edits layers, approves (publishes), or dismisses. The
// per-tenant cron toggle lives on the registry doc (autoSocial.enabled).

// Dashboard
router.get('/suggestions', async (req, res) => {
  const db = req.db;
  const suggestions = await db.collection('social_posts')
    .find({ auto: true, suggestion: true, status: 'draft' })
    .sort({ createdAt: -1 }).limit(60).toArray();
  res.render('admin/social/suggestions', {
    user: req.adminUser, page: 'social',
    suggestions,
    autoSocial: req.tenant?.autoSocial || { enabled: false, count: 5 },
    platforms: PLATFORM_LIST,
  });
});

// On-demand: generate fresh suggestions now
router.post('/suggestions/generate', express.json(), async (req, res) => {
  try {
    const count = Math.max(1, Math.min(10, parseInt(req.body?.count, 10) || 5));
    const platforms = Array.isArray(req.body?.platforms) && req.body.platforms.length ? req.body.platforms : null;
    const direction = (req.body?.direction || '').toString().slice(0, 300);
    let trends = '';
    // DISABLED FOR RELEASE: Listening trends — trendSummary() unavailable.
    // if (req.body?.useTrends) { try { trends = await trendSummary(req.db, { days: 10, limit: 20 }); } catch {} }
    const out = await generateForTenant(req.tenant, req.db, { count, mode: 'suggest', platforms, direction, trends, createdBy: req.adminUser?.email || 'admin' });
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error('[social] suggestions/generate error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Save edited copy + layers (+ re-rendered image url uploaded client-side)
router.put('/suggestions/:id', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    const { body, design } = req.body || {};
    const $set = { updatedAt: new Date() };
    if (body !== undefined) {
      const newBody = String(body).slice(0, 2000);
      // "Generate then you correct" — an admin edit teaches the voice profile.
      if (newBody.trim() && newBody.trim() !== String(post.body || '').trim()) {
        recordCorrection(db, { before: post.body || '', after: newBody, source: 'suggestion-edit' }).catch(() => {});
      }
      $set.body = newBody;
    }
    let newUrl = null;
    if (design) {
      $set.design = design;
      // Re-composite server-side (fetches the SD bg by url — no browser CORS issues).
      // Batch composites live in S3 + the post only — never the Assets library.
      const png = await renderLayersToPng(design);
      const up = await uploadPng(png, req.tenant?.s3Prefix, 'edit-' + Date.now());
      newUrl = up.url;
      $set.mediaUrls = [up.url];
    }
    await db.collection('social_posts').updateOne({ _id: post._id }, { $set });
    res.json({ ok: true, mediaUrl: newUrl });
  } catch (e) { console.error('[social] suggestion edit error:', e); res.status(500).json({ ok: false, error: e.message }); }
});

// Approve → publish this suggestion to its platform now
router.post('/suggestions/:id/approve', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    // Publish to the accounts chosen on the card (default: the post's own platform).
    const targets = await resolveTargetPlatforms(db, post, req.body?.platforms);
    if (!targets.length) return res.json({ ok: false, error: 'No connected account can post this' });
    await materializeSeamless(req, post);   // seamless carousel → slice the panorama into tiles now
    if (post.seamless && (!post.mediaUrls || post.mediaUrls.length < 2)) return res.json({ ok: false, error: 'Could not slice the carousel — try re-rendering it.' });
    const results = [];
    for (const platform of targets) {
      const account = await db.collection('social_accounts').findOne({ platform });
      const r = await publishWithRetry(platform, { ...post, platforms: [platform] }, account);
      results.push(r);
    }
    const okCount = results.filter(r => r.ok).length;
    const status = okCount === 0 ? 'failed' : okCount === results.length ? 'published' : 'partial';
    const firstOk = results.find(r => r.ok);
    await db.collection('social_posts').updateOne({ _id: post._id },
      { $set: { status, platforms: targets, suggestion: false, results, publishedAt: new Date(), updatedAt: new Date() } });
    logActivity({ category: 'social', action: 'suggestion_approved', tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: okCount ? 'success' : 'failed', actor: { email: req.adminUser?.email, role: 'admin' }, details: { platforms: targets, ok: okCount, total: results.length }, error: okCount ? undefined : results[0]?.error, ip: req.ip });
    res.json({ ok: okCount > 0, status, url: firstOk?.url || null, published: okCount, total: results.length, error: okCount ? null : (results[0]?.error || 'Publish failed') });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Schedule → move a review-queue draft onto the Calendar (the scheduler cron
// publishes it at its time). Leaves the review queue (suggestion: false).
router.post('/suggestions/:id/schedule', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    const when = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
    if (!when || isNaN(when) || when.getTime() < Date.now() - 60000) return res.json({ ok: false, error: 'Pick a future date & time' });
    const targets = await resolveTargetPlatforms(db, post, req.body?.platforms);
    if (!targets.length) return res.json({ ok: false, error: 'No connected account can post this' });
    await materializeSeamless(req, post);   // slice the panorama so the scheduler publishes real tiles
    const $set = { status: 'scheduled', scheduledAt: when, platforms: targets, suggestion: false, updatedAt: new Date() };
    if (typeof req.body?.body === 'string' && req.body.body.trim()) $set.body = req.body.body.slice(0, 2000);
    await db.collection('social_posts').updateOne({ _id: post._id }, { $set });
    res.json({ ok: true, scheduledAt: when, platforms: targets });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Design Memory: 👍/👎 on a generated layout → learned typography/size taste ─
// (the visual counterpart to the Voice Profile; feeds buildLayersSmart).
router.post('/design/feedback', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.body?.postId) });
    if (!post) return res.json({ ok: false, error: 'Post not found' });
    const verdict = req.body?.verdict;
    const sig = await recordDesignFeedback(db, { post, verdict, note: req.body?.note });
    // Curate the SD background pool: 👍 marks this post's background safe to reuse,
    // 👎 blacklists it so the batch generator stops pulling it.
    const bgUrl = post?.design?.sdBgUrl;
    if (bgUrl) {
      await db.collection('social_backgrounds').updateOne(
        { publicUrl: bgUrl }, { $set: { safe: verdict === 'up', safeUpdatedAt: new Date() } },
      ).catch(() => {});
    }
    const prefs = await getDesignPrefs(db);
    res.json({ ok: true, signature: sig, summary: describePrefs(prefs) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Score live posts now (manual) → engagement-based reliability dataset.
router.post('/score/run', async (req, res) => {
  try {
    const r = await scoreLivePosts(req.db, req.tenant, { minAgeDays: Number(req.query.minAge) || 2 });
    const rel = await getReliability(req.db);
    res.json({ ok: true, ...r, reliability: rel });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Current reliability % + winning design signals.
router.get('/score/reliability', async (req, res) => {
  try { res.json({ ok: true, ...(await getReliability(req.db)) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// Review the memory (aggregated prefs + recent thumbed entries) — for pruning.
router.get('/design/memory', async (req, res) => {
  try {
    const db = req.db;
    const [prefs, feedback] = await Promise.all([getDesignPrefs(db), listDesignFeedback(db, 60)]);
    res.json({ ok: true, prefs, summary: describePrefs(prefs), feedback });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Remove a bad memorized layout entry.
router.post('/design/memory/:id/delete', async (req, res) => {
  try { await removeDesignFeedback(req.db, req.params.id); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// Agent auto-slot → pick the next open, well-spaced calendar slot for ONE draft.
router.post('/suggestions/:id/auto-slot', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    const targets = await resolveTargetPlatforms(db, post, req.body?.platforms);
    if (!targets.length) return res.json({ ok: false, error: 'No connected account can post this' });
    // One network per DAY (maxPerDay:1) so a multi-network draft spreads into a
    // steady daily cadence rather than firing every network on the same day.
    const slots = await suggestSlots(db, Math.max(1, targets.length), { maxPerDay: 1 });
    if (!slots.length) return res.json({ ok: false, error: 'No open slot found' });
    await materializeSeamless(req, post);   // slice the panorama before it (and any staggered clones) schedule
    const bodyOverride = (typeof req.body?.body === 'string' && req.body.body.trim()) ? req.body.body.slice(0, 2000) : null;
    // Stagger: the draft's first network keeps this doc at slot[0]; each extra
    // network becomes its own scheduled post at its own slot — networks don't
    // all fire at the same single time.
    // One groupId spans the whole run — this doc AND the clones — so the Calendar
    // reads them as a single staggered post instead of N identical thumbnails.
    const groupId = targets.length > 1 ? newGroupId() : null;
    const $set = { status: 'scheduled', scheduledAt: slots[0], platforms: [targets[0]], suggestion: false, updatedAt: new Date() };
    if (groupId) $set.groupId = groupId;
    if (bodyOverride) $set.body = bodyOverride;
    await db.collection('social_posts').updateOne({ _id: post._id }, { $set });
    if (targets.length > 1) {
      const base = {
        body: bodyOverride != null ? bodyOverride : (post.body || ''),
        link: post.link || '', mediaUrls: post.mediaUrls || [], format: post.format || 'single',
        publishedAt: null, results: [], suggestion: false,
        createdBy: post.createdBy || req.adminUser?.email || null, createdAt: new Date(), updatedAt: new Date(),
      };
      const extra = staggerByPlatform(base, targets.slice(1), slots.slice(1), { groupId });
      if (extra.length) await db.collection('social_posts').insertMany(extra);
    }
    res.json({ ok: true, scheduledAt: slots[0], platforms: targets, scheduled: targets.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Agent auto-slot the WHOLE batch → spread every pending draft across the calendar.
router.post('/suggestions/auto-slot-all', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const drafts = await db.collection('social_posts')
      .find({ suggestion: true, status: 'draft' }).sort({ createdAt: 1 }).limit(60).toArray();
    if (!drafts.length) return res.json({ ok: true, scheduled: 0, items: [] });
    const slots = await suggestSlots(db, drafts.length);
    const items = [];
    for (let i = 0; i < drafts.length && i < slots.length; i++) {
      await db.collection('social_posts').updateOne(
        { _id: drafts[i]._id },
        { $set: { status: 'scheduled', scheduledAt: slots[i], suggestion: false, updatedAt: new Date() } });
      items.push({ id: String(drafts[i]._id), scheduledAt: slots[i] });
    }
    res.json({ ok: true, scheduled: items.length, items });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Dismiss → remove the suggestion (and its generated asset docs, best-effort)
router.post('/suggestions/:id/dismiss', async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (post?.assetIds?.length) { try { await db.collection('assets').deleteMany({ _id: { $in: post.assetIds } }); } catch {} }
    await db.collection('social_posts').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Per-tenant toggle: join / leave the auto-suggestion cron
router.post('/auto-toggle', express.json(), async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const autoPublish = !!req.body?.autoPublish;
    const count = Math.max(1, Math.min(10, parseInt(req.body?.count, 10) || 5));
    const cadence = ['off', 'daily', '3x_week', 'weekly'].includes(req.body?.cadence) ? req.body.cadence : 'off';
    const channels = Array.isArray(req.body?.channels) ? req.body.channels.map(String).filter(p => PLATFORMS[p] && !PLATFORMS[p].comingSoon && !PLATFORMS[p].connectOnly) : [];
    const standingPrompt = (req.body?.standingPrompt || '').toString().slice(0, 600);
    const useTrends = req.body?.useTrends !== false;
    const critic = req.body?.critic !== false;
    const autoSlot = !!req.body?.autoSlot;   // schedule drafts onto the calendar (see the pipeline)
    // Which site content Autopilot follows + whether it drives newsletter signups.
    const PROMOTE = new Set(['blog', 'portfolio', 'careers']);
    const promote = Array.isArray(req.body?.promote) ? req.body.promote.map(String).filter(p => PROMOTE.has(p)) : [];
    const leadGen = !!req.body?.leadGen;
    // Custom asset tags → autopilot pulls matching library images as backgrounds.
    const assetTags = (req.body?.assetTags || '').toString().split(',').map(t => t.trim()).filter(Boolean).slice(0, 12);
    const slab = getSlabDb();
    await slab.collection('tenants').updateOne({ _id: req.tenant._id },
      { $set: {
        'autoSocial.enabled': enabled, 'autoSocial.autoPublish': autoPublish, 'autoSocial.count': count,
        'autoSocial.cadence': cadence, 'autoSocial.channels': channels, 'autoSocial.standingPrompt': standingPrompt,
        'autoSocial.useTrends': useTrends, 'autoSocial.critic': critic,
        'autoSocial.promote': promote, 'autoSocial.leadGen': leadGen, 'autoSocial.assetTags': assetTags,
        'autoSocial.autoSlot': autoSlot, 'autoSocial.updatedAt': new Date(),
      } });
    // Bust the 5-min tenant cache so the studio badge/toggle reflect the new
    // state immediately — otherwise req.tenant.autoSocial stays stale and the
    // pill reads "Off" while the cron (which reads the DB fresh) runs it.
    for (const d of [req.tenant?.domain, req.tenant?.customDomain, req.tenant?.meta?.customDomain]) if (d) bustTenantCache(d);
    res.json({ ok: true, enabled, autoPublish, count, cadence, channels, standingPrompt, useTrends, critic, promote, leadGen, assetTags, autoSlot });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


export default router;
