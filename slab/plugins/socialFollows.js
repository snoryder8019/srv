// ─────────────────────────────────────────────────────────────────────────────
// socialFollows.js — "My Follows" feed: posts from accounts the tenant follows,
// consolidated across connected platforms for fast outreach + engagement.
//
// A following/home timeline is only exposed by some platform APIs:
//   • Mastodon — GET /api/v1/timelines/home  (accounts you follow)
//   • Bluesky  — app.bsky.feed.getTimeline    (your following feed)
// Meta Graph (Facebook Page / Instagram) and X (without elevated access) do NOT
// expose a follows feed, so those report unsupported. Same adapter contract as
// socialEngage: { caps, fetch, reply?, like? }. Secrets never logged.
// ─────────────────────────────────────────────────────────────────────────────
import { unpackCredentials, redditAccessToken } from './socialPublish.js';

const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();

const FOLLOWS = {
  // ── Reddit — your subscribed front page (accounts/subreddits you follow)
  reddit: {
    caps: { timeline: true, reply: true, like: true },
    async fetch({ creds }) {
      const { token, ua } = await redditAccessToken(creds);
      const r = await fetch("https://oauth.reddit.com/best?limit=20", { headers: { Authorization: "Bearer " + token, "User-Agent": ua }, signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("Reddit HTTP " + r.status);
      return (j?.data?.children || []).map(c => {
        const d = c.data || {};
        const thumb = (d.thumbnail && /^https?:/.test(d.thumbnail)) ? d.thumbnail : null;
        return {
          platform: "reddit", id: d.name,
          author: { name: "r/" + d.subreddit, handle: "u/" + d.author, url: "https://reddit.com" + (d.permalink || ""), avatar: null },
          text: (d.title || "") + (d.selftext ? "\n\n" + d.selftext.slice(0, 280) : ""),
          url: d.permalink ? "https://reddit.com" + d.permalink : null,
          createdAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
          media: thumb ? [thumb] : [],
          metrics: [{ label: "Upvotes", value: d.ups ?? 0 }, { label: "Comments", value: d.num_comments ?? 0 }],
          replyRef: { name: d.name },
        };
      });
    },
    async reply({ creds, replyRef, text }) {
      const { token, ua } = await redditAccessToken(creds);
      const r = await fetch("https://oauth.reddit.com/api/comment", {
        method: "POST", headers: { Authorization: "Bearer " + token, "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ api_type: "json", thing_id: replyRef.name, text }).toString(), signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("Reddit HTTP " + r.status);
      const errs = j?.json?.errors; if (errs && errs.length) throw new Error("Reddit: " + errs.map(e => e.join(" ")).join("; "));
      return { id: j?.json?.data?.things?.[0]?.data?.name };
    },
    async like({ creds, replyRef }) {
      const { token, ua } = await redditAccessToken(creds);
      const r = await fetch("https://oauth.reddit.com/api/vote", {
        method: "POST", headers: { Authorization: "Bearer " + token, "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id: replyRef.name, dir: "1" }).toString(), signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error("Reddit HTTP " + r.status);
      return { ok: true };
    },
  },

  // ── Mastodon ────────────────────────────────────────────────────────────────
  mastodon: {
    caps: { timeline: true, reply: true, like: true },
    async fetch({ creds }) {
      const base = (creds.instanceUrl || '').replace(/\/+$/, '');
      const r = await fetch(`${base}/api/v1/timelines/home?limit=20`, { headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ([]));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return (Array.isArray(j) ? j : []).map(s => ({
        platform: 'mastodon', id: s.id,
        author: { name: s.account?.display_name || s.account?.username, handle: '@' + (s.account?.acct || ''), url: s.account?.url, avatar: s.account?.avatar_static || s.account?.avatar },
        text: stripHtml(s.content), url: s.url || s.uri, createdAt: s.created_at,
        media: (s.media_attachments || []).map(m => m.preview_url || m.url).filter(Boolean).slice(0, 1),
        metrics: [{ label: 'Replies', value: s.replies_count ?? 0 }, { label: 'Boosts', value: s.reblogs_count ?? 0 }, { label: 'Favs', value: s.favourites_count ?? 0 }],
        replyRef: { id: s.id },
      }));
    },
    async reply({ creds, replyRef, text }) {
      const base = (creds.instanceUrl || '').replace(/\/+$/, '');
      const r = await fetch(`${base}/api/v1/statuses`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: text, in_reply_to_id: replyRef?.id }), signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return { id: j.id, url: j.url };
    },
    async like({ creds, replyRef }) {
      const base = (creds.instanceUrl || '').replace(/\/+$/, '');
      const r = await fetch(`${base}/api/v1/statuses/${replyRef?.id}/favourite`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true };
    },
  },

  // ── Bluesky ──────────────────────────────────────────────────────────────────
  bluesky: {
    caps: { timeline: true, reply: true, like: true },
    async _session(creds) {
      const svc = (creds.service || 'https://bsky.social').replace(/\/+$/, '');
      const r = await fetch(`${svc}/xrpc/com.atproto.server.createSession`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: creds.identifier, password: creds.appPassword }), signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `auth HTTP ${r.status}`);
      return { svc, jwt: j.accessJwt, did: j.did };
    },
    async fetch({ creds }) {
      const s = await this._session(creds);
      const r = await fetch(`${s.svc}/xrpc/app.bsky.feed.getTimeline?limit=20`, { headers: { Authorization: `Bearer ${s.jwt}` }, signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      return (j.feed || []).map(it => {
        const p = it.post || {};
        const rkey = (p.uri || '').split('/').pop();
        return {
          platform: 'bluesky', id: p.uri,
          author: { name: p.author?.displayName || p.author?.handle, handle: '@' + (p.author?.handle || ''), url: p.author?.handle ? `https://bsky.app/profile/${p.author.handle}` : null, avatar: p.author?.avatar },
          text: p.record?.text || '', url: (p.author?.handle && rkey) ? `https://bsky.app/profile/${p.author.handle}/post/${rkey}` : null,
          createdAt: p.record?.createdAt || p.indexedAt,
          media: [], metrics: [{ label: 'Replies', value: p.replyCount ?? 0 }, { label: 'Reposts', value: p.repostCount ?? 0 }, { label: 'Likes', value: p.likeCount ?? 0 }],
          replyRef: { uri: p.uri, cid: p.cid },
        };
      });
    },
    async reply({ creds, replyRef, text }) {
      const s = await this._session(creds);
      const ref = { uri: replyRef.uri, cid: replyRef.cid };
      const r = await fetch(`${s.svc}/xrpc/com.atproto.repo.createRecord`, { method: 'POST', headers: { Authorization: `Bearer ${s.jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text: String(text).slice(0, 300), createdAt: new Date().toISOString(), reply: { root: ref, parent: ref } } }), signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      return { id: j.uri };
    },
    async like({ creds, replyRef }) {
      const s = await this._session(creds);
      const r = await fetch(`${s.svc}/xrpc/com.atproto.repo.createRecord`, { method: 'POST', headers: { Authorization: `Bearer ${s.jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.like', record: { $type: 'app.bsky.feed.like', subject: { uri: replyRef.uri, cid: replyRef.cid }, createdAt: new Date().toISOString() } }), signal: AbortSignal.timeout(20000) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `HTTP ${r.status}`); }
      return { ok: true };
    },
  },
};

export function followsCaps(platform) { return FOLLOWS[platform]?.caps || null; }
export const FOLLOWS_PLATFORMS = Object.keys(FOLLOWS);

// Aggregate the home/following timeline across all connected, supported accounts.
// Returns { items (sorted newest first), sources, unsupported, errors }.
export async function fetchAllFollows(accounts) {
  const items = [], sources = [], unsupported = [], errors = [];
  for (const acct of accounts) {
    if (acct.enabled === false) continue;
    const eng = FOLLOWS[acct.platform];
    if (!eng) { unsupported.push(acct.platform); continue; }
    try {
      const creds = unpackCredentials(acct);
      const posts = await eng.fetch.call(eng, { creds });
      sources.push({ platform: acct.platform, count: posts.length });
      items.push(...posts);
    } catch (e) { errors.push({ platform: acct.platform, error: e.message }); }
  }
  items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return { items, sources, unsupported, errors };
}

// Reply to / like a follows post. Returns { ok, id?, error? } — never throws.
export async function followsAction(platform, account, { action, replyRef, text }) {
  const eng = FOLLOWS[platform];
  if (!eng) return { ok: false, error: 'Follows not supported for this platform' };
  if (!account || account.enabled === false) return { ok: false, error: 'Account not connected' };
  try {
    const creds = unpackCredentials(account);
    if (action === 'like' && eng.like) { await eng.like.call(eng, { creds, replyRef }); return { ok: true }; }
    if (action === 'reply' && eng.reply) {
      if (!text?.trim()) return { ok: false, error: 'Empty reply' };
      const out = await eng.reply.call(eng, { creds, replyRef, text: text.trim() });
      return { ok: true, id: out?.id || null, url: out?.url || null };
    }
    return { ok: false, error: 'Unsupported action' };
  } catch (e) { return { ok: false, error: e.message || 'Action failed' }; }
}
