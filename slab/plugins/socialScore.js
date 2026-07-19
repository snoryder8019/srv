// ─────────────────────────────────────────────────────────────────────────────
// socialScore.js — score LIVE posts by real engagement so design/autopilot
// decisions rest on DATA, not vibes. Each scored post writes a `social_scores`
// row tied to its design signature (font / align / aspect / style). Reliability%
// grows with sample size — statistical calls should wait until it's high enough.
//
// Engagement comes from socialEngage.fetchEngagement (per-account feed of recent
// posts + like/comment counts); a published post's results[].id matches the feed
// item's id. Only scores posts old enough for engagement to have settled.
// ─────────────────────────────────────────────────────────────────────────────
import { isAccountConfigured } from './socialPublish.js';
import { fetchEngagement } from './socialEngage.js';
import { designSignature } from './socialDesign.js';

const RELIABILITY_TARGET = 30;   // scored posts for "high confidence"

// Weighted score. Comments/shares signal higher intent than a like. When reach is
// known we return an engagement RATE (%); otherwise raw weighted engagement.
function scoreOf({ likes = 0, comments = 0, shares = 0, reach = 0 }) {
  const eng = likes + comments * 3 + shares * 5;
  return reach > 0 ? Math.round((eng / reach) * 10000) / 100 : eng;
}

// Walk published, aged, unscored posts and score each from its platform feed.
export async function scoreLivePosts(db, tenant, { minAgeDays = 2, limit = 40 } = {}) {
  const cutoff = new Date(Date.now() - minAgeDays * 86400000);
  let posts = [];
  try {
    posts = await db.collection('social_posts').find({
      status: 'published',
      publishedAt: { $lte: cutoff },
      scoredAt: { $exists: false },
      'results.ok': true,
    }).sort({ publishedAt: -1 }).limit(limit).toArray();
  } catch { return { scored: 0, examined: 0 }; }
  if (!posts.length) return { scored: 0, examined: 0 };

  // Fetch each needed platform feed ONCE → { postId: metrics }.
  const feeds = {};
  const feedFor = async (platform) => {
    if (feeds[platform] !== undefined) return feeds[platform];
    let map = null;
    try {
      const acct = await db.collection('social_accounts').findOne({ platform });
      if (acct && isAccountConfigured(acct)) {
        const r = await fetchEngagement(platform, acct);
        if (r && r.ok) {
          map = {};
          for (const p of (r.posts || [])) {
            const get = (lbl) => Number((p.metrics || []).find(m => String(m.label || '').toLowerCase() === lbl)?.value) || 0;
            map[String(p.id)] = { likes: get('likes'), comments: get('comments'), shares: get('shares') || get('reposts'), reach: get('reach') || get('views') || get('impressions') };
          }
        }
      }
    } catch { map = null; }
    feeds[platform] = map;
    return map;
  };

  let scored = 0;
  for (const post of posts) {
    let best = null;
    for (const res of (post.results || [])) {
      if (!res.ok || !res.id) continue;
      const map = await feedFor(res.platform);
      const m = map && map[String(res.id)];
      if (m) { const s = scoreOf(m); if (!best || s > best.score) best = { platform: res.platform, ...m, score: s }; }
    }
    const $set = { scoredAt: new Date() };   // mark done even if no data (private/deleted) so we don't re-poll forever
    if (best) { $set.score = best.score; $set.engagement = { likes: best.likes, comments: best.comments, reach: best.reach || 0 }; }
    else { $set.score = null; }
    await db.collection('social_posts').updateOne({ _id: post._id }, { $set }).catch(() => {});
    if (best) {
      const sig = designSignature(post);
      await db.collection('social_scores').insertOne({
        postId: post._id, platform: best.platform, score: best.score,
        likes: best.likes, comments: best.comments, reach: best.reach || 0,
        sig, publishedAt: post.publishedAt, at: new Date(),
      }).catch(() => {});
      scored++;
    }
  }
  return { scored, examined: posts.length };
}

// Reliability% (sample size) + which design signals correlate with a higher score.
export async function getReliability(db) {
  let rows = [];
  try { rows = await db.collection('social_scores').find({ score: { $ne: null } }).sort({ at: -1 }).limit(500).toArray(); } catch { rows = []; }
  const n = rows.length;
  const reliability = Math.min(100, Math.round((n / RELIABILITY_TARGET) * 100));
  if (!n) return { scored: 0, reliability: 0, avg: 0, target: RELIABILITY_TARGET, signals: [] };
  const avg = rows.reduce((a, r) => a + (r.score || 0), 0) / n;
  // Average score per signature dimension value → what's winning, with lift vs. avg.
  const buckets = {};
  for (const r of rows) {
    const s = r.sig || {};
    for (const [dim, val] of [['font', s.fontKind], ['align', s.align], ['aspect', s.aspect], ['style', s.style]]) {
      if (!val) continue;
      const k = dim + ':' + val;
      (buckets[k] = buckets[k] || []).push(r.score || 0);
    }
  }
  const signals = Object.entries(buckets)
    .filter(([, arr]) => arr.length >= 3)
    .map(([key, arr]) => {
      const a = arr.reduce((x, y) => x + y, 0) / arr.length;
      return { key, avg: Math.round(a * 100) / 100, n: arr.length, lift: Math.round(((a / (avg || 1)) - 1) * 100) };
    })
    .sort((a, b) => b.avg - a.avg).slice(0, 8);
  return { scored: n, reliability, avg: Math.round(avg * 100) / 100, target: RELIABILITY_TARGET, signals };
}
