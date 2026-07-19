/**
 * YouTube integration — keyless-first, API-ready.
 * ------------------------------------------------
 * Three jobs, all pure (no Express/DB coupling — callers pass config):
 *
 *   parseVideoId(input)        — pull an 11-char video id out of any YouTube
 *                                URL form (watch, youtu.be, embed, shorts) or a
 *                                bare id. Returns '' when nothing looks valid.
 *   embedHtml(id, opts)        — responsive privacy-mode iframe for one video.
 *                                Used by the {{youtube}} content pipe so a video
 *                                can be dropped into any page/blog/portfolio body.
 *   fetchChannelUploads(cfg)   — latest uploads for a channel via the public RSS
 *                                feed (NO API key). `cfg.apiKey` is accepted and
 *                                reserved for a future Data API path; today it's
 *                                ignored and RSS is always used.
 *
 * The RSS feed (https://www.youtube.com/feeds/videos.xml) returns a channel's
 * ~15 most recent uploads with title, id, publish date and a thumbnail — exactly
 * what an "auto feed from my channel" section needs, at zero config/cost.
 */

// ── Video id parsing ─────────────────────────────────────────────────────────
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (ID_RE.test(s)) return s;                          // already a bare id
  let m;
  if ((m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/)))        return m[1]; // watch?v=
  if ((m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)))   return m[1]; // youtu.be/
  if ((m = s.match(/\/embed\/([A-Za-z0-9_-]{11})/)))     return m[1]; // /embed/
  if ((m = s.match(/\/shorts\/([A-Za-z0-9_-]{11})/)))    return m[1]; // /shorts/
  if ((m = s.match(/\/live\/([A-Za-z0-9_-]{11})/)))      return m[1]; // /live/
  return '';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function thumbUrl(id, quality = 'hqdefault') {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${quality}.jpg`;
}
export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

/**
 * Responsive 16:9 embed for one video. Privacy-enhanced (youtube-nocookie),
 * lazy-loaded. `opts.title` labels the iframe for a11y; `opts.className` lets a
 * host stylesheet target the wrapper.
 */
export function embedHtml(idOrUrl, opts = {}) {
  const id = parseVideoId(idOrUrl);
  if (!id) return '<!-- youtube: unrecognized video -->';
  const cls = opts.className ? ` ${esc(opts.className)}` : '';
  const title = esc(opts.title || 'YouTube video');
  return (
    `<div class="yt-embed${cls}" style="position:relative;width:100%;aspect-ratio:16/9;` +
    `overflow:hidden;border-radius:var(--card-radius,4px);background:#000;">` +
    `<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0" ` +
    `title="${title}" loading="lazy" allowfullscreen ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
    `referrerpolicy="strict-origin-when-cross-origin" frameborder="0" ` +
    `style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe></div>`
  );
}

// ── Channel resolution ───────────────────────────────────────────────────────
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

// Resolve any channel reference → a UC… channel id, keylessly.
//  • bare "UC…" id           → used as-is
//  • @handle / handle        → scrape the channel page for its canonical id
//  • full channel/@handle URL → scrape
//  • /channel/UC… URL         → extracted directly
// Cached so repeated feed pulls for the same channel don't re-scrape.
const _channelIdCache = new Map(); // ref → { id, at }
const CHANNEL_TTL_MS = 24 * 60 * 60 * 1000;

async function resolveChannelId(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return '';
  if (CHANNEL_ID_RE.test(raw)) return raw;

  let m;
  if ((m = raw.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/))) return m[1];

  const cached = _channelIdCache.get(raw);
  if (cached && (Date.now() - cached.at) < CHANNEL_TTL_MS) return cached.id;

  // Build a channel-page URL to scrape for the canonical id.
  let pageUrl;
  if (/^https?:\/\//i.test(raw)) pageUrl = raw;
  else if (raw.startsWith('@')) pageUrl = `https://www.youtube.com/${raw}`;
  else pageUrl = `https://www.youtube.com/@${raw}`;

  try {
    const r = await fetch(pageUrl, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; SlabBot/1.0)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return '';
    const html = await r.text();
    const hit =
      html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) ||
      html.match(/channel\/(UC[A-Za-z0-9_-]{22})/) ||
      html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/);
    const id = hit ? hit[1] : '';
    if (id) _channelIdCache.set(raw, { id, at: Date.now() });
    return id;
  } catch {
    return '';
  }
}

// ── RSS feed fetch + parse ───────────────────────────────────────────────────
const _feedCache = new Map(); // channelId → { videos, at }
const FEED_TTL_MS = 10 * 60 * 1000;

function parseFeed(xml) {
  const out = [];
  const entries = xml.split('<entry>').slice(1);
  for (const e of entries) {
    const id    = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || '';
    if (!id) continue;
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const pub   = (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    const thumb = (e.match(/<media:thumbnail[^>]*url="([^"]+)"/) || [])[1] || thumbUrl(id);
    const views = (e.match(/<media:statistics[^>]*views="([^"]+)"/) || [])[1] || '';
    const desc  = (e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '';
    out.push({
      id,
      title: unescapeXml(title.trim()),
      url: watchUrl(id),
      thumb,
      publishedAt: pub || null,
      views: views ? Number(views) : null,
      description: unescapeXml(desc.trim()).slice(0, 240),
    });
  }
  return out;
}

function unescapeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Latest uploads for a channel.
 * @param {object} cfg
 * @param {string} cfg.channel   UC… id, @handle, handle, or channel URL
 * @param {number} [cfg.limit=6] max videos to return
 * @param {string} [cfg.tag]     only videos whose title/description contains this
 *                               marker (e.g. "#slab", "featured"). Blank = all.
 * @param {string} [cfg.apiKey]  reserved — Data API path (ignored today; RSS used)
 * @returns {Promise<{ok:boolean, videos:Array, error?:string, channelId?:string, matched?:number}>}
 */
export async function fetchChannelUploads({ channel, limit = 6, tag = '', apiKey } = {}) {
  const channelId = await resolveChannelId(channel);
  if (!channelId) return { ok: false, videos: [], error: 'Could not resolve channel — use the UC… id or @handle.' };

  let all;
  const cached = _feedCache.get(channelId);
  if (cached && (Date.now() - cached.at) < FEED_TTL_MS) {
    all = cached.videos;
  } else {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return { ok: false, videos: [], error: `Feed HTTP ${r.status}`, channelId };
      const xml = await r.text();
      all = parseFeed(xml);
      _feedCache.set(channelId, { videos: all, at: Date.now() });
    } catch (e) {
      return { ok: false, videos: [], error: e.message, channelId };
    }
  }

  // Optional tag filter — matched against title + description, case-insensitive.
  // Runs post-cache (per request) so changing the tag needs no cache bust, and
  // BEFORE the limit so a tag never gets starved by the newest N uploads.
  const needle = String(tag || '').trim().toLowerCase();
  const filtered = needle
    ? all.filter(v => `${v.title} ${v.description}`.toLowerCase().includes(needle))
    : all;

  return { ok: true, videos: filtered.slice(0, limit), channelId, matched: filtered.length };
}

export default { parseVideoId, embedHtml, thumbUrl, watchUrl, fetchChannelUploads };
