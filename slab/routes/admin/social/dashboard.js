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
} from '../../../plugins/socialPublish.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { fetchEngagement, postReply, allEngageCaps, engageCaps } from '../../../plugins/socialEngage.js';
import { encrypt, decrypt } from '../../../plugins/crypto.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng, upcomingObservances } from '../../../plugins/autoSocial.js';
import { uploadBuffer } from '../../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../../plugins/socialDesign.js';
import { getReliability } from '../../../plugins/socialScore.js';
import { suggestSlots } from '../../../plugins/socialSchedule.js';
import { fetchAllFollows, followsAction } from '../../../plugins/socialFollows.js';
import { isGridLocked, countHeldGrid, setGridLock, GRID_ROW } from '../../../plugins/socialGrid.js';

// Collapse a post list so a 9-grid mural's tiles read as ONE card instead of nine
// rows. Non-mural posts pass through untouched. The group is shaped like a post
// (status/body/mediaUrls/scheduledAt) so existing templates render it, plus an
// `isMuralGroup` flag + roll-up counts the templates special-case.
function collapseMurals(list) {
  const groups = new Map();
  const out = [];
  for (const p of list || []) {
    if (!p.muralId) { out.push(p); continue; }
    let g = groups.get(p.muralId);
    if (!g) { g = { isMuralGroup: true, muralId: p.muralId, _id: p.muralId, tiles: [] }; groups.set(p.muralId, g); out.push(g); }
    g.tiles.push(p);
  }
  for (const g of out) {
    if (!g.isMuralGroup) continue;
    const tiles = g.tiles.sort((a, b) => (a.muralIndex ?? 0) - (b.muralIndex ?? 0));
    const cover = tiles.find(t => t.muralCover) || tiles[0] || {};
    g.muralTotal = tiles.length;
    g.muralPublished = tiles.filter(t => t.status === 'published').length;
    const anyFail = tiles.some(t => t.status === 'failed' || t.status === 'partial');
    g.status = g.muralPublished === g.muralTotal ? 'published'
      : anyFail ? 'partial'
      : tiles.some(t => t.status === 'publishing' || t.status === 'held') ? 'publishing'
      : 'scheduled';
    g.mediaUrls = cover.mediaUrls || [];
    g.platforms = ['instagram'];
    g.body = `🧩 9-Grid Mural — ${g.muralPublished}/${g.muralTotal} tiles published`;
    const times = tiles.map(t => t.scheduledAt).filter(Boolean).map(d => new Date(d)).sort((a, b) => a - b);
    g.scheduledAt = times[0] || cover.scheduledAt || null;
    g.publishedAt = tiles.map(t => t.publishedAt).filter(Boolean).map(d => new Date(d)).sort((a, b) => b - a)[0] || null;
    g.createdAt = cover.createdAt || null;
  }
  return out;
}
import {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseMedia, publishPostBackground, loadAccountMap,
} from './shared.js';

const router = express.Router();

// ── Portal dashboard ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const db = req.db;
  // Connections + Compliance now live in Settings (one home for account creds).
  // Bounce any old ?tab=connections / ?tab=compliance bookmark straight there.
  if (req.query.tab === 'connections' || req.query.tab === 'compliance') {
    return res.redirect('/admin/settings#socialSettings');
  }
  // Tab consolidation: the old Engage/Follows tabs are replaced by Analytics;
  // scheduled posts get their own Calendar tab. Old bookmarks redirect to Analytics.
  const tabAlias = { follows: 'analytics', engage: 'analytics' };
  const rawTab = tabAlias[req.query.tab] || req.query.tab;
  // Activity + Listening tabs disabled for release — dropped from the valid set.
  const tab = ['compose', 'calendar', 'scheduled', 'analytics', 'agents'].includes(rawTab) ? rawTab : 'compose';

  // Posts & Schedule has an Active vs Archived view. Archiving is a soft-delete:
  // posts are flagged { archived: true }, hidden from the default list, and kept
  // for the record until explicitly hard-deleted from the archived view.
  const postsView = req.query.view === 'archived' ? 'archived' : 'active';
  const realPost = { $or: [ { suggestion: { $ne: true } }, { status: { $nin: ['draft'] } } ] };

  const [accountsRaw, postsRaw, deletionRequests, archivedCount, archivedPosts] = await Promise.all([
    db.collection('social_accounts').find({}).toArray(),
    // `posts` is always the ACTIVE (non-archived) list — drives stats + the default table.
    // Sort by most-recent ACTIVITY (updated → published → created) so a just-
    // published/failed post lands at the top. Immediate posts have scheduledAt=null,
    // which under a scheduledAt sort sank them below every dated post — hiding fresh
    // failures dozens of rows down. Scheduled ordering lives on the Calendar tab.
    db.collection('social_posts').find({ ...realPost, archived: { $ne: true } }).sort({ updatedAt: -1, createdAt: -1 }).limit(200).toArray(),
    db.collection('deletion_requests').find({}).sort({ createdAt: -1 }).limit(200).toArray().catch(() => []),
    db.collection('social_posts').countDocuments({ ...realPost, archived: true }).catch(() => 0),
    // Archived list loaded only when its view is open.
    postsView === 'archived'
      ? db.collection('social_posts').find({ ...realPost, archived: true }).sort({ archivedAt: -1 }).limit(200).toArray()
      : Promise.resolve([]),
  ]);

  // Collapse each mural's 9 tiles into one card for the list + counts.
  const posts = collapseMurals(postsRaw);

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
  // Analytics tab pulls live insights client-side (see _analytics.ejs → /admin/analytics/social),
  // so nothing platform-facing is fetched here on render.

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
    for (const d of Object.keys(byDay)) byDay[d] = collapseMurals(byDay[d]);   // one chip per mural per day
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < start.getDay(); i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, posts: byDay[d] || [] });
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const fmtM = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    // Grid-lock flag: is a mural being protected, and how many IG feed posts are
    // sandbagged waiting to complete the next row of 3?
    const gridActive = await isGridLocked(db).catch(() => false);
    const held = gridActive ? await countHeldGrid(db).catch(() => 0) : 0;
    calendar = {
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      prev: fmtM(new Date(y, m - 1, 1)), next: fmtM(new Date(y, m + 1, 1)),
      todayDay: (y === now.getFullYear() && m === now.getMonth()) ? now.getDate() : null,
      weeks, count: sched.length,
      gridLock: {
        active: gridActive,
        held,
        rowSize: GRID_ROW,
        towardRow: held % GRID_ROW,                 // progress toward the next full row
        needed: gridActive ? (GRID_ROW - (held % GRID_ROW)) % GRID_ROW : 0,
      },
    };
  }
  let voice = null, voiceQuestions = VOICE_QUESTIONS, jobs = [];
  let designPrefs = null, designSummary = '', designFeedback = [];
  let observances = [], reliability = null;
  if (tab === 'agents') {
    voice = await getVoice(db).catch(() => null);
    jobs = await listJobs(db, 12).catch(() => []);
    try { observances = upcomingObservances(45); } catch { observances = []; }   // marketing-calendar preview
    // The review queue replaces the old Suggestions tab: all pending AI drafts.
    suggestions = await db.collection('social_posts').find({ suggestion: true, status: 'draft' }).sort({ createdAt: -1 }).limit(80).toArray();
    designPrefs = await getDesignPrefs(db).catch(() => null);
    designSummary = describePrefs(designPrefs);
    designFeedback = await listDesignFeedback(db, 40).catch(() => []);
    try { reliability = await getReliability(db); } catch { reliability = null; }
  }

  // Compose edit mode: ?tab=compose&edit=<id> loads a post to prefill the composer.
  let editPost = null;
  if (tab === 'compose' && req.query.edit) {
    try { editPost = await db.collection('social_posts').findOne({ _id: new ObjectId(req.query.edit) }); }
    catch { editPost = null; }
  }

  res.render('admin/social/index', {
    editPost,
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
    observances,
    reliability,
  });
});


// Archive a whole mural (all 9 tiles) as a unit — cancels any still-scheduled tiles.
// Already-published tiles stay live on Instagram; this just clears them from the queue.
router.post('/mural/:muralId/archive', async (req, res) => {
  try {
    const r = await req.db.collection('social_posts').updateMany(
      { muralId: req.params.muralId },
      { $set: { archived: true, archivedAt: new Date(), updatedAt: new Date() } },
    );
    res.json({ ok: true, archived: r.modifiedCount });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Toggle grid-integrity lock. Turning it OFF releases any sandbagged posts back to
// 'scheduled' so they publish normally (the mural is no longer being protected).
router.post('/grid-lock', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const active = !!req.body?.active;
    await setGridLock(db, active, null);
    if (!active) {
      // Release the sandbag: held IG feed posts go back to scheduled (due → publish next run).
      await db.collection('social_posts').updateMany(
        { status: 'held', archived: { $ne: true } },
        { $set: { status: 'scheduled', updatedAt: new Date() }, $unset: { heldAt: '' } },
      );
    }
    const held = active ? await countHeldGrid(db).catch(() => 0) : 0;
    logActivity({ category: 'social', action: 'grid_lock_' + (active ? 'on' : 'off'), tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success', actor: { email: req.adminUser?.email, role: 'admin' }, ip: req.ip });
    res.json({ ok: true, active, held });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

export default router;
