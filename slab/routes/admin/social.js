// ─────────────────────────────────────────────────────────────────────────────
// /admin/social — Social Media Portal
// Compose, schedule, and cross-post to connected platforms. Credentials are
// stored per-tenant in `social_accounts` (secrets encrypted via crypto.js).
// Posts live in `social_posts` and are published now or by the scheduler cron.
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { config } from '../../config/config.js';
import { callLLM, tryParseAgentResponse, hasCJK, stripCJK } from '../../plugins/agentMcp.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { logActivity } from '../../plugins/activityLog.js';
import {
  PLATFORMS, PLATFORM_LIST, LIVE_PLATFORMS,
  packCredentials, unpackCredentials, maskAccount, isAccountConfigured,
  publishToPlatform, publishPost, verifyPlatform,
} from '../../plugins/socialPublish.js';
import { refreshAccount, applyRefresh } from '../../plugins/socialTokens.js';
import { fetchEngagement, postReply, allEngageCaps, engageCaps } from '../../plugins/socialEngage.js';
import { decrypt } from '../../plugins/crypto.js';
import { getSlabDb } from '../../plugins/mongo.js';
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng } from '../../plugins/autoSocial.js';
import { uploadBuffer } from '../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../plugins/socialDesign.js';
import { suggestSlots } from '../../plugins/socialSchedule.js';
import { fetchAllFollows, followsAction } from '../../plugins/socialFollows.js';
// ── DISABLED FOR RELEASE: Activity inbox + Listening features ────────────────
// import { fetchAndStoreReddit, replyToActivity, sendConversionEvent, META_VERIFY_TOKEN } from '../../plugins/socialActivity.js';
// import { listKeywords, addKeyword, removeKeyword, runListeners, getDigest, addDigestItem, removeDigestItem, trendSummary } from '../../plugins/socialListen.js';

const AUTO_TOKEN_PLATFORMS = new Set(['facebook', 'instagram', 'threads']);

// Best-effort: upgrade a Meta account's token to long-lived/permanent.
// Never throws — token upgrade must not break the save flow.
async function tryAutoUpgrade(db, platform) {
  if (!AUTO_TOKEN_PLATFORMS.has(platform)) return;
  try {
    const acct = await db.collection('social_accounts').findOne({ platform });
    if (!acct) return;
    const fb = platform === 'facebook' ? acct : await db.collection('social_accounts').findOne({ platform: 'facebook' });
    const appCreds = {
      appId: fb?.credentials?.appId || null,
      appSecret: fb?.secrets?.appSecret ? decrypt(fb.secrets.appSecret) : null,
    };
    if (!appCreds.appId || !appCreds.appSecret) return;   // need app creds to auto-renew
    const result = await refreshAccount(acct, appCreds);
    await applyRefresh(db, platform, result);
  } catch (err) {
    console.warn(`[social] auto token-upgrade failed for ${platform}:`, err.message);
  }
}

const router = express.Router();

// Memory-storage upload for generator save-back — multipart bypasses the global
// 100kb express.json() cap that would 413 a base64 PNG.
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Composer media upload — accepts images and video. Video files are large, so
// this gets a roomier cap than the generator save-back path.
const MEDIA_MIME_RE = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|quicktime|webm))$/i;
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, MEDIA_MIME_RE.test(file.mimetype)),
});

const POST_STATUSES = new Set(['draft', 'scheduled', 'published', 'failed', 'partial']);

function wantsJson(req) {
  return req.xhr || req.query.json === '1' || (req.headers.accept || '').includes('application/json');
}

function parsePlatforms(raw) {
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return arr.map(String).filter(p => PLATFORMS[p] && !PLATFORMS[p].comingSoon);
}
function parseMedia(raw) {
  return (raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 4);
}

// Publish a post in the BACKGROUND and finalize its status. Video publishes
// (FB upload + IG/Threads async processing) can run for minutes — far past
// Apache's proxy timeout — so the route fires this without awaiting and returns
// immediately. The post sits at status 'publishing' until this resolves it to
// published / partial / failed. Never throws (it owns the request lifecycle).
async function publishPostBackground(db, postId, post, accountMap, meta = {}) {
  try {
    const results = await publishPost(post, accountMap);
    const okCount = results.filter(r => r.ok).length;
    const finalStatus = okCount === 0 ? 'failed' : okCount === results.length ? 'published' : 'partial';
    await db.collection('social_posts').updateOne(
      { _id: postId },
      { $set: { status: finalStatus, results, publishedAt: new Date(), updatedAt: new Date() } },
    );
    logActivity({
      category: 'social', action: 'post_published',
      tenantDomain: meta.tenantDomain, tenantId: meta.tenantId,
      status: finalStatus === 'failed' ? 'failed' : 'success',
      actor: { email: meta.actorEmail, role: 'admin' },
      details: { platforms: post.platforms, ok: okCount, total: results.length }, ip: meta.ip,
    });
  } catch (err) {
    console.error('[social] background publish error:', err);
    await db.collection('social_posts').updateOne(
      { _id: postId },
      { $set: { status: 'failed', updatedAt: new Date() }, $push: { results: { ok: false, error: err.message, at: new Date() } } },
    ).catch(() => {});
  }
}

// Build a { platformKey: accountDoc } map from the tenant's connected accounts.
async function loadAccountMap(db) {
  const accounts = await db.collection('social_accounts').find({}).toArray();
  const map = {};
  for (const a of accounts) map[a.platform] = a;
  return map;
}

// ── Portal dashboard ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const db = req.db;
  // Tab consolidation: Compliance folds into Connections; Follows folds into
  // Engage; scheduled posts get their own Calendar tab. Old ?tab=compliance /
  // ?tab=follows links redirect to their new home.
  const tabAlias = { compliance: 'connections', follows: 'engage' };
  const rawTab = tabAlias[req.query.tab] || req.query.tab;
  // Activity + Listening tabs disabled for release — dropped from the valid set.
  const tab = ['compose', 'calendar', 'scheduled', 'engage', 'connections', 'agents'].includes(rawTab) ? rawTab : 'compose';

  // Posts & Schedule has an Active vs Archived view. Archiving is a soft-delete:
  // posts are flagged { archived: true }, hidden from the default list, and kept
  // for the record until explicitly hard-deleted from the archived view.
  const postsView = req.query.view === 'archived' ? 'archived' : 'active';
  const realPost = { $or: [ { suggestion: { $ne: true } }, { status: { $nin: ['draft'] } } ] };

  const [accountsRaw, posts, deletionRequests, archivedCount, archivedPosts] = await Promise.all([
    db.collection('social_accounts').find({}).toArray(),
    // `posts` is always the ACTIVE (non-archived) list — drives stats + the default table.
    db.collection('social_posts').find({ ...realPost, archived: { $ne: true } }).sort({ scheduledAt: -1, createdAt: -1 }).limit(200).toArray(),
    db.collection('deletion_requests').find({}).sort({ createdAt: -1 }).limit(200).toArray().catch(() => []),
    db.collection('social_posts').countDocuments({ ...realPost, archived: true }).catch(() => 0),
    // Archived list loaded only when its view is open.
    postsView === 'archived'
      ? db.collection('social_posts').find({ ...realPost, archived: true }).sort({ archivedAt: -1 }).limit(200).toArray()
      : Promise.resolve([]),
  ]);

  const accountMap = {};
  for (const a of accountsRaw) accountMap[a.platform] = maskAccount(a);

  const connectedKeys = accountsRaw.filter(isAccountConfigured).map(a => a.platform);

  const stats = {
    connected: connectedKeys.length,
    scheduled: posts.filter(p => p.status === 'scheduled').length,
    published: posts.filter(p => p.status === 'published').length,
    drafts: posts.filter(p => p.status === 'draft').length,
    deletionPending: deletionRequests.filter(d => d.status !== 'completed').length,
  };

  const publicBaseUrl = 'https://' + (req.tenant?.meta?.customDomain || req.tenant?.public?.customDomain || req.tenant?.domain || req.hostname);

  // Suggestions + Follows tab data (loaded only when active)
  let suggestions = [];
  let autoSocial = (req.tenant && req.tenant.autoSocial) || { enabled: false, count: 5 };
  let follows = null;
  let activity = [];
  let keywords = [];
  let digest = [];
  let metaVerifyToken = '';
  // ── DISABLED FOR RELEASE: Activity inbox + Listening tabs ──────────────────
  // if (tab === 'listening') {
  //   keywords = await listKeywords(db);
  //   digest = await getDigest(db, { days: 21, limit: 120 });
  // }
  // if (tab === 'activity') {
  //   try { await fetchAndStoreReddit(db); } catch {}
  //   activity = await db.collection('social_activity').find({}).sort({ handled: 1, createdAt: -1 }).limit(80).toArray();
  // }
  // Engage now consumes the Follows feed too, so load it on the Engage tab.
  if (tab === 'engage') {
    try { follows = await fetchAllFollows(accountsRaw.filter(a => a.enabled !== false)); }
    catch (e) { follows = { items: [], sources: [], unsupported: [], errors: [{ platform: 'feed', error: e.message }] }; }
  }

  // Calendar tab: month grid of scheduled posts. ?month=YYYY-MM navigates.
  let calendar = null;
  if (tab === 'calendar') {
    const now = new Date();
    const mp = /^(\d{4})-(\d{2})$/.exec(req.query.month || '');
    const y = mp ? +mp[1] : now.getFullYear();
    const m = mp ? (+mp[2] - 1) : now.getMonth();
    const start = new Date(y, m, 1), end = new Date(y, m + 1, 1);
    const sched = await db.collection('social_posts')
      .find({ status: 'scheduled', archived: { $ne: true }, scheduledAt: { $gte: start, $lt: end } })
      .sort({ scheduledAt: 1 }).toArray();
    const byDay = {};
    for (const p of sched) { const d = new Date(p.scheduledAt).getDate(); (byDay[d] = byDay[d] || []).push(p); }
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < start.getDay(); i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, posts: byDay[d] || [] });
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const fmtM = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    calendar = {
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      prev: fmtM(new Date(y, m - 1, 1)), next: fmtM(new Date(y, m + 1, 1)),
      todayDay: (y === now.getFullYear() && m === now.getMonth()) ? now.getDate() : null,
      weeks, count: sched.length,
    };
  }
  let voice = null, voiceQuestions = VOICE_QUESTIONS, jobs = [];
  let designPrefs = null, designSummary = '', designFeedback = [];
  if (tab === 'agents') {
    voice = await getVoice(db).catch(() => null);
    jobs = await listJobs(db, 12).catch(() => []);
    // The review queue replaces the old Suggestions tab: all pending AI drafts.
    suggestions = await db.collection('social_posts').find({ suggestion: true, status: 'draft' }).sort({ createdAt: -1 }).limit(80).toArray();
    designPrefs = await getDesignPrefs(db).catch(() => null);
    designSummary = describePrefs(designPrefs);
    designFeedback = await listDesignFeedback(db, 40).catch(() => []);
  }

  res.render('admin/social/index', {
    user: req.adminUser,
    page: 'social',
    tab,
    platforms: PLATFORM_LIST,
    livePlatforms: LIVE_PLATFORMS,
    accountMap,
    connectedKeys,
    posts,
    postsView,
    archivedPosts,
    archivedCount,
    calendar,
    deletionRequests,
    stats,
    publicBaseUrl,
    engageCaps: allEngageCaps(),
    qs: req.query,
    suggestions,
    autoSocial,
    follows,
    activity,
    metaVerifyToken,
    publicWebhookUrl: publicBaseUrl + '/webhooks/meta',
    keywords,
    digest,
    gconnected: req.query.gconnected === '1',
    gidsManual: req.query.gids === 'manual',
    voice,
    voiceQuestions,
    jobs,
    designPrefs,
    designSummary,
    designFeedback,
  });
});

// ── Engage: load one account's recent posts + analytics + comments (JSON) ─────
router.get('/engage/:platform', async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  if (!engageCaps(platform)) return res.json({ ok: false, error: 'Engagement not available for this platform' });
  const account = await db.collection('social_accounts').findOne({ platform });
  const result = await fetchEngagement(platform, account);
  res.json(result);
});

// ── Engage: reply to a comment (or post, where allowed) (JSON) ────────────────
router.post('/engage/:platform/reply', express.json(), async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  const { targetId, kind, text } = req.body || {};
  const account = await db.collection('social_accounts').findOne({ platform });
  const result = await postReply(platform, account, { targetId, kind: kind || 'comment', text });
  if (result.ok) {
    logActivity({
      category: 'social', action: 'engage_reply',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform, kind: kind || 'comment' }, ip: req.ip,
    });
  }
  res.json(result);
});

// ── Mark a data-deletion request completed ────────────────────────────────────
router.post('/deletion/:id/complete', async (req, res) => {
  const db = req.db;
  await db.collection('deletion_requests').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: 'completed', completedAt: new Date() } },
  );
  res.redirect('/admin/social?tab=compliance&success=Marked+completed');
});

// ── Save / connect a platform's credentials ──────────────────────────────────
router.post('/connections/:platform', async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  const def = PLATFORMS[platform];
  const json = wantsJson(req);
  if (!def) return json ? res.json({ ok: false, error: 'Unknown platform' }) : res.redirect('/admin/social?tab=connections&error=Unknown+platform');

  try {
    const existing = await db.collection('social_accounts').findOne({ platform });
    const { credentials, secrets } = packCredentials(platform, req.body, existing || {});

    const set = {
      platform,
      label: (req.body.label || '').trim() || def.name,
      credentials,
      secrets,
      enabled: req.body.enabled !== 'off',
      updatedAt: new Date(),
    };
    if (!existing) set.connectedAt = new Date();

    await db.collection('social_accounts').updateOne(
      { platform },
      { $set: set },
      { upsert: true },
    );

    // Auto-upgrade Meta tokens to long-lived/permanent right after save.
    await tryAutoUpgrade(db, platform);

    logActivity({
      category: 'social', action: 'connection_saved',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform }, ip: req.ip,
    });

    if (json) {
      const saved = await db.collection('social_accounts').findOne({ platform });
      return res.json({ ok: true, account: maskAccount(saved) });
    }
    res.redirect(`/admin/social?tab=connections&success=${encodeURIComponent(def.name + ' saved')}`);
  } catch (err) {
    console.error('[social] save connection error:', err);
    if (json) return res.json({ ok: false, error: err.message || 'Save failed' });
    res.redirect('/admin/social?tab=connections&error=' + encodeURIComponent(err.message || 'Save failed'));
  }
});

// ── Disconnect a platform ─────────────────────────────────────────────────────
router.post('/connections/:platform/disconnect', async (req, res) => {
  const db = req.db;
  await db.collection('social_accounts').deleteOne({ platform: req.params.platform });
  res.redirect('/admin/social?tab=connections&success=Disconnected');
});

// ── Test a platform connection (publishes nothing — validates creds) ──────────
router.post('/connections/:platform/test', async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  const def = PLATFORMS[platform];
  if (!def) return res.json({ ok: false, error: 'Unknown platform' });
  if (def.comingSoon) return res.json({ ok: false, error: `${def.name} is not available yet` });

  try {
    const account = await db.collection('social_accounts').findOne({ platform });
    if (!account || !isAccountConfigured(account)) return res.json({ ok: false, error: 'Missing credentials' });

    // Non-destructive, read-only credential check (no posting).
    const result = await verifyPlatform(platform, account);

    await db.collection('social_accounts').updateOne(
      { platform },
      { $set: { lastTestOk: result.ok, lastTestAt: new Date(), ...(result.profile ? { profile: result.profile } : {}) } },
    );
    logActivity({
      category: 'social', action: 'connection_verified',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: result.ok ? 'success' : 'failed',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform }, error: result.ok ? undefined : result.error, ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    console.warn('[social/test] ' + platform + ' failed: ' + err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ── Make a token permanent / long-lived now (manual trigger) ──────────────────
router.post('/connections/:platform/upgrade', async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  if (!AUTO_TOKEN_PLATFORMS.has(platform)) return res.json({ ok: false, error: 'Not supported for this platform' });
  try {
    const acct = await db.collection('social_accounts').findOne({ platform });
    if (!acct) return res.json({ ok: false, error: 'Not connected' });
    const fb = platform === 'facebook' ? acct : await db.collection('social_accounts').findOne({ platform: 'facebook' });
    const appCreds = {
      appId: fb?.credentials?.appId || null,
      appSecret: fb?.secrets?.appSecret ? decrypt(fb.secrets.appSecret) : null,
    };
    const result = await refreshAccount(acct, appCreds);
    if (result?.skipped) return res.json({ ok: false, error: result.skipped });
    await applyRefresh(db, platform, result);
    const fresh = await db.collection('social_accounts').findOne({ platform });
    const permanent = fresh.tokenType === 'PAGE' && !fresh.tokenExpiresAt;
    res.json({
      ok: true, permanent,
      expiresAt: fresh.tokenExpiresAt || null,
      note: permanent ? 'Token is now permanent (never expires).'
        : fresh.tokenExpiresAt ? `Renewed — auto-renews before ${new Date(fresh.tokenExpiresAt).toLocaleDateString()}.`
        : 'Token upgraded.',
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

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

    const raw = await callLLM([{ role: 'user', content: prompt || 'Write a social post.' }], systemPrompt);
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
    const platforms = parsePlatforms(req.body.platforms);
    const mediaUrls = parseMedia(media);

    if (!body && !mediaUrls.length) return res.redirect('/admin/social?tab=compose&error=Write+something+to+post');
    if (!platforms.length) return res.redirect('/admin/social?tab=compose&error=Pick+at+least+one+platform');

    let scheduledAt = null;
    let status = 'draft';
    if (action === 'schedule') {
      scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
      if (!scheduledAt || isNaN(scheduledAt) || scheduledAt.getTime() < Date.now() - 60000) {
        return res.redirect('/admin/social?tab=compose&error=Pick+a+future+date+%26+time');
      }
      status = 'scheduled';
    } else if (action === 'publish') {
      status = 'publishing';
    }

    const doc = {
      body: (body || '').trim(),
      link: (link || '').trim(),
      mediaUrls,
      platforms,
      status,
      scheduledAt,
      publishedAt: null,
      results: [],
      createdBy: req.adminUser?.email || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ins = await db.collection('social_posts').insertOne(doc);

    if (action === 'publish') {
      const accountMap = await loadAccountMap(db);
      // Fire-and-forget: publishing (esp. video) can outlast the proxy timeout.
      publishPostBackground(db, ins.insertedId, doc, accountMap, {
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
router.post('/suggestions/:id/approve', async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    const platform = post.platforms?.[0];
    const account = await db.collection('social_accounts').findOne({ platform });
    const r = await publishWithRetry(platform, post, account);
    const status = r.ok ? 'published' : 'failed';
    await db.collection('social_posts').updateOne({ _id: post._id },
      { $set: { status, suggestion: false, results: [r], publishedAt: new Date(), updatedAt: new Date() } });
    logActivity({ category: 'social', action: 'suggestion_approved', tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: r.ok ? 'success' : 'failed', actor: { email: req.adminUser?.email, role: 'admin' }, details: { platform }, error: r.ok ? undefined : r.error, ip: req.ip });
    res.json({ ok: r.ok, status, url: r.url || null, error: r.error || null });
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
    const $set = { status: 'scheduled', scheduledAt: when, suggestion: false, updatedAt: new Date() };
    if (typeof req.body?.body === 'string' && req.body.body.trim()) $set.body = req.body.body.slice(0, 2000);
    await db.collection('social_posts').updateOne({ _id: post._id }, { $set });
    res.json({ ok: true, scheduledAt: when });
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
    const [slot] = await suggestSlots(db, 1);
    if (!slot) return res.json({ ok: false, error: 'No open slot found' });
    const $set = { status: 'scheduled', scheduledAt: slot, suggestion: false, updatedAt: new Date() };
    if (typeof req.body?.body === 'string' && req.body.body.trim()) $set.body = req.body.body.slice(0, 2000);
    await db.collection('social_posts').updateOne({ _id: post._id }, { $set });
    res.json({ ok: true, scheduledAt: slot });
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
    const channels = Array.isArray(req.body?.channels) ? req.body.channels.map(String).filter(p => PLATFORMS[p] && !PLATFORMS[p].comingSoon) : [];
    const standingPrompt = (req.body?.standingPrompt || '').toString().slice(0, 600);
    const useTrends = req.body?.useTrends !== false;
    const critic = req.body?.critic !== false;
    const slab = getSlabDb();
    await slab.collection('tenants').updateOne({ _id: req.tenant._id },
      { $set: {
        'autoSocial.enabled': enabled, 'autoSocial.autoPublish': autoPublish, 'autoSocial.count': count,
        'autoSocial.cadence': cadence, 'autoSocial.channels': channels, 'autoSocial.standingPrompt': standingPrompt,
        'autoSocial.useTrends': useTrends, 'autoSocial.critic': critic, 'autoSocial.updatedAt': new Date(),
      } });
    res.json({ ok: true, enabled, autoPublish, count, cadence, channels, standingPrompt, useTrends, critic });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Voice Profile (Brand DNA) ─────────────────────────────────────────────────
// Synthesize a structured voice profile from the guided-Q&A answers (preview —
// does not save; the admin reviews/edits then POSTs /voice to persist).
router.post('/voice/synthesize', express.json(), async (req, res) => {
  try {
    const answers = req.body?.answers || {};
    const brandCtx = await loadBrandContext(req.tenant, req.db);
    const out = await synthesizeProfile(answers, brandCtx);
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Save the voice profile (structured fields + editable voiceBlock). Seeds the
// few-shot example pairs on first save; preserves accumulated corrections after.
router.post('/voice', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const db = req.db;
    const b = req.body || {};
    const patch = {
      persona: (b.persona || '').toString().slice(0, 400),
      audience: (b.audience || '').toString().slice(0, 400),
      tone: Array.isArray(b.tone) ? b.tone : (b.tone || '').toString().split(/[\n,;]+/).map(s => s.trim()).filter(Boolean),
      signaturePhrases: Array.isArray(b.signaturePhrases) ? b.signaturePhrases : (b.signaturePhrases || '').toString().split(/[\n,;]+/).map(s => s.trim()).filter(Boolean),
      avoid: Array.isArray(b.avoid) ? b.avoid : (b.avoid || '').toString().split(/[\n,;]+/).map(s => s.trim()).filter(Boolean),
      emojiPolicy: (b.emojiPolicy || '').toString().slice(0, 200),
      hashtagPolicy: (b.hashtagPolicy || '').toString().slice(0, 200),
      lengthPref: (b.lengthPref || '').toString().slice(0, 200),
      interview: (b.interview && typeof b.interview === 'object') ? b.interview : undefined,
    };
    if (patch.interview === undefined) delete patch.interview;
    // Editable block: use what the admin sent, else rebuild from fields.
    patch.voiceBlock = (b.voiceBlock || '').toString().trim() || buildVoiceBlock(patch);

    const existing = await getVoice(db);
    // Seed example pairs only when none exist yet (don't clobber learned corrections).
    if ((!existing || !Array.isArray(existing.fewShot) || !existing.fewShot.length) && Array.isArray(b.seedFewShot) && b.seedFewShot.length) {
      patch.fewShot = b.seedFewShot.slice(-15).map(p => ({ before: String(p.before || '').slice(0, 400), after: String(p.after || '').slice(0, 400), source: 'synthesis', at: new Date() }));
    }
    const saved = await saveVoice(db, patch);
    res.json({ ok: true, voice: saved });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Agent Studio: async batch jobs (prompt → background generation → review) ──
router.post('/agent-studio/run', express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    const jobId = await enqueueJob(req.db, req.tenant, {
      type: 'studio',
      direction: b.direction || '',
      count: b.count,
      platforms: Array.isArray(b.platforms) ? b.platforms : [],
      useTrends: !!b.useTrends,
      critic: b.critic !== false,
      style: b.style,                                   // 'solid' | 'photo' | 'auto'
      mode: 'suggest',                                  // review-first: never auto-posts
      createdBy: req.adminUser?.email || 'admin',
    });
    res.json({ ok: true, jobId });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/agent-studio/jobs', async (req, res) => {
  try { res.json({ ok: true, jobs: await listJobs(req.db, 15) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

router.get('/agent-studio/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(req.db, req.params.id);
    if (!job) return res.json({ ok: false, error: 'Not found' });
    let posts = [];
    if (job.status === 'done' && Array.isArray(job.postIds) && job.postIds.length) {
      posts = await req.db.collection('social_posts').find({ _id: { $in: job.postIds } }).toArray();
    }
    res.json({ ok: true, job, posts });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});



// Follows tab: reply to / like a post from an account you follow
router.post('/follows/:platform/action', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const platform = req.params.platform;
    const account = await db.collection('social_accounts').findOne({ platform });
    const { action, replyRef, text } = req.body || {};
    const r = await followsAction(platform, account, { action, replyRef, text });
    if (r.ok) logActivity({ category: 'social', action: 'follows_' + (action || 'action'), tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success', actor: { email: req.adminUser?.email, role: 'admin' }, details: { platform }, ip: req.ip });
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


// Follows: AI-draft an on-brand reply and send it (agent-assisted outreach)
router.post('/follows/:platform/ai-reply', express.json(), async (req, res) => {
  try {
    const platform = req.params.platform;
    const { replyRef, postText, author } = req.body || {};
    const account = await req.db.collection('social_accounts').findOne({ platform });
    if (!account) return res.json({ ok: false, error: 'Account not connected' });
    const brandCtx = await loadBrandContext(req.tenant, req.db);
    const sys = `You write a short, warm, on-brand reply to someone else's social post to build a genuine connection.
${brandCtx}
Rules: 1-2 sentences, specific to their post, friendly, NOT salesy, no hashtags, no links, under 240 characters. Write in ENGLISH ONLY. Output ONLY the reply text.`;
    const userMsg = `Their post${author ? ' (by ' + author + ')' : ''}: "${String(postText || '').slice(0, 500)}"

Write the reply.`;
    const once = async (extra) => {
      const raw = await callLLM([{ role: 'user', content: userMsg }], sys + (extra || ''), 30000);
      return String(raw || '').trim().replace(/^["']|["']$/g, '').slice(0, 280);
    };
    let draft = await once('');
    // deepseek-r1 sometimes answers in Chinese — retry forcing English, then
    // strip any residual non-Latin characters as a last resort.
    if (hasCJK(draft)) draft = await once('\nThe reply MUST be entirely in English — no Chinese, Japanese, or other non-Latin characters.');
    if (hasCJK(draft)) draft = stripCJK(draft);
    if (!draft || draft.trim().length < 2) return res.json({ ok: false, error: 'Could not draft a clean English reply — try again.' });
    const r = await followsAction(platform, account, { action: 'reply', replyRef, text: draft });
    res.json({ ok: r.ok, text: draft, url: r.url || null, error: r.error || null });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


// Hand a suggestion to the full Asset Generator (loadAgentDesign shape)
router.get('/suggestions/:id/design', async (req, res) => {
  try {
    const post = await req.db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) }, { projection: { design: 1, body: 1, platforms: 1, dims: 1 } });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    res.json({ ok: true, design: post.design || null, body: post.body || '', platform: post.platforms?.[0] || null, dims: post.dims || null });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Save an Asset-Generator edit back onto the draft post. Writes the edited image
// to S3 and updates the post's mediaUrls (and optional design/body) — it does NOT
// create an Assets-library entry, so generator edits stay out of the user's library.
router.post('/suggestions/:id/image', imageUpload.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    const $set = { updatedAt: new Date() };
    if (req.file?.buffer?.length) {
      const up = await uploadPng(req.file.buffer, req.tenant?.s3Prefix, 'gen-edit-' + Date.now());
      $set.mediaUrls = [up.url];
    }
    let design = req.body?.design;
    if (typeof design === 'string') { try { design = JSON.parse(design); } catch { design = null; } }
    if (design && typeof design === 'object') $set.design = design;
    const body = req.body?.body;
    if (body !== undefined) {
      const nb = String(body).slice(0, 2000);
      if (nb.trim() && nb.trim() !== String(post.body || '').trim()) recordCorrection(db, { before: post.body || '', after: nb, source: 'generator-edit' }).catch(() => {});
      $set.body = nb;
    }
    if (!$set.mediaUrls && !$set.design && $set.body === undefined) return res.json({ ok: false, error: 'Nothing to save' });
    await db.collection('social_posts').updateOne({ _id: post._id }, { $set });
    res.json({ ok: true, mediaUrl: $set.mediaUrls ? $set.mediaUrls[0] : null });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});


/* ── DISABLED FOR RELEASE: Activity inbox (reply, mark done, refresh reddit, conversions) ──
// ── Activity inbox: reply, mark done, refresh reddit, send conversion ─────────
router.post('/activity/:id/reply', express.json(), async (req, res) => {
  try {
    const r = await replyToActivity(req.db, req.params.id, (req.body?.text || '').toString());
    res.json(r.ok ? { ok: true } : { ok: false, error: r.error });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/activity/:id/done', express.json(), async (req, res) => {
  try {
    await req.db.collection('social_activity').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { handled: !(req.body?.undo), updatedAt: new Date() } });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/activity/refresh-reddit', async (req, res) => {
  try { const r = await fetchAndStoreReddit(req.db); res.json(r); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// Conversions API — uses dataset id + token from the facebook account secrets
// ({ capiDatasetId, capiToken }) or from the request body for a manual test.
router.post('/conversions/send', express.json(), async (req, res) => {
  try {
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'facebook' });
    const sec = acct?.secrets || {};
    const datasetId = (req.body?.datasetId || sec.capiDatasetId || '').toString();
    const token = (req.body?.token || sec.capiToken || '').toString();
    const r = await sendConversionEvent({
      datasetId, token,
      eventName: req.body?.eventName || 'Lead',
      customData: req.body?.customData || {},
      userData: req.body?.userData || {},
      eventSourceUrl: req.body?.eventSourceUrl,
    });
    res.json(r);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
──────────────────────────────────────────────────────────────────────────── */



/* ── DISABLED FOR RELEASE: Listening (keyword listeners + trend digest) ────────
// ── Listening: keyword listeners + trend digest ───────────────────────────────
router.post('/listen/keywords', express.json(), async (req, res) => {
  try {
    const kw = (req.body?.keyword || '').toString().slice(0, 80);
    const sources = Array.isArray(req.body?.sources) ? req.body.sources : ['web', 'reddit'];
    const doc = await addKeyword(req.db, kw, sources);
    res.json(doc ? { ok: true, keyword: doc } : { ok: false, error: 'Empty keyword' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/listen/keywords/:id/delete', async (req, res) => {
  try { await removeKeyword(req.db, req.params.id); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/listen/run', express.json(), async (req, res) => {
  try { const r = await runListeners(req.db, req.tenant, { keyword: (req.body?.keyword || '').toString().slice(0, 80) || null }); res.json(r); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/digest/add', express.json(), async (req, res) => {
  try {
    await addDigestItem(req.db, {
      source: (req.body?.source || 'note').toString(), keyword: (req.body?.keyword || '').toString().slice(0, 80),
      title: (req.body?.title || '').toString().slice(0, 200), snippet: (req.body?.snippet || '').toString().slice(0, 500),
      url: (req.body?.url || '').toString().slice(0, 500) || undefined,
    });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/digest/:id/delete', async (req, res) => {
  try { await removeDigestItem(req.db, req.params.id); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
──────────────────────────────────────────────────────────────────────────── */


// Quote / spotlight composer — owner, mission, or customer quote → suggestion(s).
router.post('/suggestions/spotlight', express.json(), async (req, res) => {
  try {
    const out = await generateSpotlight(req.tenant, req.db, {
      kind: req.body?.kind, subject: req.body?.subject, role: req.body?.role,
      quote: req.body?.quote, createdBy: req.adminUser?.email || 'admin',
    });
    if (out.error) return res.json({ ok: false, error: out.error });
    res.json({ ok: true, ...out });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});


// ── Google Business Profile OAuth connect flow ────────────────────────────────
router.get('/google/connect', async (req, res) => {
  try {
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'googlebusiness' });
    const creds = acct ? unpackCredentials(acct) : {};
    if (!creds.clientId || !creds.clientSecret) {
      return res.send('Save your Google OAuth Client ID & Secret first under Connections → Google Business, then click Connect.');
    }
    const redirectUri = `https://${req.get('host')}/admin/social/google/callback`;
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/business.manage',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
    }).toString();
    res.redirect(url);
  } catch (e) { res.status(500).send('Google connect error: ' + e.message); }
});

router.get('/google/callback', async (req, res) => {
  try {
    if (!req.query.code) {
      const reason = req.query.error || 'denied';
      const desc = req.query.error_description ? ' (' + req.query.error_description + ')' : '';
      console.warn('[google/callback] no code; error=' + reason + desc);
      return res.redirect('/admin/social?tab=connections&gerror=' + encodeURIComponent(reason));
    }
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'googlebusiness' });
    const creds = acct ? unpackCredentials(acct) : {};
    const redirectUri = `https://${req.get('host')}/admin/social/google/callback`;
    // 1. exchange code for tokens
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: req.query.code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(15000),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tj.refresh_token) return res.redirect('/admin/social?tab=connections&gerror=norefresh');
    // 2. auto-discover account + first location (best-effort; needs APIs enabled)
    let accountId = creds.accountId || '', locationId = creds.locationId || '';
    try {
      const ar = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15000) });
      const aj = await ar.json().catch(() => ({}));
      const acctName = aj.accounts?.[0]?.name || '';
      if (acctName) {
        accountId = acctName.split('/')[1] || accountId;
        const lr = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${acctName}/locations?readMask=name&pageSize=1`, { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15000) });
        const lj = await lr.json().catch(() => ({}));
        const locName = lj.locations?.[0]?.name || '';
        if (locName) locationId = locName.split('/').pop() || locationId;
      }
    } catch { /* IDs can be filled manually if discovery is gated */ }
    // 3. store (refreshToken encrypted via packCredentials)
    const { credentials, secrets } = packCredentials('googlebusiness', { refreshToken: tj.refresh_token, accountId, locationId }, acct || {});
    await req.db.collection('social_accounts').updateOne(
      { platform: 'googlebusiness' },
      { $set: { platform: 'googlebusiness', credentials, secrets, enabled: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    res.redirect('/admin/social?tab=connections&gconnected=1' + (accountId && locationId ? '' : '&gids=manual'));
  } catch (e) { res.status(500).send('Google connect failed: ' + e.message); }
});

export default router;
