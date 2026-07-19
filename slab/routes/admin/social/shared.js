// Shared helpers + upload instances for the /admin/social route modules.
// Extracted verbatim from the original single-file social.js (extract-and-shim).
import multer from 'multer';
import { decrypt } from '../../../plugins/crypto.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { PLATFORMS, packCredentials, unpackCredentials, discoverInstagramFromPage, publishPost } from '../../../plugins/socialPublish.js';
import { logActivity } from '../../../plugins/activityLog.js';

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

// One Meta app powers Facebook + Instagram (+ Threads). Rather than re-pasting
// the IG User ID and a token that already lives on the Facebook Page, auto-link
// Instagram FROM the connected Facebook Page: discover the linked IG business id
// via the Graph API and fill it into the instagram account.
// NON-DESTRUCTIVE — never overwrites an existing IG token; only seeds the token
// from the Page token when Instagram has none yet. Returns a small summary.
async function linkInstagramFromFacebook(db) {
  const fb = await db.collection('social_accounts').findOne({ platform: 'facebook' });
  if (!fb) return { ok: false, error: 'Connect Facebook first' };
  const fbCreds = unpackCredentials(fb);
  if (!fbCreds.pageId || !fbCreds.pageAccessToken) return { ok: false, error: 'Add your Facebook Page ID + Page Access Token first' };

  const found = await discoverInstagramFromPage(fbCreds);
  if (!found) return { ok: false, error: 'No Instagram Business/Creator account is linked to this Facebook Page. Link them in Meta Business Suite, then retry.' };

  const ig = await db.collection('social_accounts').findOne({ platform: 'instagram' });
  // Seed the token from the Page token ONLY when IG has none — a working /
  // auto-managed IG token is never clobbered.
  const seededToken = !ig?.secrets?.accessToken && !!fbCreds.pageAccessToken;
  const body = { igUserId: found.igUserId };
  if (seededToken) body.accessToken = fbCreds.pageAccessToken;
  const { credentials, secrets } = packCredentials('instagram', body, ig || {});

  const set = { platform: 'instagram', credentials, secrets, updatedAt: new Date(), autoLinked: true };
  if (found.username) set.profile = { ...(ig?.profile || {}), name: found.username };
  if (seededToken) { set.tokenType = 'PAGE'; set.tokenManaged = true; } // Page token is managed via the FB account
  if (!ig) { set.enabled = true; set.label = 'Instagram'; set.connectedAt = new Date(); }

  await db.collection('social_accounts').updateOne({ platform: 'instagram' }, { $set: set }, { upsert: true });
  return { ok: true, igUserId: found.igUserId, username: found.username, seededToken };
}


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
  return arr.map(String).filter(p => PLATFORMS[p] && !PLATFORMS[p].comingSoon && !PLATFORMS[p].connectOnly);
}
// Post format discriminator. 'single' = one feed post (today's behaviour);
// 'carousel'/'story' fan a post's ordered mediaUrls into a multi-frame publish
// on the platforms that support it (see platformSupportsFormat).
const POST_FORMATS = new Set(['single', 'carousel', 'story']);
function parseFormat(raw) {
  const f = String(raw || 'single').trim();
  return POST_FORMATS.has(f) ? f : 'single';
}

// A single post keeps the conservative 4-item floor (the common denominator across
// multi-image platforms); carousels/stories allow up to Meta's 10-frame ceiling.
function parseMedia(raw, max = 4) {
  return (raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, max);
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


export {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, MEDIA_MIME_RE, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseFormat, parseMedia, publishPostBackground, loadAccountMap,
};
