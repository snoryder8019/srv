// ─────────────────────────────────────────────────────────────────────────────
// socialDesign.js — the visual counterpart to socialVoice.js. Learns layout/
// typography taste from 👍/👎 on generated post designs and turns it into
// generation preferences. The node-canvas compositor only renders serif vs
// sans-serif (brand fonts aren't registered there), so the memory learns at that
// grain plus size, alignment and density — all reviewable and prunable.
// Per-tenant collection: `design_feedback`.
// ─────────────────────────────────────────────────────────────────────────────
import { ObjectId } from 'mongodb';

const FB = 'design_feedback';

// Serif brand fonts (matches the Asset Generator's font list) so we can map a
// tenant's heading font to the serif/sans axis the compositor can render.
const SERIF_FONTS = new Set([
  'Cormorant Garamond', 'Playfair Display', 'Lora', 'Merriweather', 'Libre Baskerville',
]);
export function isSerifFont(name) { return SERIF_FONTS.has(String(name || '').trim()); }

// Capture the layout "signature" of a post's design for learning.
export function designSignature(post) {
  const layers = (post && post.design && post.design.layers) || [];
  const headline = layers.find(l => l.type === 'text' && l.bold) || layers.find(l => l.type === 'text');
  const dims = (post && post.dims) || `${(post?.design?.size) || 'ig-post'}`;
  const m = /^(\d+)x(\d+)$/.exec(dims || '');
  const w = m ? +m[1] : 1080, h = m ? +m[2] : 1080;
  const aspect = w > h * 1.15 ? 'landscape' : h > w * 1.15 ? 'portrait' : 'square';
  return {
    dims, aspect,
    fontFamily: headline?.fontFamily || null,
    fontKind: (headline?.fontFamily === 'serif' || isSerifFont(headline?.fontFamily)) ? 'serif' : 'sans',
    align: headline?.align || 'center',
    headlineRatio: headline ? +(headline.fontSize / Math.min(w, h)).toFixed(3) : null,
    headlineLen: (post?.headline || headline?.text || '').length,
    platform: (post?.platforms || [])[0] || null,
  };
}

// Upsert a thumbs verdict for a post (one verdict per post — re-thumbing flips it).
export async function recordDesignFeedback(db, { post, verdict, note = '' }) {
  const v = verdict === 'up' ? 'up' : 'down';
  const sig = designSignature(post);
  await db.collection(FB).updateOne(
    { postId: post._id },
    { $set: {
        postId: post._id, verdict: v, signature: sig, note: String(note || '').slice(0, 200),
        thumb: (post.mediaUrls || [])[0] || null, headline: post.headline || (post.body || '').slice(0, 60),
        platform: sig.platform, updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  return sig;
}

export async function listDesignFeedback(db, limit = 60) {
  return db.collection(FB).find({}).sort({ updatedAt: -1 }).limit(limit).toArray().catch(() => []);
}

export async function removeDesignFeedback(db, id) {
  try { await db.collection(FB).deleteOne({ _id: new ObjectId(id) }); return true; } catch { return false; }
}

// Aggregate all feedback → generation preferences. Transparent net-vote scoring.
export async function getDesignPrefs(db) {
  const prefs = { fontFamily: null, fontKind: null, align: null, headlineScale: 1, sampleUp: 0, sampleDown: 0, avoid: [] };
  let all = [];
  try { all = await db.collection(FB).find({}).limit(500).toArray(); } catch { return prefs; }
  if (!all.length) return prefs;

  const net = {};
  const upR = [], downR = [];
  for (const f of all) {
    const s = f.signature || {}; const d = f.verdict === 'up' ? 1 : -1;
    if (f.verdict === 'up') prefs.sampleUp++; else prefs.sampleDown++;
    if (s.fontFamily) net['fam:' + s.fontFamily] = (net['fam:' + s.fontFamily] || 0) + d;
    if (s.fontKind) net['font:' + s.fontKind] = (net['font:' + s.fontKind] || 0) + d;
    if (s.align) net['align:' + s.align] = (net['align:' + s.align] || 0) + d;
    if (s.headlineRatio != null) (f.verdict === 'up' ? upR : downR).push(s.headlineRatio);
  }
  const best = (prefix) => Object.entries(net).filter(([k]) => k.startsWith(prefix)).sort((a, b) => b[1] - a[1])[0];
  const bfam = best('fam:'); if (bfam && bfam[1] > 0) prefs.fontFamily = bfam[0].slice(4);
  const bf = best('font:'); if (bf && bf[1] > 0) prefs.fontKind = bf[0].split(':')[1];
  const ba = best('align:'); if (ba && ba[1] > 0) prefs.align = ba[0].split(':')[1];
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const u = avg(upR), dn = avg(downR);
  if (u != null && dn != null) { if (dn > u * 1.08) prefs.headlineScale = 0.9; else if (dn < u * 0.92) prefs.headlineScale = 1.08; }
  for (const [k, sc] of Object.entries(net)) if (sc <= -2) prefs.avoid.push(k);
  return prefs;
}

// One-line, human-readable summary of what the memory has learned.
export function describePrefs(prefs) {
  if (!prefs || (!prefs.sampleUp && !prefs.sampleDown)) {
    return 'No design feedback yet — thumb a few drafts 👍/👎 to start teaching layout taste.';
  }
  const bits = [`${prefs.sampleUp}👍 / ${prefs.sampleDown}👎`];
  if (prefs.fontFamily && prefs.fontFamily !== 'serif' && prefs.fontFamily !== 'sans-serif') bits.push(`prefers ${prefs.fontFamily}`);
  else if (prefs.fontKind) bits.push(`prefers ${prefs.fontKind === 'serif' ? 'serif' : 'sans-serif'} headlines`);
  if (prefs.align) bits.push(`${prefs.align}-aligned`);
  if (prefs.headlineScale < 1) bits.push('smaller headlines');
  else if (prefs.headlineScale > 1) bits.push('bigger headlines');
  return bits.join(' · ');
}
