// ─────────────────────────────────────────────────────────────────────────────
// socialInsights.js — pull REAL analytics from connected social accounts.
//
// Only queries platforms that are actually connected & configured (see
// isAccountConfigured). Every adapter is defensive: a failed metric never
// breaks the others — it degrades to a `note`/`error` so the UI shows
// "limited data" instead of crashing.
//
// Normalized per-platform shape:
//   { ok, name, icon, color, profile:{name,url}, followers, metrics:{...},
//     series:{ <metric>:[{date,value}] }, note?, error? }
//
// Decrypted tokens are NEVER logged.
// ─────────────────────────────────────────────────────────────────────────────
import { PLATFORMS, unpackCredentials, isAccountConfigured } from './socialPublish.js';

const FB = 'https://graph.facebook.com/v21.0';
const TH = 'https://graph.threads.net/v1.0';
const LI = 'https://api.linkedin.com';

// Platforms whose accounts we even attempt to pull insights from. Bluesky and
// YouTube are included: Bluesky exposes follower/engagement counts via its
// public API, and YouTube's OAuth token yields channel statistics. LinkedIn is
// here too but only *organization* pages return data — personal profiles 403.
const ANALYTICS_PLATFORMS = ['facebook', 'instagram', 'threads', 'linkedin', 'bluesky', 'youtube'];

const day = (d) => new Date(d).toISOString().slice(0, 10);

// Continuous day axis (oldest → newest) so charts have no gaps.
function dateAxis(days) {
  const out = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    out.push(day(today.getTime() - i * 86400000));
  }
  return out;
}

// Fill a {date:value} map onto the axis (missing days → 0).
function fillSeries(axis, map) {
  return axis.map(date => ({ date, value: Math.round((map[date] || 0) * 100) / 100 }));
}

function sum(series) {
  return Math.round(series.reduce((a, p) => a + (p.value || 0), 0) * 100) / 100;
}

// ── Graph API: fetch ONE time-series metric (own try/catch so siblings survive)
async function graphMetric(base, objId, metric, token, sinceSec, untilSec, period = 'day') {
  try {
    const u = `${base}/${objId}/insights?metric=${metric}&period=${period}`
      + `&since=${sinceSec}&until=${untilSec}&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.data)) return null;
    const map = {};
    for (const m of j.data) {
      for (const v of (m.values || [])) {
        const k = v.end_time ? day(v.end_time) : null;
        if (!k) continue;
        const val = (v.value && typeof v.value === 'object')
          ? Object.values(v.value).reduce((a, b) => a + (Number(b) || 0), 0)
          : (Number(v.value) || 0);
        map[k] = (map[k] || 0) + val;
      }
    }
    return map;
  } catch { return null; }
}

// ── Instagram v22 insights — two shapes ──────────────────────────────────────
// Meta split IG account insights into `metric_type=time_series` (returns
// values[]) and `metric_type=total_value` (returns a single total_value.value).
// The legacy graphMetric() above no longer works for IG account metrics, and the
// old profile_views/impressions metrics were deprecated (Jan/Apr 2025) — hence
// the zeros. These two helpers speak the current shapes.

// A shared "error sink" so IG helpers can report WHY a metric came back empty
// instead of silently degrading to a zero. errRef.msg holds the first API error
// message seen (e.g. a #10 permission denial), which the adapter promotes to a
// visible card error rather than a misleading "0 reach".
function igErr(errRef, j, status) {
  if (!errRef || errRef.msg) return; // keep the first, most-relevant error
  const e = j?.error;
  if (e?.message) {
    // #10 / #200 / OAuthException all mean "token lacks instagram_manage_insights".
    errRef.msg = /permission|#10|#200|OAuthException/i.test(e.message)
      ? 'Instagram Insights permission missing — reconnect Instagram and grant the “insights” scope (instagram_manage_insights).'
      : e.message;
  } else if (status && status >= 400) {
    errRef.msg = `Instagram insights unavailable (HTTP ${status}).`;
  }
}

// Time-series IG metric (e.g. reach) → {date:value} map, or null.
async function igSeries(objId, metric, token, sinceSec, untilSec, errRef) {
  try {
    const u = `${FB}/${objId}/insights?metric=${metric}&period=day&metric_type=time_series`
      + `&since=${sinceSec}&until=${untilSec}&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.data)) { igErr(errRef, j, r.status); return null; }
    const node = j.data.find(d => d.name === metric) || j.data[0];
    if (!node) return null;
    const map = {};
    for (const v of (node.values || [])) {
      const k = v.end_time ? day(v.end_time) : null;
      if (k) map[k] = (map[k] || 0) + (Number(v.value) || 0);
    }
    return Object.keys(map).length ? map : null;
  } catch { return null; }
}

// Aggregate IG metric over the window (metric_type=total_value) → number, or null.
async function igTotal(objId, metric, token, sinceSec, untilSec, errRef) {
  try {
    const u = `${FB}/${objId}/insights?metric=${metric}&metric_type=total_value&period=day`
      + `&since=${sinceSec}&until=${untilSec}&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.data)) { igErr(errRef, j, r.status); return null; }
    const node = j.data.find(d => d.name === metric) || j.data[0];
    const tv = node?.total_value?.value;
    return (tv == null) ? null : (Number(tv) || 0);
  } catch { return null; }
}

// ── Facebook Page ────────────────────────────────────────────────────────────
async function facebookInsights(creds, sinceSec, untilSec, axis) {
  const out = { followers: 0, metrics: {}, series: {}, profile: {} };
  // Profile + follower count
  try {
    const r = await fetch(`${FB}/${creds.pageId}?fields=name,fan_count,followers_count&access_token=${encodeURIComponent(creds.pageAccessToken)}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      out.followers = j.followers_count ?? j.fan_count ?? 0;
      out.profile = { name: j.name, url: `https://facebook.com/${creds.pageId}` };
    } else if (j.error) out.error = j.error.message;
  } catch (e) { out.error = e.message; }

  // page_impressions / page_impressions_unique were HARD-removed by Meta (they now
  // 400 as "not a valid insights metric"), so we no longer request them — the
  // surviving replacements are page_views_total (traffic), page_post_engagements,
  // page_actions_post_reactions_total (reactions; value is a per-type breakdown
  // object that graphMetric already sums), page_video_views and daily follows.
  // Facebook Pages expose NO reach metric anymore — that's why reach is IG-only.
  const tok = creds.pageAccessToken;
  const [views, eng, reactions, vid, newFollows] = await Promise.all([
    graphMetric(FB, creds.pageId, 'page_views_total', tok, sinceSec, untilSec),
    graphMetric(FB, creds.pageId, 'page_post_engagements', tok, sinceSec, untilSec),
    graphMetric(FB, creds.pageId, 'page_actions_post_reactions_total', tok, sinceSec, untilSec),
    graphMetric(FB, creds.pageId, 'page_video_views', tok, sinceSec, untilSec),
    graphMetric(FB, creds.pageId, 'page_daily_follows_unique', tok, sinceSec, untilSec),
  ]);
  if (views) { out.series.impressions = fillSeries(axis, views); out.metrics.impressions = sum(out.series.impressions); }
  if (eng) { out.series.engagements = fillSeries(axis, eng); out.metrics.engagements = sum(out.series.engagements); }
  if (reactions) out.metrics.reactions = sum(fillSeries(axis, reactions));
  if (vid) out.metrics.videoViews = sum(fillSeries(axis, vid));
  if (newFollows) out.metrics.newFollows = sum(fillSeries(axis, newFollows));
  if (!views && !eng && !out.error) out.note = 'Page insights unavailable (Meta deprecated most Page metrics — follower count shown).';
  return out;
}

// ── Instagram (Business/Creator) ──────────────────────────────────────────────
async function instagramInsights(creds, sinceSec, untilSec, axis) {
  const out = { followers: 0, metrics: {}, series: {}, profile: {} };
  try {
    const r = await fetch(`${FB}/${creds.igUserId}?fields=username,followers_count,media_count&access_token=${encodeURIComponent(creds.accessToken)}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      out.followers = j.followers_count || 0;
      out.metrics.posts = j.media_count || 0;
      out.profile = { name: j.username, url: j.username ? `https://instagram.com/${j.username}` : undefined };
    } else if (j.error) out.error = j.error.message;
  } catch (e) { out.error = e.message; }

  // reach = the one metric with a per-day time series (drives the trend line).
  // Everything else is an aggregate total over the window (v22 total_value shape).
  // profile_views/impressions were deprecated in 2025 — replaced by views +
  // total_interactions — which is exactly why the old cards read 0.
  const tok = creds.accessToken;
  const errRef = {};
  const [reach, views, interactions, engaged, likes, comments, saves, shares, taps] = await Promise.all([
    igSeries(creds.igUserId, 'reach', tok, sinceSec, untilSec, errRef),
    igTotal(creds.igUserId, 'views', tok, sinceSec, untilSec, errRef),
    igTotal(creds.igUserId, 'total_interactions', tok, sinceSec, untilSec, errRef),
    igTotal(creds.igUserId, 'accounts_engaged', tok, sinceSec, untilSec, errRef),
    igTotal(creds.igUserId, 'likes', tok, sinceSec, untilSec, errRef),
    igTotal(creds.igUserId, 'comments', tok, sinceSec, untilSec, errRef),
    igTotal(creds.igUserId, 'saves', tok, sinceSec, untilSec, errRef),
    igTotal(creds.igUserId, 'shares', tok, sinceSec, untilSec, errRef),
    igTotal(creds.igUserId, 'profile_links_taps', tok, sinceSec, untilSec, errRef),
  ]);
  if (reach) { out.series.reach = fillSeries(axis, reach); out.metrics.reach = sum(out.series.reach); }
  if (views != null)        out.metrics.views = views;
  if (interactions != null) out.metrics.interactions = interactions;
  if (engaged != null)      out.metrics.accountsEngaged = engaged;
  if (likes != null)        out.metrics.likes = likes;
  if (comments != null)     out.metrics.comments = comments;
  if (saves != null)        out.metrics.saves = saves;
  if (shares != null)       out.metrics.shares = shares;
  if (taps != null)         out.metrics.profileTaps = taps;
  // No metric came back. Distinguish a permission/API failure (surface as an
  // error so the tenant knows reach=0 is NOT real) from a genuinely quiet account.
  if (!reach && views == null && interactions == null && !out.error) {
    if (errRef.msg) out.error = errRef.msg;
    else out.note = 'Insights require a Business/Creator account with recent activity.';
  }
  return out;
}

// ── Threads ───────────────────────────────────────────────────────────────────
async function threadsInsights(creds, sinceSec, untilSec, axis) {
  const out = { followers: 0, metrics: {}, series: {}, profile: {} };
  // Profile / username
  try {
    const r = await fetch(`${TH}/${creds.userId}?fields=username&access_token=${encodeURIComponent(creds.accessToken)}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.username) out.profile = { name: j.username, url: `https://threads.net/@${j.username}` };
  } catch { /* non-fatal */ }

  // followers_count is a total value (no period); views/likes/replies are series.
  async function thMetric(metric, asTotal = false) {
    try {
      const u = `${TH}/${creds.userId}/threads_insights?metric=${metric}`
        + (asTotal ? '' : `&since=${sinceSec}&until=${untilSec}`)
        + `&access_token=${encodeURIComponent(creds.accessToken)}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.data)) { if (j.error && !out.error) out.error = j.error.message; return null; }
      const node = j.data.find(d => d.name === metric) || j.data[0];
      if (!node) return null;
      if (asTotal) return Number(node.total_value?.value ?? node.values?.[0]?.value ?? 0);
      const map = {};
      for (const v of (node.values || [])) {
        const k = v.end_time ? day(v.end_time) : null;
        if (k) map[k] = (map[k] || 0) + (Number(v.value) || 0);
      }
      return map;
    } catch { return null; }
  }

  const [followers, views, likes, replies, reposts, quotes] = await Promise.all([
    thMetric('followers_count', true),
    thMetric('views'), thMetric('likes'), thMetric('replies'),
    thMetric('reposts'), thMetric('quotes'),
  ]);
  if (followers != null) out.followers = followers;
  if (views)   { out.series.views   = fillSeries(axis, views);   out.metrics.views   = sum(out.series.views); }
  if (likes)   { out.series.likes   = fillSeries(axis, likes);   out.metrics.likes   = sum(out.series.likes); }
  if (replies) { out.series.replies = fillSeries(axis, replies); out.metrics.replies = sum(out.series.replies); }
  if (reposts) out.metrics.reposts = sum(fillSeries(axis, reposts));
  if (quotes)  out.metrics.quotes  = sum(fillSeries(axis, quotes));
  if (!views && !likes && !replies && !out.error) out.note = 'No Threads insight data for this period yet.';
  return out;
}

// ── LinkedIn (Organization pages only — personal profiles have no analytics API)
async function linkedinInsights(creds, axis) {
  const out = { followers: 0, metrics: {}, series: {}, profile: {} };
  const urn = creds.authorUrn || '';
  const headers = { Authorization: `Bearer ${creds.accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' };

  if (!/urn:li:organization:/.test(urn)) {
    out.note = 'LinkedIn analytics require an Organization page URN (urn:li:organization:…) with admin access. Personal profiles are not supported by LinkedIn\'s API.';
    return out;
  }

  // Follower count
  try {
    const r = await fetch(`${LI}/v2/networkSizes/${encodeURIComponent(urn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) out.followers = j.firstDegreeSize || 0;
    else if (j.message) out.error = j.message;
  } catch (e) { out.error = e.message; }

  // Lifetime share statistics (impressions / clicks / engagement)
  try {
    const r = await fetch(`${LI}/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(urn)}`, { headers, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    const stat = j?.elements?.[0]?.totalShareStatistics;
    if (r.ok && stat) {
      out.metrics.impressions = stat.impressionCount || 0;
      out.metrics.clicks = stat.clickCount || 0;
      out.metrics.engagements = Math.round((stat.engagement || 0) * 1000) / 10; // → %
      out.metrics.likes = stat.likeCount || 0;
      out.metrics.shares = stat.shareCount || 0;
    }
  } catch { /* non-fatal */ }

  if (!out.metrics.impressions && !out.followers && !out.error) out.note = 'No LinkedIn organization statistics returned for this token.';
  return out;
}

// ── Bluesky (AT Protocol) ─────────────────────────────────────────────────────
// No native "insights" API, but the public app view exposes follower/post counts
// and the author feed carries per-post like/repost/reply counts — enough to build
// a real engagement trend and totals for the account's own posts.
async function blueskyInsights(creds, axis, sinceMs) {
  const out = { followers: 0, metrics: {}, series: {}, profile: {} };
  const svc = (creds.service || 'https://bsky.social').replace(/\/+$/, '');
  const APP = 'https://public.api.bsky.app';
  try {
    // App-password session → bearer for the (authenticated) author-feed read.
    const sr = await fetch(`${svc}/xrpc/com.atproto.server.createSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: creds.identifier, password: creds.appPassword }),
      signal: AbortSignal.timeout(15000),
    });
    const sj = await sr.json().catch(() => ({}));
    if (!sr.ok || !sj.accessJwt) { out.error = sj.message || `Bluesky auth failed (HTTP ${sr.status})`; return out; }
    const handle = sj.handle || creds.identifier;
    out.profile = { name: handle, url: `https://bsky.app/profile/${handle}` };

    // Public profile → follower / following / post totals (point-in-time).
    const pr = await fetch(`${APP}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(15000) });
    const pj = await pr.json().catch(() => ({}));
    if (pr.ok) {
      out.followers = pj.followersCount || 0;
      out.metrics.following = pj.followsCount || 0;
      out.metrics.posts = pj.postsCount || 0;
    }

    // Author feed (own posts) → per-day engagement series within the window.
    const fr = await fetch(`${svc}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=100&filter=posts_no_replies`,
      { headers: { Authorization: `Bearer ${sj.accessJwt}` }, signal: AbortSignal.timeout(15000) });
    const fj = await fr.json().catch(() => ({}));
    if (fr.ok && Array.isArray(fj.feed)) {
      const engMap = {}; let likes = 0, reposts = 0, replies = 0, windowPosts = 0;
      for (const item of fj.feed) {
        const p = item.post || {};
        const ts = p.indexedAt ? new Date(p.indexedAt).getTime() : 0;
        if (!ts || ts < sinceMs) continue; // only posts inside the selected window
        windowPosts++;
        const e = (p.likeCount || 0) + (p.repostCount || 0) + (p.replyCount || 0);
        likes += p.likeCount || 0; reposts += p.repostCount || 0; replies += p.replyCount || 0;
        const k = day(p.indexedAt); engMap[k] = (engMap[k] || 0) + e;
      }
      if (windowPosts) out.metrics.postsInPeriod = windowPosts;
      if (likes) out.metrics.likes = likes;
      if (reposts) out.metrics.reposts = reposts;
      if (replies) out.metrics.replies = replies;
      const totalEng = likes + reposts + replies;
      if (totalEng) { out.series.engagements = fillSeries(axis, engMap); out.metrics.engagements = totalEng; }
    }
    if (!out.metrics.engagements && !out.error) out.note = 'Connected — no post engagement in this period yet.';
  } catch (e) { out.error = e.message; }
  return out;
}

// ── YouTube (OAuth) ───────────────────────────────────────────────────────────
// The stored OAuth refresh token yields channel statistics (subscribers, lifetime
// views, video count). Per-day time series needs the YouTube Analytics API + the
// yt-analytics.readonly scope, which this connection doesn't grant — so we return
// solid totals and note how to unlock trends.
async function youtubeInsights(creds, axis) {
  const out = { followers: 0, metrics: {}, series: {}, profile: {} };
  try {
    if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
      out.note = 'YouTube connected for publishing only — reconnect to enable analytics.'; return out;
    }
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: creds.refreshToken, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(15000),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) { out.error = tj.error_description || tj.error || `YouTube auth failed (HTTP ${tr.status})`; return out; }

    const idParam = creds.channelId ? `id=${encodeURIComponent(creds.channelId)}` : 'mine=true';
    const cr = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&${idParam}`,
      { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15000) });
    const cj = await cr.json().catch(() => ({}));
    const it = cj?.items?.[0];
    if (!it) { out.error = cj?.error?.message || 'YouTube channel not found for this token.'; return out; }
    const s = it.statistics || {};
    out.followers = Number(s.subscriberCount) || 0;
    if (s.viewCount != null)  out.metrics.totalViews = Number(s.viewCount) || 0;
    if (s.videoCount != null) out.metrics.videos = Number(s.videoCount) || 0;
    out.profile = {
      name: it.snippet?.title,
      url: `https://youtube.com/channel/${it.id}`,
    };
    out.note = 'Lifetime channel totals. Per-day trends need the YouTube Analytics API enabled with the analytics scope.';
  } catch (e) { out.error = e.message; }
  return out;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
// Returns { connected:[keys], days, axis, platforms:{key:{...}}, totals:{...} }
export async function buildSocialInsights(db, { days = 30 } = {}) {
  const axis = dateAxis(days);
  const untilSec = Math.floor(Date.now() / 1000);
  const sinceSec = untilSec - days * 86400;

  const accounts = await db.collection('social_accounts')
    .find({ platform: { $in: ANALYTICS_PLATFORMS } }).toArray()
    .catch(() => []);

  const connected = accounts.filter(isAccountConfigured).map(a => a.platform);
  const platforms = {};

  await Promise.all(accounts.filter(isAccountConfigured).map(async (acc) => {
    const def = PLATFORMS[acc.platform] || {};
    const creds = unpackCredentials(acc);
    let data;
    try {
      if (acc.platform === 'facebook')      data = await facebookInsights(creds, sinceSec, untilSec, axis);
      else if (acc.platform === 'instagram') data = await instagramInsights(creds, sinceSec, untilSec, axis);
      else if (acc.platform === 'threads')   data = await threadsInsights(creds, sinceSec, untilSec, axis);
      else if (acc.platform === 'linkedin')  data = await linkedinInsights(creds, axis);
      else if (acc.platform === 'bluesky')   data = await blueskyInsights(creds, axis, sinceSec * 1000);
      else if (acc.platform === 'youtube')   data = await youtubeInsights(creds, axis);
      else return;
    } catch (e) {
      data = { followers: 0, metrics: {}, series: {}, error: e.message };
    }
    platforms[acc.platform] = {
      ok: !data.error,
      name: def.name || acc.platform,
      icon: def.icon || '',
      color: def.color || '#888',
      profile: data.profile || acc.profile || {},
      followers: data.followers || 0,
      metrics: data.metrics || {},
      series: data.series || {},
      note: data.note,
      error: data.error,
    };
  }));

  const totals = { followers: 0, reach: 0, impressions: 0, engagements: 0, posts: 0 };
  let insightErrors = 0;
  for (const p of Object.values(platforms)) {
    const m = p.metrics || {};
    if (p.error) insightErrors++;
    totals.followers   += p.followers || 0;
    totals.reach       += m.reach || 0;
    // IG's modern "views" is the impressions replacement; FB reports page views.
    // NOTE: only windowed metrics feed the total — YouTube's lifetime totalViews
    // is deliberately excluded so a 30-day figure isn't polluted by all-time data.
    totals.impressions += (m.impressions || 0) + (m.views || 0);
    // Prefer aggregate engagement; fall back to summing the interaction parts.
    totals.engagements += m.engagements || m.interactions ||
      ((m.likes || 0) + (m.comments || 0) + (m.saves || 0) + (m.shares || 0) + (m.replies || 0) + (m.reposts || 0));
    // Content volume across networks (IG media, Bluesky posts, YouTube videos).
    totals.posts += (m.posts || 0) + (m.videos || 0);
  }
  // Signals to the UI that a 0 in a tile may be a blocked API, not a real zero.
  totals.hasErrors = insightErrors > 0;
  totals.reachBlocked = totals.reach === 0 && !!(platforms.instagram && platforms.instagram.error);

  return { connected, days, axis, platforms, totals };
}
