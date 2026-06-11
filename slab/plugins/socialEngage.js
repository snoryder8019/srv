// ─────────────────────────────────────────────────────────────────────────────
// socialEngage.js — read recent posts, their analytics, and comments; reply to
// comments. Powers the /admin/social "Engage" tab.
//
// Engagement (reading a feed, fetching insights, replying to comments) is far
// more API-restricted than publishing — each platform declares an `engage`
// adapter only where the API actually supports it. Platforms without one show a
// "not available via this API" note in the UI.
//
// Currently implemented: Instagram + Facebook (Meta Graph API). The shape below
// (caps + fetch + reply) is the contract any future platform must satisfy.
// Credentials are decrypted via unpackCredentials and NEVER logged.
// ─────────────────────────────────────────────────────────────────────────────
import { unpackCredentials, metaError } from './socialPublish.js';

const G = 'https://graph.facebook.com/v21.0';
const FETCH_LIMIT = 12;       // recent posts pulled per account
const COMMENT_LIMIT = 15;     // comments pulled per post

// caps describe exactly what the UI may offer for a platform:
//   analytics      — posts carry metric numbers
//   comments       — comments are read and shown
//   replyToComment — admin can reply to a comment
//   replyToPost    — admin can comment on the post itself
const ENGAGE = {
  // ── Instagram ──────────────────────────────────────────────────────────────
  // Media carry like_count/comments_count directly (reliable across versions).
  // Replies via /{comment-id}/replies; IG has no API to add a top-level comment
  // to your own media, so replyToPost is false.
  instagram: {
    caps: { analytics: true, comments: true, replyToComment: true, replyToPost: false },
    async fetch({ creds }) {
      const fields = [
        'id', 'caption', 'media_type', 'media_url', 'thumbnail_url', 'permalink', 'timestamp',
        'like_count', 'comments_count',
        `comments.limit(${COMMENT_LIMIT}){id,text,username,timestamp,like_count}`,
      ].join(',');
      const r = await fetch(`${G}/${creds.igUserId}/media?fields=${encodeURIComponent(fields)}&limit=${FETCH_LIMIT}&access_token=${encodeURIComponent(creds.accessToken)}`, { signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw metaError(j, r.status, 'feed');
      const posts = (j.data || []).map(m => ({
        id: m.id,
        text: m.caption || '',
        url: m.permalink || null,
        createdAt: m.timestamp || null,
        thumb: m.thumbnail_url || m.media_url || null,
        metrics: [
          { label: 'Likes', value: m.like_count ?? 0 },
          { label: 'Comments', value: m.comments_count ?? 0 },
        ],
        comments: (m.comments?.data || []).map(c => ({
          id: c.id,
          from: c.username || 'user',
          text: c.text || '',
          createdAt: c.timestamp || null,
        })),
      }));
      return { posts };
    },
    async reply({ creds, targetId, kind, text }) {
      if (kind !== 'comment') throw new Error('Instagram only allows replying to a comment');
      const r = await fetch(`${G}/${targetId}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: creds.accessToken }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) throw metaError(j, r.status, 'reply');
      return { id: j.id };
    },
  },

  // ── Facebook Page ────────────────────────────────────────────────────────────
  // Posts carry like/comment/share summaries; comments come inline. Replying to
  // a post OR a comment is the same endpoint: POST /{id}/comments.
  facebook: {
    caps: { analytics: true, comments: true, replyToComment: true, replyToPost: true },
    async fetch({ creds }) {
      const fields = [
        'id', 'message', 'story', 'created_time', 'permalink_url', 'full_picture', 'shares',
        'likes.summary(true).limit(0)',
        `comments.summary(true).limit(${COMMENT_LIMIT}){id,message,from,created_time}`,
      ].join(',');
      const r = await fetch(`${G}/${creds.pageId}/posts?fields=${encodeURIComponent(fields)}&limit=${FETCH_LIMIT}&access_token=${encodeURIComponent(creds.pageAccessToken)}`, { signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw metaError(j, r.status, 'feed');
      const posts = (j.data || []).map(p => ({
        id: p.id,
        text: p.message || p.story || '',
        url: p.permalink_url || null,
        createdAt: p.created_time || null,
        thumb: p.full_picture || null,
        metrics: [
          { label: 'Likes', value: p.likes?.summary?.total_count ?? 0 },
          { label: 'Comments', value: p.comments?.summary?.total_count ?? 0 },
          { label: 'Shares', value: p.shares?.count ?? 0 },
        ],
        comments: (p.comments?.data || []).map(c => ({
          id: c.id,
          from: c.from?.name || 'user',
          text: c.message || '',
          createdAt: c.created_time || null,
        })),
      }));
      return { posts };
    },
    async reply({ creds, targetId, text }) {
      // Works for both a post id and a comment id — both accept a child comment.
      const r = await fetch(`${G}/${targetId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: creds.pageAccessToken }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) throw metaError(j, r.status, 'reply');
      return { id: j.id };
    },
  },
};

export const ENGAGE_PLATFORMS = Object.keys(ENGAGE);

// Capabilities for a platform, or null if engagement isn't supported there.
export function engageCaps(platform) {
  return ENGAGE[platform]?.caps || null;
}

// Map of { platform: caps } for every engage-capable platform (for the view).
export function allEngageCaps() {
  const out = {};
  for (const [k, v] of Object.entries(ENGAGE)) out[k] = v.caps;
  return out;
}

// Fetch a connected account's recent posts + analytics + comments.
// Returns { ok, caps, posts, error? } — never throws.
export async function fetchEngagement(platform, account) {
  const eng = ENGAGE[platform];
  if (!eng) return { ok: false, error: 'Engagement not available for this platform' };
  if (!account || account.enabled === false) return { ok: false, error: 'Account not connected' };
  try {
    const creds = unpackCredentials(account);
    const out = await eng.fetch({ creds, account });
    return { ok: true, caps: eng.caps, posts: out.posts || [] };
  } catch (err) {
    return { ok: false, caps: eng.caps, error: err.message || 'Failed to load feed' };
  }
}

// Post a reply to a comment (or post, where allowed).
// `kind` is 'comment' | 'post'. Returns { ok, id?, error? } — never throws.
export async function postReply(platform, account, { targetId, kind, text }) {
  const eng = ENGAGE[platform];
  if (!eng?.reply) return { ok: false, error: 'Replying not available for this platform' };
  if (!account || account.enabled === false) return { ok: false, error: 'Account not connected' };
  if (!targetId || !text?.trim()) return { ok: false, error: 'Missing reply target or text' };
  if (kind === 'post' && !eng.caps.replyToPost) return { ok: false, error: 'Cannot comment on a post for this platform' };
  if (kind === 'comment' && !eng.caps.replyToComment) return { ok: false, error: 'Cannot reply to comments for this platform' };
  try {
    const creds = unpackCredentials(account);
    const out = await eng.reply({ creds, targetId, kind, text: text.trim() });
    return { ok: true, id: out?.id || null };
  } catch (err) {
    return { ok: false, error: err.message || 'Reply failed' };
  }
}
