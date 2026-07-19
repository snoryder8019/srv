// ─────────────────────────────────────────────────────────────────────────────
// socialPublish.js — Social media platform registry + publish adapters
//
// Each platform declares the credential fields it needs (public vs secret), its
// capabilities, a human setup note, and a `publish({ post, creds })` adapter.
//
// Credentials live in the TENANT db, collection `social_accounts`:
//   { platform, enabled, label, profile, credentials:{...public}, secrets:{...enc}, ... }
// Secret fields are AES-256-GCM encrypted via plugins/crypto.js before storage and
// decrypted only at publish/test time. Decrypted values are NEVER logged.
// ─────────────────────────────────────────────────────────────────────────────
import { encrypt, decrypt } from './crypto.js';
import sharp from 'sharp';
import { uploadBuffer } from './s3.js';

// Fetch a remote media file into a Buffer (used by adapters that upload bytes).
async function fetchMedia(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`media fetch ${r.status}`);
  const contentType = r.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, contentType };
}

// Is this media URL a video? Used to route each adapter to its video flow
// (photo and video endpoints differ on every platform).
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|avi|mkv|m3u8)(\?|#|$)/i;
function isVideoUrl(u) { return VIDEO_EXT_RE.test(String(u || '')); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Meta (Instagram / Threads) video containers are processed ASYNCHRONOUSLY —
// you must poll the container until it reports FINISHED before publishing, or
// the publish call fails ("media not finished processing"). `field` differs:
// Instagram exposes `status_code`, Threads exposes `status`.
async function pollMetaContainer(statusUrl, field, { timeoutMs = 150000, intervalMs = 5000, firstDelayMs = intervalMs } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let wait = firstDelayMs;
  while (Date.now() < deadline) {
    await sleep(wait);
    wait = intervalMs;
    const r = await fetch(statusUrl, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    last = j[field] || last;
    if (last === 'FINISHED') return;
    if (last === 'ERROR' || last === 'EXPIRED') throw new Error(`media processing ${last}${j.error_message ? ': ' + j.error_message : ''}`);
  }
  throw new Error(`media still processing after ${Math.round(timeoutMs / 1000)}s — try again shortly`);
}

// Instagram's Content Publishing API accepts ONLY JPEG for image_url — a PNG/WebP
// still fails the container step with "Only photo or video can be accepted as media
// type" (code 9004, subcode 2207052), which reads misleadingly as a fetch failure.
// (Facebook, Mastodon, Bluesky, LinkedIn all accept PNG, so this is IG-specific.)
// Transcode any non-JPEG still to JPEG, re-upload it, and post that URL instead.
// The re-upload reuses the source URL's tenant prefix so it lands in the same space.
// Best-effort: on any transcode/upload failure we fall back to the original URL.
const JPEG_URL_RE = /\.(jpe?g)(\?|#|$)/i;
async function ensureJpegForMeta(url) {
  try {
    if (JPEG_URL_RE.test(String(url || ''))) return url; // already JPEG
    const { buffer } = await fetchMedia(url);
    const jpeg = await sharp(buffer)
      .flatten({ background: { r: 255, g: 255, b: 255 } }) // drop alpha (JPEG has none)
      .jpeg({ quality: 90, chromaSubsampling: '4:2:0' })
      .toBuffer();
    let prefix = 'default';
    try { const seg = new URL(url).pathname.replace(/^\/+/, '').split('/')[0]; if (seg) prefix = seg; } catch {}
    const { url: jpegUrl } = await uploadBuffer(jpeg, { prefix, folder: 'assets/auto/ig', name: 'ig.jpg', contentType: 'image/jpeg' });
    return jpegUrl;
  } catch {
    return url;
  }
}

// Publish a Meta container, retrying the transient "Media ID is not available" /
// "not ready for publishing" error (code 9007, subcode 2207027) — the container is
// FINISHED but the publish edge briefly lags behind. Any other error is terminal.
async function metaPublishRetry(publishUrl, body, { retries = 4, delayMs = 4000 } = {}) {
  let lastJson = {}, lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetch(publishUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.id) return j;
    lastJson = j; lastStatus = r.status;
    const e = j?.error || {};
    if ((e.error_subcode === 2207027 || e.code === 9007) && attempt < retries) { await sleep(delayMs); continue; }
    break;
  }
  throw metaError(lastJson, lastStatus, 'publish');
}

// Build a rich, human-readable error from a Meta Graph API response. Meta packs
// the real cause into code/subcode/error_user_msg/fbtrace_id — surfacing only
// `error.message` hides whether it's an expired/short-lived token (code 190),
// a permission gap (code 200/10), a bad image URL, etc. `stage` labels where it
// failed (e.g. "container", "publish"). Never includes the token itself.
export function metaError(json, status, stage) {
  const e = json?.error || {};
  const parts = [];
  if (stage) parts.push(`[${stage}]`);
  parts.push(e.message || `HTTP ${status}`);
  // The user-facing title/message Meta wrote for this exact failure.
  if (e.error_user_msg && e.error_user_msg !== e.message) parts.push(`— ${e.error_user_msg}`);
  const codes = [];
  if (e.code != null) codes.push(`code ${e.code}`);
  if (e.error_subcode != null) codes.push(`subcode ${e.error_subcode}`);
  if (e.type) codes.push(e.type);
  // Code 190 = OAuthException → token expired / short-lived / revoked. Make it loud.
  if (e.code === 190) codes.push('token invalid/expired — re-connect or upgrade to a long-lived token');
  if (codes.length) parts.push(`(${codes.join(', ')})`);
  if (e.fbtrace_id) parts.push(`fbtrace_id=${e.fbtrace_id}`);
  return new Error(parts.join(' '));
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
// Reddit OAuth (script app) — password grant → bearer token. Never logs secrets.
async function redditAccessToken(creds) {
  if (!creds.clientId || !creds.clientSecret || !creds.username || !creds.password) throw new Error("Missing Reddit app credentials");
  const basic = Buffer.from(creds.clientId + ":" + creds.clientSecret).toString("base64");
  const ua = "slab:madladslab.social:v1 (by u/" + creds.username + ")";
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: "Basic " + basic, "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username: creds.username, password: creds.password }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error || j.message || ("Reddit token HTTP " + r.status));
  return { token: j.access_token, ua };
}
export { redditAccessToken };

// Exchange a Google OAuth refresh token for a short-lived access token.
async function googleAccessToken(creds) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: creds.refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google token refresh failed: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}
export { googleAccessToken };

// Google's generic error message ("Request contains an invalid argument.")
// never names the bad field — the specifics live in error.details[].fieldViolations.
// Pull them out so callers/admins see WHICH argument Google rejected.
function googleApiError(j, httpStatus, label) {
  const e = j && j.error;
  if (!e) return `${label} (${httpStatus})`;
  const parts = [];
  for (const d of (e.details || [])) {
    for (const fv of (d.fieldViolations || [])) parts.push(`${fv.field || 'field'} — ${fv.description || 'invalid'}`);
    if (d.reason && !d.fieldViolations) parts.push(d.reason);
  }
  let msg = e.message || `${label} (${httpStatus})`;
  if (e.status && !msg.includes(e.status)) msg += ` [${e.status}]`;
  if (parts.length) msg += ': ' + parts.join('; ');
  return msg;
}

// A Maps Place ID ("ChIJ…"/"GhIJ…") is NOT a Business Profile Location ID. The
// v4 localPosts path wants the numeric location id from accounts/*/locations;
// pasting the Place ID makes every post fail with INVALID_ARGUMENT.
function looksLikePlaceId(id) { return /^(ChIJ|GhIJ)/.test(String(id || '')); }

// Normalize a user-supplied link to an absolute http(s) URL (Google rejects a
// callToAction whose url has no scheme). Returns null if it can't be made valid.
function normalizeHttpUrl(u) {
  u = String(u || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : null; }
  catch { return null; }
}

// LinkedIn image upload (v2 assets API): register an upload → PUT the bytes →
// return the asset URN to attach to a ugcPost. Works with a w_member_social
// (member) or w_organization_social (organization) token; owner = author URN.
async function linkedinUploadImage(url, creds) {
  const headers = {
    Authorization: `Bearer ${creds.accessToken}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
  const reg = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST', headers,
    body: JSON.stringify({ registerUploadRequest: {
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      owner: creds.authorUrn,
      serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
    } }),
    signal: AbortSignal.timeout(20000),
  });
  const rj = await reg.json().catch(() => ({}));
  if (!reg.ok) throw new Error('image register failed: ' + (rj.message || `HTTP ${reg.status}`));
  const asset = rj?.value?.asset;
  const uploadUrl = rj?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  if (!asset || !uploadUrl) throw new Error('image register: LinkedIn returned no upload URL');
  const { buffer, contentType } = await fetchMedia(url);
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': contentType },
    body: buffer,
    signal: AbortSignal.timeout(60000),
  });
  if (!put.ok) throw new Error('image upload failed: HTTP ' + put.status);
  return asset;
}

export const PLATFORMS = {
  // ── Mastodon — simplest: instance URL + an access token from the app you create
  mastodon: {
    key: 'mastodon',
    name: 'Mastodon',
    icon: '🐘',
    color: '#6364FF',
    caps: { text: true, link: true, media: true },
    fields: [
      { key: 'instanceUrl', label: 'Instance URL', secret: false, placeholder: 'https://mastodon.social' },
      { key: 'accessToken', label: 'Access Token', secret: true, placeholder: 'token from Preferences → Development' },
    ],
    setup: 'Log in to your Mastodon instance → Preferences → Development → New Application. Give it `write:statuses` and `write:media` scopes, then copy "Your access token".',
    portal: 'https://docs.joinmastodon.org/client/token/',
    async verify({ creds }) {
      const base = (creds.instanceUrl || '').replace(/\/+$/, '');
      const r = await fetch(`${base}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return { ok: true, profile: { name: j.acct || j.username, url: j.url } };
    },
    async publish({ post, creds }) {
      const base = (creds.instanceUrl || '').replace(/\/+$/, '');
      if (!base || !creds.accessToken) throw new Error('Missing instance URL or access token');
      const headers = { Authorization: `Bearer ${creds.accessToken}` };

      // Upload media first (if any) to get attachment ids. Video uploads return
      // 202 (still processing) — Mastodon rejects the status until the media is
      // ready, so poll GET /api/v1/media/:id (200 = processed) before posting.
      const mediaIds = [];
      for (const url of (post.mediaUrls || []).slice(0, 4)) {
        try {
          const { buffer, contentType } = await fetchMedia(url);
          const fd = new FormData();
          fd.append('file', new Blob([buffer], { type: contentType }), isVideoUrl(url) ? 'video' : 'media');
          const mr = await fetch(`${base}/api/v2/media`, { method: 'POST', headers, body: fd, signal: AbortSignal.timeout(120000) });
          const mj = await mr.json().catch(() => ({}));
          if (!mj.id) continue;
          if (mr.status === 202) {
            // Processing — poll until the instance reports it ready (200).
            const deadline = Date.now() + 120000;
            while (Date.now() < deadline) {
              await sleep(4000);
              const pr = await fetch(`${base}/api/v1/media/${mj.id}`, { headers, signal: AbortSignal.timeout(15000) });
              if (pr.status === 200) break;
            }
          }
          if (mr.ok || mr.status === 202) mediaIds.push(mj.id);
        } catch { /* skip bad media, still post text */ }
      }

      const status = [post.body, post.link].filter(Boolean).join('\n\n');
      const r = await fetch(`${base}/api/v1/statuses`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(mediaIds.length ? { media_ids: mediaIds } : {}) }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return { id: j.id, url: j.url || j.uri };
    },
  },

  // ── Bluesky — handle + app password (free, no dev portal)
  bluesky: {
    key: 'bluesky',
    name: 'Bluesky',
    icon: '🦋',
    color: '#0085FF',
    caps: { text: true, link: true, media: true },
    fields: [
      { key: 'identifier', label: 'Handle', secret: false, placeholder: 'you.bsky.social' },
      { key: 'appPassword', label: 'App Password', secret: true, placeholder: 'xxxx-xxxx-xxxx-xxxx' },
      { key: 'service', label: 'Service (optional)', secret: false, placeholder: 'https://bsky.social' },
    ],
    setup: 'In the Bluesky app → Settings → Privacy and security → App Passwords → Add App Password. Use your handle (e.g. you.bsky.social) and the generated app password — NOT your main password.',
    portal: 'https://bsky.app/settings/app-passwords',
    async verify({ creds }) {
      const svc = (creds.service || 'https://bsky.social').replace(/\/+$/, '');
      const r = await fetch(`${svc}/xrpc/com.atproto.server.createSession`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: creds.identifier, password: creds.appPassword }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      return { ok: true, profile: { name: j.handle, url: `https://bsky.app/profile/${j.handle}` } };
    },
    async publish({ post, creds }) {
      const svc = (creds.service || 'https://bsky.social').replace(/\/+$/, '');
      if (!creds.identifier || !creds.appPassword) throw new Error('Missing handle or app password');
      const sess = await fetch(`${svc}/xrpc/com.atproto.server.createSession`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: creds.identifier, password: creds.appPassword }),
        signal: AbortSignal.timeout(20000),
      });
      const sj = await sess.json().catch(() => ({}));
      if (!sess.ok) throw new Error(sj.message || `auth HTTP ${sess.status}`);

      const text = [post.body, post.link].filter(Boolean).join('\n\n').slice(0, 300);

      // Upload a blob to the PDS and return its ref (or null on failure).
      const uploadBlob = async (buffer, contentType, timeoutMs) => {
        const ur = await fetch(`${svc}/xrpc/com.atproto.repo.uploadBlob`, {
          method: 'POST',
          headers: { 'Content-Type': contentType || 'application/octet-stream', Authorization: `Bearer ${sj.accessJwt}` },
          body: buffer,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const uj = await ur.json().catch(() => ({}));
        return ur.ok && uj.blob ? uj.blob : null;
      };

      // A video takes priority over images (Bluesky embeds one OR the other).
      const videoUrl = (post.mediaUrls || []).find(isVideoUrl);
      let embed = null;
      if (videoUrl) {
        try {
          const { buffer, contentType } = await fetchMedia(videoUrl);
          // Bluesky video service caps at ~50MB / ~3min; skip oversized.
          if (buffer.length <= 50 * 1024 * 1024) {
            const blob = await uploadBlob(buffer, contentType || 'video/mp4', 180000);
            if (blob) embed = { $type: 'app.bsky.embed.video', video: blob, alt: post.alt || '' };
          }
        } catch { /* fall through to images / text */ }
      }
      if (!embed) {
        // Upload any images as blobs (Bluesky allows up to 4) and build an embed.
        const images = [];
        for (const url of (post.mediaUrls || []).filter(u => !isVideoUrl(u)).slice(0, 4)) {
          try {
            const { buffer, contentType } = await fetchMedia(url);
            // Bluesky caps image blobs at ~1MB; skip oversized rather than fail the whole post.
            if (buffer.length > 1000000) continue;
            const blob = await uploadBlob(buffer, contentType, 30000);
            if (blob) images.push({ alt: post.alt || '', image: blob });
          } catch { /* skip bad media, still post text */ }
        }
        if (images.length) embed = { $type: 'app.bsky.embed.images', images };
      }

      const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() };
      if (embed) record.embed = embed;

      const r = await fetch(`${svc}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sj.accessJwt}` },
        body: JSON.stringify({
          repo: sj.did,
          collection: 'app.bsky.feed.post',
          record,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      const rkey = (j.uri || '').split('/').pop();
      return { id: j.uri, url: rkey ? `https://bsky.app/profile/${creds.identifier}/post/${rkey}` : undefined };
    },
  },

  // ── Discord — incoming webhook URL (per channel)
  discord: {
    key: 'discord',
    name: 'Discord',
    icon: '💬',
    color: '#5865F2',
    caps: { text: true, link: true, media: true },
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', secret: true, placeholder: 'https://discord.com/api/webhooks/...' },
    ],
    setup: 'In your Discord server → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.',
    portal: 'https://support.discord.com/hc/en-us/articles/228383668',
    async verify({ creds }) {
      const r = await fetch(creds.webhookUrl, { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true, profile: { name: j.name || 'webhook' } };
    },
    async publish({ post, creds }) {
      if (!creds.webhookUrl) throw new Error('Missing webhook URL');
      const content = [post.body, post.link].filter(Boolean).join('\n');
      let text = content;
      const img = (post.mediaUrls || [])[0];
      const payload = {};
      if (img && isVideoUrl(img)) {
        // Discord webhook embeds can't host arbitrary video — drop the URL into
        // the message so it unfurls into an inline player.
        text = [content, img].filter(Boolean).join('\n');
      } else if (img) {
        payload.embeds = [{ image: { url: img } }];
      }
      payload.content = text.slice(0, 2000);
      const r = await fetch(creds.webhookUrl + '?wait=true', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json().catch(() => ({}));
      return { id: j.id };
    },
  },

  // ── Telegram — bot token + chat/channel id
  telegram: {
    key: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    color: '#26A5E4',
    caps: { text: true, link: true, media: true },
    fields: [
      { key: 'botToken', label: 'Bot Token', secret: true, placeholder: '123456:ABC-DEF...' },
      { key: 'chatId', label: 'Chat / Channel ID', secret: false, placeholder: '@yourchannel or -1001234567890' },
    ],
    setup: 'Message @BotFather on Telegram → /newbot → copy the token. Add the bot to your channel as an admin. Use @channelusername (public) or the numeric chat id.',
    portal: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    async verify({ creds }) {
      const api = `https://api.telegram.org/bot${creds.botToken}`;
      const me = await fetch(`${api}/getMe`, { signal: AbortSignal.timeout(15000) });
      const mj = await me.json().catch(() => ({}));
      if (!mj.ok) throw new Error(mj.description || 'Invalid bot token');
      const chat = await fetch(`${api}/getChat?chat_id=${encodeURIComponent(creds.chatId)}`, { signal: AbortSignal.timeout(15000) });
      const cj = await chat.json().catch(() => ({}));
      if (!cj.ok) throw new Error(cj.description || 'Bot cannot access that chat — add it as an admin');
      return { ok: true, profile: { name: cj.result?.title || cj.result?.username || creds.chatId } };
    },
    async publish({ post, creds }) {
      if (!creds.botToken || !creds.chatId) throw new Error('Missing bot token or chat id');
      const text = [post.body, post.link].filter(Boolean).join('\n\n');
      const img = (post.mediaUrls || [])[0];
      const api = `https://api.telegram.org/bot${creds.botToken}`;
      let r, j;
      if (img && isVideoUrl(img)) {
        r = await fetch(`${api}/sendVideo`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: creds.chatId, video: img, caption: text.slice(0, 1024), supports_streaming: true }),
          signal: AbortSignal.timeout(60000),
        });
      } else if (img) {
        r = await fetch(`${api}/sendPhoto`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: creds.chatId, photo: img, caption: text.slice(0, 1024) }),
          signal: AbortSignal.timeout(20000),
        });
      } else {
        r = await fetch(`${api}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: creds.chatId, text }),
          signal: AbortSignal.timeout(20000),
        });
      }
      j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.description || `HTTP ${r.status}`);
      return { id: String(j.result?.message_id || '') };
    },
  },

  // ── Facebook Page — long-lived Page access token + Page ID (Meta Graph API)
  facebook: {
    key: 'facebook',
    name: 'Facebook Page',
    icon: '📘',
    color: '#1877F2',
    caps: { text: true, link: true, media: true },
    fields: [
      { key: 'pageId', label: 'Page ID', secret: false, placeholder: '1234567890' },
      { key: 'pageAccessToken', label: 'Page Access Token', secret: true, placeholder: 'long-lived page token' },
      { key: 'appId', label: 'App ID (optional)', secret: false, optional: true, placeholder: 'for token tools & data-deletion' },
      { key: 'appSecret', label: 'App Secret (optional)', secret: true, optional: true, placeholder: 'enables data-deletion signature check' },
      { key: 'threadsAppId', label: 'Threads App ID (optional)', secret: false, optional: true, placeholder: 'from Use cases → Threads → Settings (differs from App ID)' },
      { key: 'threadsAppSecret', label: 'Threads App Secret (optional)', secret: true, optional: true, placeholder: 'Threads-specific secret for the Connect-with-Threads flow' },
    ],
    setup: 'Create an app at developers.facebook.com → add the "Facebook Login" + "Pages" products. Generate a Page access token with `pages_manage_posts` and `pages_read_engagement` scopes (use Graph API Explorer, then exchange for a long-lived token). Page ID is on your Page → About.',
    portal: 'https://developers.facebook.com/apps/',
    async verify({ creds }) {
      const r = await fetch(`https://graph.facebook.com/v21.0/${creds.pageId}?fields=name,id&access_token=${encodeURIComponent(creds.pageAccessToken)}`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw metaError(j, r.status, 'verify');
      return { ok: true, profile: { name: j.name, url: `https://facebook.com/${j.id}` } };
    },
    async publish({ post, creds }) {
      if (!creds.pageId || !creds.pageAccessToken) throw new Error('Missing page id or token');
      const G = 'https://graph.facebook.com/v21.0';
      const msg = [post.body, post.link].filter(Boolean).join('\n\n');
      const img = (post.mediaUrls || [])[0];
      const isVid = isVideoUrl(img);
      let r, j, stage;
      if (img && isVid) {
        // Page video → /videos with a public file_url (Meta pulls it server-side).
        stage = 'video';
        r = await fetch(`${G}/${creds.pageId}/videos`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_url: img, description: msg, access_token: creds.pageAccessToken }),
          signal: AbortSignal.timeout(120000),
        });
      } else if (img) {
        stage = 'photo';
        r = await fetch(`${G}/${creds.pageId}/photos`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: img, caption: msg, access_token: creds.pageAccessToken }),
          signal: AbortSignal.timeout(25000),
        });
      } else {
        stage = 'feed';
        r = await fetch(`${G}/${creds.pageId}/feed`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, ...(post.link ? { link: post.link } : {}), access_token: creds.pageAccessToken }),
          signal: AbortSignal.timeout(25000),
        });
      }
      j = await r.json().catch(() => ({}));
      if (!r.ok) throw metaError(j, r.status, stage);
      const id = j.post_id || j.id;
      return { id, url: id ? `https://facebook.com/${id}` : undefined };
    },
  },

  // ── Instagram (Business/Creator linked to a FB Page) — Graph API, image required
  instagram: {
    key: 'instagram',
    name: 'Instagram',
    icon: '📷',
    color: '#E4405F',
    caps: { text: true, link: false, media: true, carousel: true, story: true },
    requiresMedia: true,
    fields: [
      { key: 'igUserId', label: 'IG User ID', secret: false, placeholder: '178414...' },
      { key: 'accessToken', label: 'Access Token', secret: true, placeholder: 'page/IG access token' },
    ],
    setup: 'Convert your Instagram to a Business/Creator account and link it to a Facebook Page. In your Meta app add "Instagram Graph API". Get the IG User ID via the Graph API. Token needs `instagram_content_publish` + `pages_read_engagement`. Posts REQUIRE a public image URL.',
    portal: 'https://developers.facebook.com/docs/instagram-api/getting-started',
    async verify({ creds }) {
      const r = await fetch(`https://graph.facebook.com/v21.0/${creds.igUserId}?fields=username&access_token=${encodeURIComponent(creds.accessToken)}`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw metaError(j, r.status, 'verify');
      return { ok: true, profile: { name: j.username, url: j.username ? `https://instagram.com/${j.username}` : undefined } };
    },
    async publish({ post, creds }) {
      if (!creds.igUserId || !creds.accessToken) throw new Error('Missing IG user id or token');
      const G = 'https://graph.facebook.com/v21.0';
      const token = creds.accessToken;
      const media = (post.mediaUrls || []).filter(Boolean);
      if (!media.length) throw new Error('Instagram requires an image or video — attach a public media URL');
      const caption = [post.body, post.link].filter(Boolean).join('\n\n');

      // Create ONE media container and wait until Meta finishes processing it.
      // `kind` selects the container flavour: standalone feed post ('single'),
      // a carousel child ('carouselItem'), or a story frame ('story'). Meta
      // processes BOTH image and video containers asynchronously — publishing
      // before status_code=FINISHED fails with "Media ID is not available"
      // (2207027) — so every container is polled here before it's used.
      const makeContainer = async (rawUrl, kind = 'single') => {
        const isVid = isVideoUrl(rawUrl);
        // Instagram rejects non-JPEG stills — transcode PNG/WebP to JPEG first.
        const url = isVid ? rawUrl : await ensureJpegForMeta(rawUrl);
        const body = { access_token: token };
        if (kind === 'story') {
          body.media_type = 'STORIES';
          if (isVid) body.video_url = url; else body.image_url = url;
        } else if (kind === 'carouselItem') {
          body.is_carousel_item = true;
          // Carousel video items use media_type=VIDEO (not REELS).
          if (isVid) { body.media_type = 'VIDEO'; body.video_url = url; } else body.image_url = url;
        } else {
          // Standalone feed post: single video → REELS; the caption rides here.
          if (isVid) { body.media_type = 'REELS'; body.video_url = url; } else body.image_url = url;
          body.caption = caption;
        }
        const cr = await fetch(`${G}/${creds.igUserId}/media`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
        });
        const cj = await cr.json().catch(() => ({}));
        if (!cr.ok || !cj.id) throw metaError(cj, cr.status, 'container');
        // Videos can take minutes; images are usually a few seconds, so poll faster.
        await pollMetaContainer(
          `${G}/${cj.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
          'status_code',
          isVid ? {} : { timeoutMs: 60000, intervalMs: 3000, firstDelayMs: 1500 },
        );
        return cj.id;
      };
      // publish container (retries the transient not-ready race, 2207027)
      const publishContainer = async (creationId) => {
        const pj = await metaPublishRetry(`${G}/${creds.igUserId}/media_publish`, { creation_id: creationId, access_token: token });
        return { id: pj.id };
      };

      // ── Carousel: 2–10 child containers → parent(media_type=CAROUSEL) → publish.
      // Caption lives on the parent only; `children` is a COMMA-SEPARATED STRING.
      if (post.format === 'carousel') {
        const items = media.slice(0, 10);
        if (items.length < 2) throw new Error('An Instagram carousel needs at least 2 items');
        const childIds = [];
        for (const u of items) childIds.push(await makeContainer(u, 'carouselItem'));
        const pr = await fetch(`${G}/${creds.igUserId}/media`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: token }),
          signal: AbortSignal.timeout(25000),
        });
        const pj = await pr.json().catch(() => ({}));
        if (!pr.ok || !pj.id) throw metaError(pj, pr.status, 'carousel container');
        await pollMetaContainer(
          `${G}/${pj.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
          'status_code', { timeoutMs: 60000, intervalMs: 3000, firstDelayMs: 1500 },
        );
        return await publishContainer(pj.id);
      }

      // ── Story: each media item is its own story frame, published in order.
      // (Stories count toward IG's 25-publishes/24h bucket — one per frame.)
      if (post.format === 'story') {
        const frames = media.slice(0, 10);
        let firstId = null;
        for (const u of frames) {
          const r = await publishContainer(await makeContainer(u, 'story'));
          if (!firstId) firstId = r.id;
        }
        return { id: firstId };
      }

      // ── Single feed post (default, unchanged behaviour).
      return await publishContainer(await makeContainer(media[0], 'single'));
    },
  },

  // ── LinkedIn — OAuth2 access token + author URN
  linkedin: {
    key: 'linkedin',
    name: 'LinkedIn',
    icon: '💼',
    color: '#0A66C2',
    caps: { text: true, link: true, media: true },
    fields: [
      { key: 'authorUrn', label: 'Author URN', secret: false, placeholder: 'urn:li:person:xxxx or urn:li:organization:xxxx' },
      { key: 'accessToken', label: 'Access Token', secret: true, placeholder: 'OAuth2 access token' },
      { key: 'clientId', label: 'Client ID (optional)', secret: false, optional: true, placeholder: 'from your LinkedIn app — enables token scope check' },
      { key: 'clientSecret', label: 'Client Secret (optional)', secret: true, optional: true, placeholder: 'enables token scope check' },
    ],
    setup: 'Create an app at linkedin.com/developers, request the "Share on LinkedIn" + "Sign In with LinkedIn" products. Get an OAuth2 access token with `w_member_social` scope. Author URN is `urn:li:person:{id}` (member) or `urn:li:organization:{id}` (company page). Note: member tokens expire ~60 days.',
    portal: 'https://www.linkedin.com/developers/apps',
    async verify({ creds }) {
      const r = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, profile: { name: j.name || j.given_name } };
      // 401 = the token itself is bad/expired/revoked → a genuine failure.
      if (r.status === 401) throw new Error((j.message || 'Unauthorized') + ' — access token is invalid or expired (401)');
      // 403 "Not enough permissions" = the token authenticated fine but lacks the
      // openid/profile scope userinfo requires. That's expected for a posting-only
      // token (w_member_social / w_organization_social), which is all publishing
      // needs — posting uses the Author URN directly. So the token IS valid.
      if (r.status === 403) return { ok: true, profile: null, note: 'Token accepted (posting scope only — profile read not granted)' };
      throw new Error(j.message || `HTTP ${r.status}`);
    },
    async publish({ post, creds }) {
      if (!creds.authorUrn || !creds.accessToken) throw new Error('Missing author URN or token');
      const text = [post.body, post.link].filter(Boolean).join('\n\n');
      const headers = {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      };
      // Attach images (LinkedIn allows up to 9). Videos use a separate, heavier
      // upload flow not implemented here — a video-only post still goes out as
      // text rather than failing silently.
      const imageUrls = (post.mediaUrls || []).filter(u => !isVideoUrl(u)).slice(0, 9);
      const media = [];
      for (const u of imageUrls) media.push({ status: 'READY', media: await linkedinUploadImage(u, creds) });

      const shareContent = { shareCommentary: { text }, shareMediaCategory: media.length ? 'IMAGE' : 'NONE' };
      if (media.length) shareContent.media = media;

      const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST', headers,
        body: JSON.stringify({
          author: creds.authorUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        let msg = j.message || `HTTP ${r.status}`;
        // The [/author] validation error means the token can't post AS this
        // author entity — almost always an organization URN posted with a
        // member-only token. Spell out the real requirement.
        if (/\/author/i.test(msg) || (r.status === 422 && /author/i.test(JSON.stringify(j)))) {
          const isOrg = /organization/i.test(creds.authorUrn || '');
          msg = isOrg
            ? `LinkedIn rejected the author (${creds.authorUrn}). Posting as a company page needs a token with the "w_organization_social" scope AND the authorizing user must be an ADMIN of that organization (Community Management API). Your current token can't post as this org.`
            : `LinkedIn rejected the author (${creds.authorUrn}). Check the URN matches the token's member — re-run "Fetch from token" to get the correct urn:li:person id.`;
        }
        throw new Error(msg);
      }
      const id = j.id || r.headers.get('x-restli-id');
      return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined };
    },
  },

  // ── X (Twitter) — OAuth2 user access token (tweet.write)
  x: {
    key: 'x',
    name: 'X (Twitter)',
    icon: '𝕏',
    color: '#000000',
    caps: { text: true, link: true, media: false },
    fields: [
      { key: 'accessToken', label: 'OAuth2 Access Token', secret: true, placeholder: 'user access token (tweet.write)' },
    ],
    setup: 'X requires a paid Developer account (developer.x.com, Basic tier ~$100/mo). Create a project + app, enable OAuth 2.0 with `tweet.write tweet.read users.read offline.access`, run the user OAuth flow and paste the access token. Tokens are short-lived — re-paste when posting fails with 401.',
    portal: 'https://developer.x.com/en/portal/dashboard',
    async verify({ creds }) {
      const r = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.detail || j.title || `HTTP ${r.status}`) + ' — token may be expired');
      return { ok: true, profile: { name: j.data?.username, url: j.data?.username ? `https://x.com/${j.data.username}` : undefined } };
    },
    async publish({ post, creds }) {
      if (!creds.accessToken) throw new Error('Missing access token');
      const text = [post.body, post.link].filter(Boolean).join('\n\n').slice(0, 280);
      const r = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || j.title || `HTTP ${r.status}`);
      const id = j.data?.id;
      return { id, url: id ? `https://x.com/i/web/status/${id}` : undefined };
    },
  },

  // ── Reddit — script app (client id/secret + username/password), posts to a subreddit
  reddit: {
    key: "reddit", name: "Reddit", icon: "🅡", color: "#FF4500",
    caps: { text: true, link: true, media: true },
    fields: [
      { key: "clientId", label: "Client ID", secret: false, placeholder: "under the app name at prefs/apps" },
      { key: "clientSecret", label: "Client Secret", secret: true, placeholder: "app secret" },
      { key: "username", label: "Reddit Username", secret: false, placeholder: "yourname (no u/)" },
      { key: "password", label: "Password", secret: true, placeholder: "account password" },
      { key: "subreddit", label: "Default Subreddit", secret: false, placeholder: "yourbrand (no r/)" },
    ],
    setup: "Create a \"script\" app at reddit.com/prefs/apps. Copy the Client ID (shown under the app name) and the secret. Use your Reddit username + password. Set a default subreddit you are allowed to post in. Posting uses the `submit` scope.",
    portal: "https://www.reddit.com/prefs/apps",
    async verify({ creds }) {
      const { token, ua } = await redditAccessToken(creds);
      const r = await fetch("https://oauth.reddit.com/api/v1/me", { headers: { Authorization: "Bearer " + token, "User-Agent": ua }, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("Reddit auth HTTP " + r.status);
      return { ok: true, profile: { name: j.name ? "u/" + j.name : creds.username, url: j.name ? "https://reddit.com/u/" + j.name : undefined } };
    },
    async publish({ post, creds }) {
      const sub = String(creds.subreddit || "").replace(/^\/?r\//, "").trim();
      if (!sub) throw new Error("Set a default subreddit to post to");
      const { token, ua } = await redditAccessToken(creds);
      const title = (post.headline || String(post.body || "").split("\n")[0] || "Update").slice(0, 300);
      const img = (post.mediaUrls || [])[0];
      const params = new URLSearchParams({ sr: sub, title, api_type: "json" });
      if (post.link || img) { params.set("kind", "link"); params.set("url", post.link || img); }
      else { params.set("kind", "self"); params.set("text", post.body || ""); }
      const r = await fetch("https://oauth.reddit.com/api/submit", {
        method: "POST", headers: { Authorization: "Bearer " + token, "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(), signal: AbortSignal.timeout(25000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("Reddit HTTP " + r.status);
      const errs = j?.json?.errors;
      if (errs && errs.length) throw new Error("Reddit: " + errs.map(e => e.join(" ")).join("; "));
      const d = j?.json?.data || {};
      return { id: d.name || d.id, url: d.url || (d.id ? "https://reddit.com/" + d.id : undefined) };
    },
  },

  // ── Coming soon (OAuth/video-heavy — registered so creds UI + roadmap show) ──
  threads: {
    key: 'threads',
    name: 'Threads',
    icon: '@',
    color: '#000000',
    caps: { text: true, link: true, media: true, carousel: true },
    fields: [
      { key: 'userId', label: 'Threads User ID', secret: false, placeholder: 'numeric Threads user id' },
      { key: 'accessToken', label: 'Access Token', secret: true, placeholder: 'Threads Graph API token' },
    ],
    setup: 'In your Meta app (same one as Facebook/Instagram) add the "Threads API" use case at developers.facebook.com → grant `threads_basic` + `threads_content_publish`, run the Threads OAuth flow, then copy your Threads user id and access token.',
    portal: 'https://developers.facebook.com/docs/threads/get-started',
    async verify({ creds }) {
      const r = await fetch(`https://graph.threads.net/v1.0/${creds.userId}?fields=username&access_token=${encodeURIComponent(creds.accessToken)}`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw metaError(j, r.status, 'verify');
      return { ok: true, profile: { name: j.username, url: j.username ? `https://threads.net/@${j.username}` : undefined } };
    },
    async publish({ post, creds }) {
      if (!creds.userId || !creds.accessToken) throw new Error('Missing Threads user id or token');
      const T = 'https://graph.threads.net/v1.0';
      const text = [post.body, post.link].filter(Boolean).join('\n\n');

      // ── Carousel: 2–10 child containers → parent(media_type=CAROUSEL) → publish.
      // Text rides on the parent only; `children` is a comma-separated string.
      if (post.format === 'carousel') {
        const items = (post.mediaUrls || []).filter(Boolean).slice(0, 10);
        if (items.length < 2) throw new Error('A Threads carousel needs at least 2 items');
        const childIds = [];
        for (const u of items) {
          const vid = isVideoUrl(u);
          const p = new URLSearchParams({ access_token: creds.accessToken, is_carousel_item: 'true' });
          if (vid) { p.set('media_type', 'VIDEO'); p.set('video_url', u); }
          else { p.set('media_type', 'IMAGE'); p.set('image_url', u); }
          const ccr = await fetch(`${T}/${creds.userId}/threads`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: p.toString(), signal: AbortSignal.timeout(25000),
          });
          const ccj = await ccr.json().catch(() => ({}));
          if (!ccr.ok || !ccj.id) throw metaError(ccj, ccr.status, 'container');
          // Video children process asynchronously — wait until FINISHED.
          if (vid) await pollMetaContainer(`${T}/${ccj.id}?fields=status&access_token=${encodeURIComponent(creds.accessToken)}`, 'status');
          childIds.push(ccj.id);
        }
        const pp = new URLSearchParams({ access_token: creds.accessToken, media_type: 'CAROUSEL', children: childIds.join(',') });
        if (text) pp.set('text', text);
        const pcr = await fetch(`${T}/${creds.userId}/threads`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: pp.toString(), signal: AbortSignal.timeout(25000),
        });
        const pcj = await pcr.json().catch(() => ({}));
        if (!pcr.ok || !pcj.id) throw metaError(pcj, pcr.status, 'carousel container');
        const cpr = await fetch(`${T}/${creds.userId}/threads_publish`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ creation_id: pcj.id, access_token: creds.accessToken }).toString(),
          signal: AbortSignal.timeout(25000),
        });
        const cpj = await cpr.json().catch(() => ({}));
        if (!cpr.ok || !cpj.id) throw metaError(cpj, cpr.status, 'publish');
        return { id: cpj.id };
      }

      const img = (post.mediaUrls || [])[0];
      const isVid = isVideoUrl(img);
      // 1. create media container
      const params = new URLSearchParams({ access_token: creds.accessToken });
      if (img && isVid) { params.set('media_type', 'VIDEO'); params.set('video_url', img); if (text) params.set('text', text); }
      else if (img) { params.set('media_type', 'IMAGE'); params.set('image_url', img); if (text) params.set('text', text); }
      else { params.set('media_type', 'TEXT'); params.set('text', text); }
      const cr = await fetch(`${T}/${creds.userId}/threads`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(), signal: AbortSignal.timeout(25000),
      });
      const cj = await cr.json().catch(() => ({}));
      if (!cr.ok || !cj.id) throw metaError(cj, cr.status, 'container');
      // 1b. video containers process asynchronously — wait until FINISHED.
      if (isVid) await pollMetaContainer(`${T}/${cj.id}?fields=status&access_token=${encodeURIComponent(creds.accessToken)}`, 'status');
      // 2. publish container
      const pr = await fetch(`${T}/${creds.userId}/threads_publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: cj.id, access_token: creds.accessToken }).toString(),
        signal: AbortSignal.timeout(25000),
      });
      const pj = await pr.json().catch(() => ({}));
      if (!pr.ok || !pj.id) throw metaError(pj, pr.status, 'publish');
      return { id: pj.id };
    },
  },
  // ── Google Business Profile — Local Posts API (OAuth2 refresh token) ─────────
  googlebusiness: {
    key: 'googlebusiness',
    name: 'Google Business',
    icon: 'G',
    color: '#4285F4',
    caps: { text: true, link: true, media: true },
    fields: [
      { key: 'accountId', label: 'GBP Account ID', secret: false, placeholder: 'the <id> from accounts/<id>' },
      { key: 'locationId', label: 'Location ID', secret: false, placeholder: 'the <id> from locations/<id>' },
      { key: 'clientId', label: 'OAuth Client ID', secret: false, placeholder: 'xxx.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'OAuth Client Secret', secret: true },
      { key: 'refreshToken', label: 'OAuth Refresh Token', secret: true, placeholder: 'from business.manage consent' },
    ],
    setup: 'Create a Google Cloud project, enable the Business Profile APIs, and REQUEST API access (Google gates it — new projects get 403 until approved). Create an OAuth client and run consent with scope https://www.googleapis.com/auth/business.manage to obtain a refresh token. Get the Account + Location IDs from the accounts.locations list (use only the numeric id parts).',
    portal: 'https://developers.google.com/my-business',
    async verify({ creds }) {
      if (looksLikePlaceId(creds.locationId)) throw new Error(`Location ID "${creds.locationId}" is a Google Maps Place ID, not a Business Profile Location ID. Set it to the numeric location id from your Business Profile (accounts/<id>/locations/<this>).`);
      const token = await googleAccessToken(creds);
      const r = await fetch(`https://mybusiness.googleapis.com/v4/accounts/${creds.accountId}/locations/${creds.locationId}/localPosts?pageSize=1`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(googleApiError(j, r.status, 'Google verify failed'));
      return { ok: true, profile: { name: `Location ${creds.locationId}` } };
    },
    async publish({ post, creds }) {
      if (!creds.accountId || !creds.locationId || !creds.refreshToken) throw new Error('Missing Google Business account/location/refresh token');
      if (looksLikePlaceId(creds.locationId)) throw new Error(`Location ID "${creds.locationId}" is a Google Maps Place ID, not a Business Profile Location ID. In Connections → Google Business, set Location ID to the numeric id from your Business Profile (accounts/<id>/locations/<this>), then retry.`);
      const summary = (post.body || '').trim().slice(0, 1500);
      if (!summary) throw new Error('Google Business posts require caption text — add a summary/body before posting.');
      const token = await googleAccessToken(creds);
      const img = (post.mediaUrls || [])[0];
      // Google Business local posts only accept PHOTO media — a video sourceUrl
      // gets rejected with INVALID_ARGUMENT, so omit it and post text + CTA.
      const photo = img && !isVideoUrl(img) ? img : null;
      const ctaUrl = normalizeHttpUrl(post.link);
      const body = {
        languageCode: 'en-US',
        summary,
        topicType: 'STANDARD',
        ...(photo ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: photo }] } : {}),
        ...(ctaUrl ? { callToAction: { actionType: 'LEARN_MORE', url: ctaUrl } } : {}),
      };
      const r = await fetch(`https://mybusiness.googleapis.com/v4/accounts/${creds.accountId}/locations/${creds.locationId}/localPosts`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(googleApiError(j, r.status, 'Google post failed'));
      return { id: j.name, url: j.searchUrl };
    },
  },
  youtube: {
    key: 'youtube', name: 'YouTube', icon: '▶', color: '#FF0000',
    // connectOnly: credentials can be entered / OAuth-connected / verified now,
    // but YouTube is NOT yet a compose/publish target (video-upload publishing is
    // on the roadmap). It reuses the Google Business OAuth client — same Cloud
    // project, just enable the YouTube Data API.
    caps: { text: true, media: true }, connectOnly: true,
    fields: [
      { key: 'channelId', label: 'Channel ID', secret: false, placeholder: 'UC… (auto-filled on Connect)' },
      { key: 'refreshToken', label: 'OAuth Refresh Token', secret: true, placeholder: 'from Connect with Google' },
    ],
    setup: 'Reuses your Google Business OAuth client — just enable the YouTube Data API v3 in the same Google Cloud project, then click "Connect with Google". Video-upload publishing is on the roadmap.',
    async verify({ creds }) {
      if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) throw new Error('Connect with Google first (reuses your Google Business OAuth client).');
      const token = await googleAccessToken(creds);
      const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(googleApiError(j, r.status, 'YouTube verify failed'));
      const ch = j.items?.[0];
      return { ok: true, profile: { name: ch?.snippet?.title || 'YouTube channel', url: ch?.id ? `https://youtube.com/channel/${ch.id}` : undefined } };
    },
  },
  tiktok: {
    key: 'tiktok', name: 'TikTok', icon: '♪', color: '#000000',
    caps: { text: true, media: true }, comingSoon: true,
    fields: [
      { key: 'openId', label: 'Open ID', secret: false },
      { key: 'accessToken', label: 'Access Token', secret: true },
    ],
    setup: 'TikTok for Developers → Content Posting API (requires app review). Support is on the roadmap.',
  },
  pinterest: {
    key: 'pinterest', name: 'Pinterest', icon: '📌', color: '#E60023',
    caps: { text: true, link: true, media: true }, requiresMedia: true, comingSoon: true,
    fields: [
      { key: 'boardId', label: 'Board ID', secret: false },
      { key: 'accessToken', label: 'Access Token', secret: true },
    ],
    setup: 'Pinterest Developers app + OAuth2 (`pins:write`). Support is on the roadmap.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SETUP HELPERS — per-platform deep-links ("redirect buttons") to where each
// credential is actually issued, in that platform's OWN developer console /
// token tool, plus fallback setup instructions for platforms that lack one.
// These are purely informational: they open the vendor's site in a new tab so
// an admin can grab the value and paste it into the field. No OAuth/login flow.
// `links` is attached onto each PLATFORMS entry and rendered in the Connections
// UI; `setup` is only applied when the platform doesn't already define its own.
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORM_SETUP_META = {
  mastodon: {
    links: [
      { label: 'Create app', url: 'https://docs.joinmastodon.org/client/token/' },
      { label: 'API docs', url: 'https://docs.joinmastodon.org/methods/statuses/' },
    ],
    setup: 'On your Mastodon instance: Preferences → Development → New application, grant the `write:statuses` scope, then copy the access token. Instance URL is your server (e.g. https://mastodon.social).',
  },
  bluesky: {
    links: [
      { label: 'App passwords', url: 'https://bsky.app/settings/app-passwords' },
      { label: 'AT Protocol docs', url: 'https://docs.bsky.app/' },
    ],
    setup: 'Handle is your full Bluesky handle (e.g. you.bsky.social). Create a dedicated App Password under Settings → App Passwords — never your main password. Service defaults to https://bsky.social.',
  },
  discord: {
    links: [
      { label: 'Webhook guide', url: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks' },
      { label: 'Developer portal', url: 'https://discord.com/developers/applications' },
    ],
    setup: 'In your Discord server: Channel → Edit → Integrations → Webhooks → New Webhook → Copy Webhook URL. Posts are delivered to that channel.',
  },
  telegram: {
    links: [
      { label: 'Open BotFather', url: 'https://t.me/BotFather' },
      { label: 'Bot API docs', url: 'https://core.telegram.org/bots/api' },
    ],
    setup: 'Message @BotFather → /newbot to get a Bot Token. Add the bot to your channel/group as an admin. Chat ID is @yourchannel (public) or the numeric -100… id (private).',
  },
  facebook: {
    links: [
      { label: 'Developer apps', url: 'https://developers.facebook.com/apps' },
      { label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer/' },
      { label: 'Page token guide', url: 'https://developers.facebook.com/docs/pages/access-tokens' },
    ],
    setup: 'Create an app at developers.facebook.com → add Facebook Login and request `pages_manage_posts` + `pages_read_engagement`. In Graph API Explorer select your Page and generate a Page Access Token (extend it to a long-lived token). Page ID is on your Page → About.',
  },
  instagram: {
    links: [
      { label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer/' },
      { label: 'IG publishing docs', url: 'https://developers.facebook.com/docs/instagram-api/guides/content-publishing/' },
    ],
    setup: 'Requires an Instagram Business/Creator account linked to a Facebook Page (same Meta app as Facebook). Grant `instagram_basic` + `instagram_content_publish`. Get the IG User ID from the linked page (…?fields=instagram_business_account). Uses the same page/IG access token.',
  },
  linkedin: {
    links: [
      { label: 'Developer apps', url: 'https://www.linkedin.com/developers/apps' },
      { label: 'Token generator', url: 'https://www.linkedin.com/developers/tools/oauth/token-generator' },
      { label: 'Marketing API docs', url: 'https://learn.microsoft.com/linkedin/marketing/' },
    ],
  },
  x: {
    links: [
      { label: 'Developer portal', url: 'https://developer.x.com/en/portal/dashboard' },
      { label: 'Post API docs', url: 'https://docs.x.com/x-api/posts/creation-of-a-post' },
    ],
  },
  reddit: {
    links: [
      { label: 'Create app', url: 'https://www.reddit.com/prefs/apps' },
      { label: 'API docs', url: 'https://www.reddit.com/dev/api/' },
    ],
    setup: "Create a 'script' app at reddit.com/prefs/apps → the client ID is under the app name, the secret is next to it. Username/password are the posting account's own. Subreddit is the target (without the r/).",
  },
  threads: {
    links: [
      { label: 'Developer apps', url: 'https://developers.facebook.com/apps' },
      { label: 'Threads API docs', url: 'https://developers.facebook.com/docs/threads' },
    ],
  },
  googlebusiness: {
    links: [
      { label: 'Google Cloud Console', url: 'https://console.cloud.google.com/apis/dashboard' },
      { label: 'OAuth Playground', url: 'https://developers.google.com/oauthplayground' },
      { label: 'Business Profile API', url: 'https://developers.google.com/my-business' },
    ],
  },
  youtube: {
    links: [
      { label: 'Enable YouTube API', url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
      { label: 'OAuth Playground', url: 'https://developers.google.com/oauthplayground' },
      { label: 'Data API docs', url: 'https://developers.google.com/youtube/v3' },
    ],
  },
  tiktok: {
    links: [
      { label: 'Developer portal', url: 'https://developers.tiktok.com/' },
      { label: 'Content Posting API', url: 'https://developers.tiktok.com/doc/content-posting-api-get-started/' },
    ],
    setup: 'Register at developers.tiktok.com, create an app with the Content Posting API, complete the audit, and run the OAuth flow for the open_id + access token. (Support is on the roadmap.)',
  },
  pinterest: {
    links: [
      { label: 'Developer apps', url: 'https://developers.pinterest.com/apps/' },
      { label: 'API v5 docs', url: 'https://developers.pinterest.com/docs/api/v5/' },
    ],
  },
};

// Attach setup links (and any fallback instructions) onto the live registry so
// PLATFORM_LIST / LIVE_PLATFORMS expose them to the Connections view.
for (const [key, meta] of Object.entries(PLATFORM_SETUP_META)) {
  const p = PLATFORMS[key];
  if (!p) continue;
  if (meta.links) p.links = meta.links;
  if (meta.setup && !p.setup) p.setup = meta.setup;
}

export const PLATFORM_LIST = Object.values(PLATFORMS);
// LIVE_PLATFORMS drives the compose pills & publish targets — connect-only
// platforms (e.g. YouTube: connectable but no publish adapter yet) are excluded.
export const LIVE_PLATFORMS = PLATFORM_LIST.filter(p => !p.comingSoon && !p.connectOnly);

// ─────────────────────────────────────────────────────────────────────────────
// CREDENTIAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Split an incoming form body into { credentials (public), secrets (encrypted) }
// for a platform. Secret fields equal to the masked placeholder are left untouched.
export function packCredentials(platformKey, body, existing = {}) {
  const def = PLATFORMS[platformKey];
  if (!def) throw new Error('Unknown platform: ' + platformKey);
  const credentials = { ...(existing.credentials || {}) };
  const secrets = { ...(existing.secrets || {}) };
  for (const f of def.fields) {
    const raw = body[f.key];
    if (raw === undefined) continue;
    const val = String(raw).trim();
    if (f.secret) {
      // "Leave blank to keep": a stored secret is NEVER overwritten or deleted by
      // an empty field or by a value made only of mask glyphs (the UI shows dots
      // as a placeholder and users sometimes retype them — •, ·, ● in either
      // Unicode form). Only a real, non-mask value updates the encrypted secret.
      // Removal is done via Disconnect, not by blanking a field.
      const isMaskOnly = val === '' || /^[•·●∙・]+$/.test(val);
      if (!isMaskOnly) secrets[f.key] = encrypt(val);
    } else {
      credentials[f.key] = val;
    }
  }
  return { credentials, secrets };
}

// Decrypt a stored account into a flat { fieldKey: value } creds object for adapters.
export function unpackCredentials(account) {
  const creds = { ...(account.credentials || {}) };
  for (const [k, blob] of Object.entries(account.secrets || {})) {
    try { creds[k] = decrypt(blob); } catch { /* leave undefined on bad blob */ }
  }
  return creds;
}

// Is an account fully configured (all required fields present)?
export function isAccountConfigured(account) {
  const def = PLATFORMS[account?.platform];
  if (!def) return false;
  return def.fields.filter(f => !f.optional).every(f => f.secret ? !!account.secrets?.[f.key] : !!account.credentials?.[f.key]);
}

// Mask an account for safe rendering — secrets become booleans, never values.
export function maskAccount(account) {
  const def = PLATFORMS[account.platform] || {};
  const out = {
    platform: account.platform,
    enabled: account.enabled !== false,
    label: account.label || def.name || account.platform,
    profile: account.profile || {},
    credentials: { ...(account.credentials || {}) },
    secretsSet: {},
    configured: isAccountConfigured(account),
    lastTestOk: account.lastTestOk ?? null,
    lastTestAt: account.lastTestAt || null,
    connectedAt: account.connectedAt || null,
    tokenManaged: account.tokenManaged === true,
    tokenType: account.tokenType || null,
    tokenExpiresAt: account.tokenExpiresAt || null,
    liveEnabled: account.liveEnabled === true,
  };
  for (const f of (def.fields || [])) {
    if (f.secret) out.secretsSet[f.key] = !!account.secrets?.[f.key];
  }
  return out;
}

// ── Public "follow us" links ─────────────────────────────────────────────────
// Derive a public profile URL for a configured account so the tenant footer can
// show a "connect with us" icon per linked platform. Prefers the stored
// profile.url (captured on Test/connect); otherwise derives one from the public
// credentials. Returns null when the platform exposes no public profile (e.g. a
// Discord webhook) or isn't publishable yet.
function derivePublicUrl(account) {
  const p = account.platform;
  const c = account.credentials || {};
  const prof = account.profile || {};
  if (prof.url) return prof.url;
  const handle = (prof.name || '').replace(/^@/, '').replace(/^u\//, '');
  switch (p) {
    case 'facebook':  return c.pageId ? `https://facebook.com/${c.pageId}` : null;
    case 'instagram': return handle ? `https://instagram.com/${handle}` : null;
    case 'threads':   return handle ? `https://threads.net/@${handle}` : null;
    case 'x':         return handle ? `https://x.com/${handle}` : null;
    case 'bluesky':   return c.identifier ? `https://bsky.app/profile/${c.identifier}` : null;
    case 'reddit':    return c.username ? `https://reddit.com/u/${c.username}` : null;
    case 'youtube':   return c.channelId ? `https://youtube.com/channel/${c.channelId}` : null;
    case 'telegram':  return (c.chatId && c.chatId.startsWith('@')) ? `https://t.me/${c.chatId.slice(1)}` : null;
    case 'mastodon':  return null; // only via profile.url (instance-specific)
    default:          return null; // linkedin URN / discord webhook / etc.
  }
}

// Public social links for the tenant footer — one entry per configured account
// that has a resolvable public profile URL. { key, name, icon, url }.
export async function getPublicSocialLinks(db) {
  const accounts = await db.collection('social_accounts').find({}).toArray();
  const out = [];
  for (const a of accounts) {
    const def = PLATFORMS[a.platform];
    if (!def || def.comingSoon || !isAccountConfigured(a)) continue;
    if (a.enabled === false) continue;
    const url = derivePublicUrl(a);
    if (!url) continue;
    out.push({ key: a.platform, name: def.name, icon: def.icon, url });
  }
  return out;
}

// ── Meta cross-surface discovery ─────────────────────────────────────────────
// One Meta app powers Facebook, Instagram & Threads. Given the Facebook Page
// creds, find the Instagram Business/Creator account linked to that Page so the
// admin never has to hunt for the numeric IG User ID by hand. Read-only Graph
// call. Returns { igUserId, username } or null when none is linked / call fails.
export async function discoverInstagramFromPage({ pageId, pageAccessToken } = {}) {
  if (!pageId || !pageAccessToken) return null;
  const r = await fetch(
    `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account{id,username,name}&access_token=${encodeURIComponent(pageAccessToken)}`,
    { signal: AbortSignal.timeout(15000) },
  );
  const j = await r.json().catch(() => ({}));
  const iba = j?.instagram_business_account;
  if (!r.ok || !iba?.id) return null;
  return { igUserId: String(iba.id), username: iba.username || iba.name || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH
// ─────────────────────────────────────────────────────────────────────────────

// Verify an account's credentials with a read-only API call (no posting).
// Returns { ok, profile?, error?, note? }.
export async function verifyPlatform(platformKey, account) {
  const def = PLATFORMS[platformKey];
  if (!def) return { ok: false, error: 'Unknown platform' };
  if (def.comingSoon) return { ok: false, error: `${def.name} is not available yet` };
  if (!account || !isAccountConfigured(account)) return { ok: false, error: 'Missing credentials' };
  if (typeof def.verify !== 'function') {
    return { ok: true, note: 'Credentials saved (no live check for this platform)' };
  }
  try {
    const creds = unpackCredentials(account);
    const out = await def.verify({ creds });
    return { ok: true, profile: out?.profile || null, note: out?.profile?.name ? `Connected as ${out.profile.name}` : 'Connection verified' };
  } catch (err) {
    return { ok: false, error: err.message || 'Verification failed' };
  }
}

// Does this platform support the given post format ('single' | 'carousel' | 'story')?
// 'single' (or unset) is always supported; carousel/story are gated on caps so the
// compose UI and the publish path only ever offer a format to platforms that can do it.
export function platformSupportsFormat(platformKey, format) {
  if (!format || format === 'single') return true;
  const caps = PLATFORMS[platformKey]?.caps || {};
  if (format === 'carousel') return !!caps.carousel;
  if (format === 'story') return !!caps.story;
  return false;
}

// Publish one post to one platform. Returns { platform, ok, id?, url?, error?, at }.
export async function publishToPlatform(platformKey, post, account) {
  const def = PLATFORMS[platformKey];
  const at = new Date();
  if (!def) return { platform: platformKey, ok: false, error: 'Unknown platform', at };
  if (def.comingSoon || typeof def.publish !== 'function') {
    return { platform: platformKey, ok: false, error: `${def.name} publishing is not available yet`, at };
  }
  if (post.format && post.format !== 'single' && !platformSupportsFormat(platformKey, post.format)) {
    return { platform: platformKey, ok: false, error: `${def.name} does not support ${post.format} posts`, at };
  }
  if (!account || account.enabled === false) {
    return { platform: platformKey, ok: false, error: 'Account not connected', at };
  }
  if (!isAccountConfigured(account)) {
    return { platform: platformKey, ok: false, error: 'Account is missing credentials', at };
  }
  try {
    const creds = unpackCredentials(account);
    const result = await def.publish({ post, creds });
    return { platform: platformKey, ok: true, id: result?.id || null, url: result?.url || null, at: new Date() };
  } catch (err) {
    return { platform: platformKey, ok: false, error: err.message || 'Publish failed', at: new Date() };
  }
}

// Publish a post document to all of its target platforms.
// `accountsByPlatform` is a map { platformKey: accountDoc }. Returns the results array.
export async function publishPost(post, accountsByPlatform) {
  const targets = (post.platforms || []).filter(p => PLATFORMS[p] && !PLATFORMS[p].comingSoon && !PLATFORMS[p].connectOnly);
  const results = [];
  for (const p of targets) {
    results.push(await publishToPlatform(p, post, accountsByPlatform[p]));
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT RESOURCE SLOTS — static per-channel brand assets (avatar, banner, …)
//
// Each platform declares the STATIC image slots that make up its account's look:
// a profile picture, a cover/banner, etc. These are NOT posts — they're the
// standing brand furniture of the channel. Slot shape:
//   { key, label, w, h, shape:'square'|'circle', push?:true }
// `push:true` means we have an adapter that can set it live via the platform's
// API (pushResource below). Slots without it are record-only: Slab tracks the
// assignment + recommended size, and the admin applies it in the platform's UI.
// `w`/`h` are the platform's RECOMMENDED upload dimensions (shown as guidance).
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORM_RESOURCE_SLOTS = {
  facebook: [
    { key: 'avatar', label: 'Profile Picture', w: 320, h: 320, shape: 'circle' },
    { key: 'cover', label: 'Cover Photo', w: 820, h: 312 },
  ],
  instagram: [
    { key: 'avatar', label: 'Profile Picture', w: 320, h: 320, shape: 'circle' },
  ],
  threads: [
    { key: 'avatar', label: 'Profile Picture', w: 320, h: 320, shape: 'circle' },
  ],
  x: [
    { key: 'avatar', label: 'Profile Photo', w: 400, h: 400, shape: 'circle' },
    { key: 'header', label: 'Header', w: 1500, h: 500 },
  ],
  linkedin: [
    { key: 'avatar', label: 'Logo / Photo', w: 400, h: 400, shape: 'circle' },
    { key: 'cover', label: 'Cover / Banner', w: 1584, h: 396 },
  ],
  youtube: [
    { key: 'avatar', label: 'Channel Icon', w: 800, h: 800, shape: 'circle' },
    { key: 'banner', label: 'Channel Art', w: 2560, h: 1440 },
  ],
  googlebusiness: [
    { key: 'logo', label: 'Logo', w: 720, h: 720 },
    { key: 'cover', label: 'Cover Photo', w: 1024, h: 576 },
  ],
  reddit: [
    { key: 'avatar', label: 'Avatar', w: 256, h: 256, shape: 'circle' },
    { key: 'banner', label: 'Banner', w: 1920, h: 384 },
  ],
  pinterest: [
    { key: 'avatar', label: 'Profile Picture', w: 280, h: 280, shape: 'circle' },
  ],
  // Push-capable platforms — assignment applies live via the API (see pushResource).
  mastodon: [
    { key: 'avatar', label: 'Avatar', w: 400, h: 400, shape: 'circle', push: true },
    { key: 'header', label: 'Header', w: 1500, h: 500, push: true },
  ],
  bluesky: [
    { key: 'avatar', label: 'Avatar', w: 1000, h: 1000, shape: 'circle', push: true },
    { key: 'banner', label: 'Banner', w: 3000, h: 1000, push: true },
  ],
  discord: [
    { key: 'avatar', label: 'Webhook Avatar', w: 512, h: 512, shape: 'circle', push: true },
  ],
  telegram: [
    { key: 'photo', label: 'Channel Photo', w: 512, h: 512, shape: 'circle', push: true },
  ],
};

// Attach resourceSlots onto the live registry so PLATFORM_LIST carries them.
for (const [key, slots] of Object.entries(PLATFORM_RESOURCE_SLOTS)) {
  if (PLATFORMS[key]) PLATFORMS[key].resourceSlots = slots;
}

// Public helpers for the Account Resources UI/routes.
export function resourceSlotsFor(platformKey) {
  return PLATFORM_RESOURCE_SLOTS[platformKey] || [];
}
export function findResourceSlot(platformKey, slotKey) {
  return (PLATFORM_RESOURCE_SLOTS[platformKey] || []).find(s => s.key === slotKey) || null;
}
export function slotSupportsPush(platformKey, slotKey) {
  return !!findResourceSlot(platformKey, slotKey)?.push;
}

// ── Live push adapters ───────────────────────────────────────────────────────
// Set a platform's static resource (avatar/banner/…) live via its API, from a
// public image URL. Only implemented where the platform actually exposes it.
// `creds` is the DECRYPTED credential object (unpackCredentials). Returns
// { ok, note? } on success or throws with a human-readable reason.

async function pushMastodonResource(slotKey, imageUrl, creds) {
  const base = (creds.instanceUrl || '').replace(/\/+$/, '');
  if (!base || !creds.accessToken) throw new Error('Missing Mastodon instance URL or access token');
  const field = slotKey === 'header' ? 'header' : 'avatar';
  const { buffer, contentType } = await fetchMedia(imageUrl);
  const fd = new FormData();
  fd.append(field, new Blob([buffer], { type: contentType || 'image/png' }), `${field}.png`);
  const r = await fetch(`${base}/api/v1/accounts/update_credentials`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${creds.accessToken}` }, body: fd,
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Mastodon HTTP ${r.status} — the token needs the write:accounts scope`);
  return { ok: true, note: `Mastodon ${field} updated` };
}

async function pushBlueskyResource(slotKey, imageUrl, creds) {
  const svc = (creds.service || 'https://bsky.social').replace(/\/+$/, '');
  if (!creds.identifier || !creds.appPassword) throw new Error('Missing Bluesky handle or app password');
  const sess = await fetch(`${svc}/xrpc/com.atproto.server.createSession`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: creds.identifier, password: creds.appPassword }),
    signal: AbortSignal.timeout(20000),
  });
  const sj = await sess.json().catch(() => ({}));
  if (!sess.ok) throw new Error(sj.message || `Bluesky auth HTTP ${sess.status}`);
  const auth = { Authorization: `Bearer ${sj.accessJwt}` };

  const { buffer, contentType } = await fetchMedia(imageUrl);
  if (buffer.length > 1000000) throw new Error('Bluesky caps profile images at ~1MB — use a smaller file');
  const up = await fetch(`${svc}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST', headers: { ...auth, 'Content-Type': contentType || 'image/png' },
    body: buffer, signal: AbortSignal.timeout(30000),
  });
  const uj = await up.json().catch(() => ({}));
  if (!up.ok || !uj.blob) throw new Error(uj.message || 'Bluesky blob upload failed');

  // Preserve the profile's other fields — fetch the existing record, then merge.
  let existing = {};
  try {
    const gr = await fetch(`${svc}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(sj.did)}&collection=app.bsky.actor.profile&rkey=self`, { headers: auth, signal: AbortSignal.timeout(15000) });
    const gj = await gr.json().catch(() => ({}));
    if (gr.ok && gj.value) existing = gj.value;
  } catch { /* first-time profile — start clean */ }

  const field = slotKey === 'banner' ? 'banner' : 'avatar';
  const record = { ...existing, $type: 'app.bsky.actor.profile', [field]: uj.blob };
  const put = await fetch(`${svc}/xrpc/com.atproto.repo.putRecord`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: sj.did, collection: 'app.bsky.actor.profile', rkey: 'self', record }),
    signal: AbortSignal.timeout(20000),
  });
  const pj = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(pj.message || `Bluesky profile update HTTP ${put.status}`);
  return { ok: true, note: `Bluesky ${field} updated` };
}

async function pushDiscordResource(_slotKey, imageUrl, creds) {
  if (!creds.webhookUrl) throw new Error('Missing Discord webhook URL');
  const { buffer, contentType } = await fetchMedia(imageUrl);
  const dataUri = `data:${contentType || 'image/png'};base64,${buffer.toString('base64')}`;
  const r = await fetch(creds.webhookUrl, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar: dataUri }), signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.message || `Discord HTTP ${r.status}`);
  }
  return { ok: true, note: 'Discord webhook avatar updated' };
}

async function pushTelegramResource(_slotKey, imageUrl, creds) {
  if (!creds.botToken || !creds.chatId) throw new Error('Missing Telegram bot token or chat id');
  const { buffer, contentType } = await fetchMedia(imageUrl);
  const fd = new FormData();
  fd.append('chat_id', String(creds.chatId));
  fd.append('photo', new Blob([buffer], { type: contentType || 'image/png' }), 'photo.png');
  const r = await fetch(`https://api.telegram.org/bot${creds.botToken}/setChatPhoto`, {
    method: 'POST', body: fd, signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || `Telegram HTTP ${r.status} — the bot must be an admin of the channel`);
  return { ok: true, note: 'Telegram channel photo updated' };
}

// Dispatch a live resource push. Throws for record-only platforms/slots.
export async function pushResource({ platform, slot, imageUrl, creds }) {
  if (!imageUrl) throw new Error('No image to push');
  if (!slotSupportsPush(platform, slot)) {
    throw new Error(`${PLATFORMS[platform]?.name || platform} doesn't support setting its ${slot} via API — set it in the app.`);
  }
  switch (platform) {
    case 'mastodon': return pushMastodonResource(slot, imageUrl, creds);
    case 'bluesky':  return pushBlueskyResource(slot, imageUrl, creds);
    case 'discord':  return pushDiscordResource(slot, imageUrl, creds);
    case 'telegram': return pushTelegramResource(slot, imageUrl, creds);
    default: throw new Error(`No push adapter for ${platform}`);
  }
}
