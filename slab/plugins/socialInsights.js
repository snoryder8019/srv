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

const ANALYTICS_PLATFORMS = ['facebook', 'instagram', 'threads', 'linkedin'];

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

  const [imp, eng] = await Promise.all([
    graphMetric(FB, creds.pageId, 'page_impressions', creds.pageAccessToken, sinceSec, untilSec),
    graphMetric(FB, creds.pageId, 'page_post_engagements', creds.pageAccessToken, sinceSec, untilSec),
  ]);
  if (imp) { out.series.impressions = fillSeries(axis, imp); out.metrics.impressions = sum(out.series.impressions); }
  if (eng) { out.series.engagements = fillSeries(axis, eng); out.metrics.engagements = sum(out.series.engagements); }
  if (!imp && !eng && !out.error) out.note = 'Page insights unavailable (Meta deprecates many page metrics — follower count shown).';
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

  const [reach, views] = await Promise.all([
    graphMetric(FB, creds.igUserId, 'reach', creds.accessToken, sinceSec, untilSec),
    graphMetric(FB, creds.igUserId, 'profile_views', creds.accessToken, sinceSec, untilSec),
  ]);
  if (reach) { out.series.reach = fillSeries(axis, reach); out.metrics.reach = sum(out.series.reach); }
  if (views) { out.series.profileViews = fillSeries(axis, views); out.metrics.profileViews = sum(out.series.profileViews); }
  if (!reach && !views && !out.error) out.note = 'Insights require a Business/Creator account with recent activity.';
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

  const [followers, views, likes, replies] = await Promise.all([
    thMetric('followers_count', true),
    thMetric('views'), thMetric('likes'), thMetric('replies'),
  ]);
  if (followers != null) out.followers = followers;
  if (views)   { out.series.views   = fillSeries(axis, views);   out.metrics.views   = sum(out.series.views); }
  if (likes)   { out.series.likes   = fillSeries(axis, likes);   out.metrics.likes   = sum(out.series.likes); }
  if (replies) { out.series.replies = fillSeries(axis, replies); out.metrics.replies = sum(out.series.replies); }
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

  const totals = { followers: 0, reach: 0, impressions: 0, engagements: 0 };
  for (const p of Object.values(platforms)) {
    totals.followers   += p.followers || 0;
    totals.reach       += p.metrics.reach || 0;
    totals.impressions += p.metrics.impressions || 0;
    totals.engagements += p.metrics.engagements || p.metrics.likes || 0;
  }

  return { connected, days, axis, platforms, totals };
}
