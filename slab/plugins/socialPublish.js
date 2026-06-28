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
async function pollMetaContainer(statusUrl, field, { timeoutMs = 150000, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const r = await fetch(statusUrl, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    last = j[field] || last;
    if (last === 'FINISHED') return;
    if (last === 'ERROR' || last === 'EXPIRED') throw new Error(`video processing ${last}${j.error_message ? ': ' + j.error_message : ''}`);
  }
  throw new Error(`video still processing after ${Math.round(timeoutMs / 1000)}s — try again shortly`);
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
    caps: { text: true, link: false, media: true },
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
      const img = (post.mediaUrls || [])[0];
      if (!img) throw new Error('Instagram requires an image or video — attach a public media URL');
      const isVid = isVideoUrl(img);
      const G = 'https://graph.facebook.com/v21.0';
      const caption = [post.body, post.link].filter(Boolean).join('\n\n');
      // 1. create container — video posts go up as REELS with a video_url.
      const containerBody = isVid
        ? { media_type: 'REELS', video_url: img, caption, access_token: creds.accessToken }
        : { image_url: img, caption, access_token: creds.accessToken };
      const cr = await fetch(`${G}/${creds.igUserId}/media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerBody),
        signal: AbortSignal.timeout(25000),
      });
      const cj = await cr.json().catch(() => ({}));
      if (!cr.ok || !cj.id) throw metaError(cj, cr.status, 'container');
      // 1b. video containers process asynchronously — wait for FINISHED.
      if (isVid) await pollMetaContainer(`${G}/${cj.id}?fields=status_code&access_token=${encodeURIComponent(creds.accessToken)}`, 'status_code');
      // 2. publish container
      const pr = await fetch(`${G}/${creds.igUserId}/media_publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: cj.id, access_token: creds.accessToken }),
        signal: AbortSignal.timeout(25000),
      });
      const pj = await pr.json().catch(() => ({}));
      if (!pr.ok || !pj.id) throw metaError(pj, pr.status, 'publish');
      return { id: pj.id };
    },
  },

  // ── LinkedIn — OAuth2 access token + author URN
  linkedin: {
    key: 'linkedin',
    name: 'LinkedIn',
    icon: '💼',
    color: '#0A66C2',
    caps: { text: true, link: true, media: false },
    fields: [
      { key: 'authorUrn', label: 'Author URN', secret: false, placeholder: 'urn:li:person:xxxx or urn:li:organization:xxxx' },
      { key: 'accessToken', label: 'Access Token', secret: true, placeholder: 'OAuth2 access token' },
    ],
    setup: 'Create an app at linkedin.com/developers, request the "Share on LinkedIn" + "Sign In with LinkedIn" products. Get an OAuth2 access token with `w_member_social` scope. Author URN is `urn:li:person:{id}` (member) or `urn:li:organization:{id}` (company page). Note: member tokens expire ~60 days.',
    portal: 'https://www.linkedin.com/developers/apps',
    async verify({ creds }) {
      const r = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.message || `HTTP ${r.status}`) + ' — token may be expired');
      return { ok: true, profile: { name: j.name || j.given_name } };
    },
    async publish({ post, creds }) {
      if (!creds.authorUrn || !creds.accessToken) throw new Error('Missing author URN or token');
      const text = [post.body, post.link].filter(Boolean).join('\n\n');
      const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author: creds.authorUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text },
              shareMediaCategory: 'NONE',
            },
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        }),
        signal: AbortSignal.timeout(25000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
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
    caps: { text: true, link: true, media: true },
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
    caps: { text: true, media: true }, comingSoon: true,
    fields: [
      { key: 'channelId', label: 'Channel ID', secret: false },
      { key: 'refreshToken', label: 'OAuth Refresh Token', secret: true },
    ],
    setup: 'Google Cloud project + YouTube Data API v3 + OAuth2. Video upload support is on the roadmap.',
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

export const PLATFORM_LIST = Object.values(PLATFORMS);
export const LIVE_PLATFORMS = PLATFORM_LIST.filter(p => !p.comingSoon);

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
      if (val && !val.startsWith('••••')) secrets[f.key] = encrypt(val);
      else if (val === '') delete secrets[f.key];
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
  };
  for (const f of (def.fields || [])) {
    if (f.secret) out.secretsSet[f.key] = !!account.secrets?.[f.key];
  }
  return out;
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

// Publish one post to one platform. Returns { platform, ok, id?, url?, error?, at }.
export async function publishToPlatform(platformKey, post, account) {
  const def = PLATFORMS[platformKey];
  const at = new Date();
  if (!def) return { platform: platformKey, ok: false, error: 'Unknown platform', at };
  if (def.comingSoon || typeof def.publish !== 'function') {
    return { platform: platformKey, ok: false, error: `${def.name} publishing is not available yet`, at };
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
  const targets = (post.platforms || []).filter(p => PLATFORMS[p] && !PLATFORMS[p].comingSoon);
  const results = [];
  for (const p of targets) {
    results.push(await publishToPlatform(p, post, accountsByPlatform[p]));
  }
  return results;
}
