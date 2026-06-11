// ── socialListen.js ───────────────────────────────────────────────────────────
// Keyword listeners + trend gathering for the social section. Each keyword pulls
// a web roundup (via webSearch) and recent Reddit posts, storing findings in a
// per-tenant "digest" that the suggestion agent can fold into its posts.
import { ObjectId } from 'mongodb';
import { webSearch } from './agentMcp.js';
import { unpackCredentials, redditAccessToken } from './socialPublish.js';

// ── Keywords ──
export async function listKeywords(db) {
  return db.collection('social_listeners').find({}).sort({ createdAt: -1 }).toArray();
}
export async function addKeyword(db, keyword, sources) {
  keyword = (keyword || '').trim();
  if (!keyword) return null;
  await db.collection('social_listeners').updateOne(
    { keyword },
    { $setOnInsert: { keyword, createdAt: new Date() }, $set: { sources: (sources && sources.length) ? sources : ['web', 'reddit'], enabled: true } },
    { upsert: true },
  );
  return db.collection('social_listeners').findOne({ keyword });
}
export async function removeKeyword(db, id) {
  await db.collection('social_listeners').deleteOne({ _id: new ObjectId(id) });
}

// ── Digest ──
export async function addDigestItem(db, item) {
  if (!item.url) item.url = `note:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
  await db.collection('social_digest').updateOne(
    { url: item.url },
    { $set: { ...item, updatedAt: new Date() }, $setOnInsert: { fetchedAt: new Date(), handled: false } },
    { upsert: true },
  );
}
export async function getDigest(db, { days = 21, limit = 150 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  return db.collection('social_digest').find({ fetchedAt: { $gte: since } }).sort({ fetchedAt: -1 }).limit(limit).toArray();
}
export async function removeDigestItem(db, id) {
  await db.collection('social_digest').deleteOne({ _id: new ObjectId(id) });
}
// Compact text of recent trends for feeding the suggestion agent.
export async function trendSummary(db, { days = 10, limit = 20 } = {}) {
  const items = await getDigest(db, { days, limit });
  if (!items.length) return '';
  return items.map(i => `- [${i.keyword || i.source}] ${i.title}${i.snippet ? ` — ${String(i.snippet).slice(0, 140)}` : ''}${i.url && !/^(note|web):/.test(i.url) ? ` (${i.url})` : ''}`).join('\n');
}

// ── Sources ──
async function redditSearch(db, keyword) {
  const account = await db.collection('social_accounts').findOne({ platform: 'reddit', enabled: { $ne: false } });
  if (!account) return [];
  try {
    const creds = unpackCredentials(account);
    const { token, ua } = await redditAccessToken(creds);
    const r = await fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(keyword)}&sort=new&limit=8&type=link`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua }, signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    return (j?.data?.children || []).map(c => ({
      source: 'reddit', keyword, title: (c.data.title || '').slice(0, 180),
      url: 'https://reddit.com' + c.data.permalink,
      snippet: (c.data.selftext || '').replace(/\s+/g, ' ').slice(0, 200),
      meta: `r/${c.data.subreddit} · ${c.data.num_comments || 0} comments`,
    }));
  } catch { return []; }
}

// Run listeners for all enabled keywords (or one ad-hoc keyword).
export async function runListeners(db, tenant, { keyword = null } = {}) {
  const kws = keyword
    ? [{ keyword, sources: ['web', 'reddit'] }]
    : (await listKeywords(db)).filter(k => k.enabled !== false);
  let added = 0;
  for (const k of kws) {
    const q = k.keyword;
    const sources = k.sources || ['web', 'reddit'];
    if (sources.includes('web')) {
      try {
        const t = await webSearch(`${q} latest news trends ${new Date().getFullYear()}`);
        if (t && t.trim() && !/^(no results|search)/i.test(t)) {
          await addDigestItem(db, {
            source: 'web', keyword: q, title: `${q} — web roundup`,
            snippet: t.replace(/\s+/g, ' ').slice(0, 500),
            url: `web:${q.toLowerCase()}:${new Date().toISOString().slice(0, 10)}`,
          });
          added++;
        }
      } catch { /* web optional */ }
    }
    if (sources.includes('reddit')) {
      for (const it of await redditSearch(db, q)) { await addDigestItem(db, it); added++; }
    }
    await db.collection('social_listeners').updateOne({ keyword: q }, { $set: { lastRun: new Date() } });
  }
  return { ok: true, keywords: kws.length, items: added };
}
