// ─────────────────────────────────────────────────────────────────────────────
// autoSocial.js — Shared auto social-suggestion engine
//
// Generates on-brand social posts (copy + SD-backed image at each connected
// platform's required dimensions). Used by BOTH the cron and the admin
// "Generate now" button. Default mode = 'suggest' → creates review drafts in
// `social_posts` (auto:true, suggestion:true) with the design (sd background +
// layers) stored so they can be edited in the Suggestions dashboard. mode
// 'publish' fires immediately (explicit opt-in only).
// ─────────────────────────────────────────────────────────────────────────────
import { createCanvas, loadImage } from 'canvas';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET, bucketUrl } from './s3.js';
import { callLLM, generateSdImage, buildBrandedSdPrompt, recordTrainingCandidate, webSearch } from './agentMcp.js';
import { loadBrandContext } from './brandContext.js';
import { PLATFORMS, isAccountConfigured, publishToPlatform } from './socialPublish.js';

export const SIZE_PRESETS = {
  'ig-post': [1080, 1080], 'ig-story': [1080, 1920], 'fb-post': [1200, 630],
  'fb-cover': [1640, 624], 'twitter': [1600, 900], 'pinterest': [1000, 1500],
  'yt-thumb': [1280, 720], 'linkedin': [1200, 627], 'ig-portrait': [1080, 1350],
};
// Connected platform → its required social dimensions (size preset)
export const PLATFORM_SIZE = {
  instagram: 'ig-post', facebook: 'fb-post', x: 'twitter', linkedin: 'linkedin',
  pinterest: 'pinterest', threads: 'ig-portrait', mastodon: 'fb-post',
  discord: 'fb-post', telegram: 'fb-post', bluesky: 'fb-post', reddit: 'fb-post', googlebusiness: 'fb-post', youtube: 'yt-thumb', tiktok: 'ig-story',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Composite layers (and optional SD background buffer/url) → PNG buffer.
export async function renderLayersToPng(design) {
  const [w, h] = SIZE_PRESETS[design.size] || SIZE_PRESETS['ig-post'];
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = design.bgColor || '#0D0D14';
  ctx.fillRect(0, 0, w, h);
  let bg = design.sdBackground || null;
  if (!bg && design.sdBgUrl) {
    try { const r = await fetch(design.sdBgUrl, { signal: AbortSignal.timeout(20000) }); if (r.ok) bg = Buffer.from(await r.arrayBuffer()); } catch { /* flat bg */ }
  }
  if (bg) { try { const img = await loadImage(bg); ctx.drawImage(img, 0, 0, w, h); } catch { /* flat bg */ } }
  for (const layer of (design.layers || [])) {
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    if (layer.type === 'rect' && layer.fill) {
      ctx.fillStyle = layer.fill;
      if (layer.radius) { ctx.beginPath(); ctx.roundRect(layer.x, layer.y, layer.w, layer.h, layer.radius); ctx.fill(); }
      else ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
    } else if (layer.type === 'text' && layer.text) {
      const fs = layer.fontSize || 48;
      const fam = layer.fontFamily === 'serif' ? 'serif' : 'sans-serif';
      ctx.font = `${layer.bold ? 'bold ' : ''}${fs}px ${fam}`;
      ctx.fillStyle = layer.color || '#FFFFFF';
      ctx.textAlign = layer.align || 'center';
      ctx.textBaseline = 'top';
      const maxW = layer.w || w - 40;
      const words = String(layer.text).split(' ');
      const lines = []; let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
      }
      if (line) lines.push(line);
      let dx = layer.x || 0;
      if (ctx.textAlign === 'center') dx += maxW / 2; else if (ctx.textAlign === 'right') dx += maxW;
      const lh = fs * 1.3;
      lines.forEach((ln, i) => ctx.fillText(ln, dx, (layer.y || 0) + i * lh));
    }
    ctx.restore();
  }
  return canvas.toBuffer('image/png');
}

export function buildLayers(size, palette, headline, subtitle) {
  const [w, h] = SIZE_PRESETS[size] || SIZE_PRESETS['ig-post'];
  const min = Math.min(w, h);
  return [
    { type: 'rect', x: 0, y: Math.round(h * 0.16), w, h: Math.round(h * 0.68), fill: 'rgba(5,5,8,0.55)', opacity: 1 },
    { type: 'text', text: headline, x: Math.round(w * 0.08), y: Math.round(h * 0.30), w: Math.round(w * 0.84),
      h: Math.round(h * 0.20), fontSize: Math.round(min * 0.085), fontFamily: 'sans-serif', color: palette.accent, align: 'center', bold: true },
    { type: 'text', text: subtitle, x: Math.round(w * 0.10), y: Math.round(h * 0.60), w: Math.round(w * 0.80),
      h: Math.round(h * 0.14), fontSize: Math.round(min * 0.040), fontFamily: 'sans-serif', color: palette.text, align: 'center', bold: false },
  ];
}

export async function uploadPng(buffer, prefix, name) {
  const key = `${prefix || 'default'}/assets/auto/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}.png`;
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: 'image/png', ACL: 'public-read' }), { abortSignal: AbortSignal.timeout(60000) });
  return { key, url: bucketUrl(key) };
}

// ── Background-aware helpers (text placement + reusable auto-folder pool) ──────

// Extract simple mood/palette keywords from an SD seed for tagging + matching.
function bgTagsFromSeed(seed) {
  const stop = new Set(['the','and','with','for','background','abstract','texture','palette','tones','soft','high','resolution']);
  return String(seed || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !stop.has(w)).slice(0, 8);
}

// Analyze a background image and return the calmest horizontal band (as height
// fractions) so headline/subtitle land on a quiet area instead of covering a
// busy/detailed (likely text-bearing) region. Combined luminance-variance +
// edge-energy score; lowest = calmest. Falls back to a safe mid band.
async function analyzeClearBand(buffer, sizePreset) {
  const [W, H] = SIZE_PRESETS[sizePreset] || SIZE_PRESETS['ig-post'];
  const candidates = [ { y0: 0.06, y1: 0.32 }, { y0: 0.37, y1: 0.63 }, { y0: 0.68, y1: 0.94 } ];
  try {
    const img = await loadImage(buffer);
    const sw = 120, sh = Math.max(48, Math.round(120 * H / W));
    const c = createCanvas(sw, sh); const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, sw, sh);
    const d = ctx.getImageData(0, 0, sw, sh).data;
    const lum = (x, y) => { const i = (y * sw + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    let best = null;
    for (const b of candidates) {
      const y0 = Math.floor(b.y0 * sh), y1 = Math.floor(b.y1 * sh);
      let sum = 0, sum2 = 0, edge = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < sw; x++) {
        const l = lum(x, y); sum += l; sum2 += l * l; n++;
        if (x > 0) edge += Math.abs(l - lum(x - 1, y));
      }
      const mean = sum / n, varc = Math.max(0, sum2 / n - mean * mean);
      const busy = varc + (edge / n) * 6;   // edge energy weighted up — text/detail spikes it
      if (!best || busy < best.busy) best = { ...b, busy, mean };
    }
    return { y0: best.y0, y1: best.y1, dark: best.mean < 130 };
  } catch { return { y0: 0.18, y1: 0.82, dark: true }; }
}

// Build text layers positioned inside the clear band (text-aware placement).
function buildLayersSmart(size, palette, headline, subtitle, band) {
  const [w, h] = SIZE_PRESETS[size] || SIZE_PRESETS['ig-post']; const min = Math.min(w, h);
  const by0 = Math.round((band?.y0 ?? 0.18) * h);
  const by1 = Math.round((band?.y1 ?? 0.82) * h);
  const bh = Math.max(Math.round(h * 0.26), by1 - by0);
  return [
    { type: 'rect', x: 0, y: by0, w, h: bh, fill: 'rgba(5,5,8,0.5)', opacity: 1 },
    { type: 'text', text: headline, x: Math.round(w * 0.08), y: by0 + Math.round(bh * 0.16), w: Math.round(w * 0.84), h: Math.round(bh * 0.5), fontSize: Math.round(min * 0.085), fontFamily: 'sans-serif', color: palette.accent, align: 'center', bold: true },
    { type: 'text', text: subtitle, x: Math.round(w * 0.10), y: by0 + Math.round(bh * 0.60), w: Math.round(w * 0.80), h: Math.round(bh * 0.3), fontSize: Math.round(min * 0.04), fontFamily: 'sans-serif', color: palette.text, align: 'center', bold: false },
  ];
}

// Reuse a background already in the tenant's `auto` folder when its metadata
// (description/tags/title) matches the idea's mood — so suggestions draw on the
// growing, curated auto-folder pool instead of always paying for a fresh SD gen.
async function pickPoolBackground(db, seed) {
  try {
    // The whole auto folder is the default background source — exclude only the
    // finished, text-baked composites (tagged 'suggestion').
    const pool = await db.collection('assets').find({
      folder: 'auto', fileType: 'image', tags: { $nin: ['suggestion'] },
    }).sort({ uploadedAt: -1 }).limit(80).toArray();
    if (!pool.length) return null;
    const words = String(seed || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
    let best = null, bestScore = -1;
    for (const a of pool) {
      const hay = ((a.description || '') + ' ' + (a.tags || []).join(' ') + ' ' + (a.title || '')).toLowerCase();
      let score = 0; for (const w of words) if (hay.includes(w)) score++;
      score += Math.random() * 0.6;   // tie-break + variety so we don't reuse one bg forever
      if (score > bestScore) { bestScore = score; best = a; }
    }
    // Auto folder is the default: use the best-ranked image whenever one exists.
    if (!best) return null;
    const r = await fetch(best.publicUrl, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return { buffer: Buffer.from(await r.arrayBuffer()), url: best.publicUrl, assetId: best._id };
  } catch { return null; }
}


// Upcoming holidays / marketing moments within a window of today — always fed
// to the suggestion agent so posts stay timely (fixed + computed floating dates).
function upcomingObservances(daysAhead = 30) {
  const now = new Date(); const Y = now.getFullYear();
  const nth = (y, m, wd, n) => { const d = new Date(y, m, 1); let c = 0; while (true) { if (d.getDay() === wd) { c++; if (c === n) return new Date(d); } d.setDate(d.getDate() + 1); } };
  const lastWd = (y, m, wd) => { const d = new Date(y, m + 1, 0); while (d.getDay() !== wd) d.setDate(d.getDate() - 1); return d; };
  const thx = (y) => nth(y, 10, 4, 4);
  const build = (y) => [
    ['New Year', new Date(y,0,1)], ["Valentine's Day", new Date(y,1,14)], ["St. Patrick's Day", new Date(y,2,17)],
    ['Earth Day', new Date(y,3,22)], ["Mother's Day", nth(y,4,0,2)], ['Memorial Day', lastWd(y,4,1)],
    ["Father's Day", nth(y,5,0,3)], ['Juneteenth', new Date(y,5,19)], ['Independence Day (July 4th)', new Date(y,6,4)],
    ['Labor Day', nth(y,8,1,1)], ['Halloween', new Date(y,9,31)], ['Veterans Day', new Date(y,10,11)],
    ['Thanksgiving', thx(y)],
    ['Black Friday', (()=>{const d=new Date(thx(y));d.setDate(d.getDate()+1);return d;})()],
    ['Small Business Saturday', (()=>{const d=new Date(thx(y));d.setDate(d.getDate()+2);return d;})()],
    ['Cyber Monday', (()=>{const d=new Date(thx(y));d.setDate(d.getDate()+4);return d;})()],
    ['Christmas', new Date(y,11,25)], ["New Year's Eve", new Date(y,11,31)],
  ];
  const soon = [];
  for (const [name, date] of [...build(Y), ...build(Y + 1)]) {
    const diff = (date - now) / 86400000;
    if (diff >= -1 && diff <= daysAhead) soon.push(`${name} (${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`);
  }
  return soon;
}

// Gather recent marketing-worthy content (new blog posts, portfolio pieces) so
// the suggestion agent can promote them — with each item's own image + link.
export async function gatherMarketingContent(db, tenant, { days = 45, limit = 6 } = {}) {
  const base = 'https://' + (tenant?.domain || tenant?.public?.customDomain || tenant?.meta?.customDomain || '');
  const items = [];
  try {
    const blogs = await db.collection('blog').find({ status: 'published' }).sort({ publishedAt: -1, createdAt: -1 }).limit(limit).toArray();
    for (const b of blogs) items.push({ kind: 'blog', title: b.title, summary: (b.excerpt || '').slice(0, 160), url: b.slug ? `${base}/blog/${b.slug}` : base, image: b.featuredImageUrl || '', date: b.publishedAt || b.createdAt, tags: b.tags || [] });
  } catch { /* no blog */ }
  try {
    const port = await db.collection('portfolio').find({ status: 'published' }).sort({ createdAt: -1 }).limit(limit).toArray();
    for (const p of port) items.push({ kind: 'portfolio', title: p.title, summary: (p.description || '').slice(0, 160), url: (p.linkUrl && /^https?:/i.test(p.linkUrl)) ? p.linkUrl : `${base}/portfolio`, image: p.imageUrl || '', date: p.createdAt, tags: p.tags || [], client: p.clientName });
  } catch { /* no portfolio */ }
  items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const now = Date.now();
  items.forEach(it => { it.isNew = it.date && (now - new Date(it.date).getTime()) / 86400000 <= days; });
  const top = items.slice(0, limit);
  const text = top.map(it => `- [${it.kind}${it.isNew ? ', NEW' : ''}] "${it.title}"${it.summary ? ` — ${it.summary}` : ''}${it.url ? ` (${it.url})` : ''}`).join('\n');
  return { items: top, text };
}

export async function draftPosts(brandContext, count, opts = {}) {
  const direction = (opts.direction || '').trim();
  const research = (opts.research || '').trim();
  const obs = upcomingObservances(30);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const holidayLine = obs.length ? `Upcoming dates to weave in where it fits naturally: ${obs.join(', ')}.` : 'No major holidays fall in the next few weeks.';
  const dirLine = direction ? `\nSTEER THIS BATCH — the admin asked you to focus on: "${direction}". Make most posts serve this while keeping variety.` : '';
  const researchBlock = research ? `\n\n--- FRESH RESEARCH (ground your angles in this; never fabricate facts) ---\n${research}\n--- END RESEARCH ---` : '';
  const contentBlock = (opts.content || '').trim() ? `\n\n--- YOUR RECENT CONTENT WORTH PROMOTING (prefer items marked NEW; copy the exact URL into LINK) ---\n${opts.content.trim()}\n--- END CONTENT ---` : '';
  const sys = `You are a senior social media strategist. Using the brand context below, write ${count} DISTINCT, ready-to-post social posts.
${brandContext}

Today is ${today}. ${holidayLine}${dirLine}

Output EXACTLY ${count} blocks in this format and NOTHING else (no prose, no JSON, no fences):
<POST>
TYPE: one of value|service|proof|local|holiday|question|poll|wacky|cta
HEADLINE: 3-6 word punchy on-image headline
SUBTITLE: 5-9 word supporting line for the image
CAPTION: the finished post caption, on-brand, under 240 chars, with 2-4 relevant hashtags
LINK: if this post promotes a listed blog/portfolio item, copy that item's exact URL here VERBATIM; otherwise leave blank
SEED: texture/mood/palette words for an abstract background, NO text or logos
</POST>

Guidance:
- Dig deep: be specific and concrete — reference real services, outcomes, or a local angle, never generic filler.
- Vary angles across the batch: value prop, a specific service, a social-proof/result, local/community, a timely seasonal or HOLIDAY tie-in when one is upcoming, and a clear call-to-action.
- If a holiday or seasonal moment is upcoming, at least one post MUST tie into it naturally.
- If recent content is listed below, make at least one post promote a NEW item: name it specifically, write the caption around it, and copy its exact URL into LINK.
- Make at least one ENGAGEMENT post per batch: either a genuine QUESTION that invites replies, or a comment-to-vote POLL written like "A or B? Tell us below" (native polls aren't supported, so phrase it for the comments).
- About one batch in five, include a single playful/WACKY post that still fits the brand voice.
- Tag every post with its best-fitting TYPE.
- Match the brand voice. Keep HEADLINE and SUBTITLE short.${researchBlock}${contentBlock}`;
  const raw = await callLLM([{ role: 'user', content: `Write ${count} posts now.${direction ? ' Focus: ' + direction : ''}` }], sys, 90000);
  const blocks = raw.match(/<POST>([\s\S]*?)<\/POST>/gi) || [];
  const grab = (b, key) => { const m = b.match(new RegExp('^\\s*' + key + '\\s*:\\s*(.+)$', 'im')); return m ? m[1].trim().replace(/^["'`]|["'`]$/g, '').trim() : ''; };
  let posts = blocks.map(b => { const lk = grab(b, 'LINK'); const tp = grab(b, 'TYPE').toLowerCase().replace(/[^a-z]/g, ''); return { type: tp || 'value', headline: grab(b, 'HEADLINE'), subtitle: grab(b, 'SUBTITLE'), caption: grab(b, 'CAPTION'), image_seed: grab(b, 'SEED'), link: /^https?:\/\//i.test(lk) ? lk : '' }; }).filter(p => p.caption || p.headline);
  if (!posts.length) throw new Error('LLM returned unparseable posts: ' + raw.slice(0, 200));
  return posts.slice(0, count);
}

// Publish with IG-aware transient retry (Meta container ingestion lag).
export async function publishWithRetry(platform, post, account) {
  let r = await publishToPlatform(platform, post, account);
  for (let i = 0; i < 3 && !r.ok && /not ready|9007|2207027/i.test(r.error || ''); i++) {
    await sleep(15000);
    r = await publishToPlatform(platform, post, account);
  }
  return r;
}

/**
 * Generate posts for a single tenant.
 * @param {object} tenant registry doc (has db, s3Prefix, brand)
 * @param {object} db tenant Mongo db handle
 * @param {object} opts { count=5, platforms?:[], mode:'suggest'|'publish', createdBy }
 * @returns {object} { tenant, created, published, failed, items }
 */
// Attach a post to a known content item when its title clearly appears in the
// post copy — robust fallback so promotion works even if the model omits LINK.
function matchContentItem(idea, items) {
  const hay = ((idea.headline || '') + ' ' + (idea.caption || '')).toLowerCase();
  const stop = new Set(['your','with','from','this','that','again','over','will','have','madladslab','custom']);
  let best = null, bestScore = 0;
  for (const it of items || []) {
    const words = String(it.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !stop.has(w));
    if (words.length < 2) continue;
    let score = 0;
    for (const w of words) { const stem = w.replace(/s$/, ''); if (hay.includes(w) || hay.includes(stem)) score++; }
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return bestScore >= 2 ? best : null;
}

// Quote-centric layout for spotlight/quote posts (longer text, centered block).
function buildQuoteLayers(size, palette, quote, attribution, label, band) {
  const [w, h] = SIZE_PRESETS[size] || SIZE_PRESETS['ig-post']; const min = Math.min(w, h);
  let by0 = Math.round((band?.y0 ?? 0.14) * h);
  let bh = Math.round((band?.y1 ?? 0.86) * h) - by0;
  if (bh < h * 0.45) { bh = Math.round(h * 0.58); by0 = Math.round((h - bh) / 2); }
  const top = by0;
  const qlen = (quote || '').length;
  const qf = qlen > 150 ? 0.038 : qlen > 100 ? 0.044 : qlen > 60 ? 0.05 : 0.058;
  const layers = [
    { type: 'rect', x: 0, y: top, w, h: bh, fill: 'rgba(5,5,8,0.55)', opacity: 1 },
    { type: 'text', text: (label || '').toUpperCase(), x: Math.round(w * 0.1), y: top + Math.round(bh * 0.09), w: Math.round(w * 0.8), h: Math.round(bh * 0.12), fontSize: Math.round(min * 0.034), fontFamily: 'sans-serif', color: palette.accent, align: 'center', bold: true },
    { type: 'text', text: `\u201C${quote}\u201D`, x: Math.round(w * 0.10), y: top + Math.round(bh * 0.27), w: Math.round(w * 0.80), h: Math.round(bh * 0.5), fontSize: Math.round(min * qf), fontFamily: 'serif', color: palette.text, align: 'center', bold: false, italic: true },
  ];
  if (attribution) layers.push({ type: 'text', text: attribution, x: Math.round(w * 0.1), y: top + Math.round(bh * 0.84), w: Math.round(w * 0.8), h: Math.round(bh * 0.12), fontSize: Math.round(min * 0.032), fontFamily: 'sans-serif', color: palette.accent, align: 'center', bold: true });
  return layers;
}

/**
 * Build a single quote/spotlight suggestion (owner spotlight, mission, or
 * customer quote). The quote is used VERBATIM — the model only writes the
 * surrounding caption. Renders one suggestion per connected platform.
 */
export async function generateSpotlight(tenant, db, opts = {}) {
  const kind = ['owner', 'mission', 'customer'].includes(opts.kind) ? opts.kind : 'owner';
  const subject = (opts.subject || '').toString().slice(0, 80);
  const role = (opts.role || '').toString().slice(0, 80);
  const quote = (opts.quote || '').toString().trim().slice(0, 400);
  const createdBy = opts.createdBy || 'admin';
  if (!quote) return { created: 0, error: 'A quote is required' };

  const accounts = await db.collection('social_accounts').find({}).toArray();
  let eligible = accounts.filter(a => { const def = PLATFORMS[a.platform] || {}; return a.enabled !== false && !def.comingSoon && isAccountConfigured(a); });
  if (Array.isArray(opts.platforms) && opts.platforms.length) { const only = new Set(opts.platforms); eligible = eligible.filter(a => only.has(a.platform)); }
  if (!eligible.length) return { created: 0, note: 'no eligible platforms' };

  const designRaw = await db.collection('design').find({}).toArray();
  const D = {}; for (const d of designRaw) D[d.key] = d.value;
  const palette = { bg: D.color_primary || '#0D0D14', accent: D.color_accent || '#FFD700', text: D.color_text || '#E8E8F0' };
  const brandContext = await loadBrandContext(tenant, db);

  const label = kind === 'owner' ? 'Owner Spotlight' : kind === 'mission' ? 'Our Mission' : 'Client Love';
  const attribution = subject ? `\u2014 ${subject}${role ? `, ${role}` : ''}` : '';

  const sys = `You are a social media strategist for the brand below.\n${brandContext}\n\nWrite ONE on-brand caption for a "${label}" post built around this EXACT quote (never alter or invent a quote): "${quote}"${subject ? ` by ${subject}${role ? `, ${role}` : ''}` : ''}.\nReturn ONLY the caption text — no surrounding quotes, no preamble — under 240 characters, with 2-4 relevant hashtags.`;
  let caption = '';
  try { caption = (await callLLM([{ role: 'user', content: 'Write the caption.' }], sys, 60000)).trim().replace(/^["'`]|["'`]$/g, ''); } catch { /* fallback below */ }
  if (!caption) caption = `${quote} ${attribution}`.trim();
  caption = caption.slice(0, 2000);
  const seed = kind === 'mission' ? 'mission values purpose abstract gradient texture' : 'spotlight studio backdrop soft bokeh abstract';

  // Background: auto folder default, SD fallback.
  let sdBuf = null, sdBgUrl = null;
  const pooled = await pickPoolBackground(db, seed);
  if (pooled) { sdBuf = pooled.buffer; sdBgUrl = pooled.url; }
  else {
    try {
      const branded = await buildBrandedSdPrompt(seed, brandContext, { sizePreset: 'fb-post' });
      sdBuf = await generateSdImage(branded.prompt, branded.negative, 'fb-post');
      const up = await uploadPng(sdBuf, tenant.s3Prefix, 'spotlight-bg');
      sdBgUrl = up.url;
      await db.collection('assets').insertOne({
        filename: up.key.split('/').pop(), originalName: 'spotlight-bg.png', folders: ['auto'], folder: 'auto', clientId: null,
        publicUrl: up.url, bucketKey: up.key, fileType: 'image', mimeType: 'image/png', size: sdBuf.length,
        title: `${label} background`, description: branded.prompt,
        tags: ['background', 'auto', 'reusable-bg', ...bgTagsFromSeed(seed)], auto: true, uploadedAt: new Date(),
      });
    } catch { /* flat bg */ }
  }
  const band = sdBuf ? await analyzeClearBand(sdBuf, 'fb-post') : { y0: 0.14, y1: 0.86, dark: true };

  const out = { created: 0, items: [] };
  for (const acct of eligible) {
    const platform = acct.platform;
    const size = PLATFORM_SIZE[platform] || 'ig-post';
    const [pw, ph] = SIZE_PRESETS[size];
    const layers = buildQuoteLayers(size, palette, quote, attribution, label, band);
    const png = await renderLayersToPng({ size, bgColor: palette.bg, sdBackground: sdBuf, layers });
    const up = await uploadPng(png, tenant.s3Prefix, `${platform}-spotlight`);
    const design = { size, bgColor: palette.bg, sdBgUrl, layers };
    const assetDoc = {
      filename: up.key.split('/').pop(), originalName: `${label}-${platform}.png`,
      folders: ['auto'], folder: 'auto', clientId: null,
      publicUrl: up.url, bucketKey: up.key, fileType: 'image', mimeType: 'image/png', size: png.length,
      title: `${label} \u2014 ${platform} (${pw}x${ph})`, description: caption,
      tags: ['social', 'auto', 'suggestion', 'spotlight', kind, platform, `${pw}x${ph}`], auto: true,
      generatedFrom: { source: 'spotlight', kind, subject, role, quote, platform, size, dims: [pw, ph], design, createdAt: new Date() },
      uploadedAt: new Date(),
    };
    const insAsset = await db.collection('assets').insertOne(assetDoc);
    const post = {
      body: caption, link: '', mediaUrls: [up.url], platforms: [platform], status: 'draft',
      suggestion: true, auto: true, source: 'spotlight', kind: `spotlight-${kind}`,
      headline: label, subtitle: attribution, seed, design, dims: `${pw}x${ph}`,
      assetIds: [insAsset.insertedId], scheduledAt: null, publishedAt: null, results: [],
      createdBy, createdAt: new Date(), updatedAt: new Date(),
    };
    const insPost = await db.collection('social_posts').insertOne(post);
    out.created++; out.items.push({ _id: insPost.insertedId, platform, dims: `${pw}x${ph}` });
  }
  return out;
}

export async function generateForTenant(tenant, db, opts = {}) {
  const count = Math.max(1, Math.min(20, opts.count || 5));
  const mode = opts.mode === 'publish' ? 'publish' : 'suggest';
  const createdBy = opts.createdBy || 'auto-social';

  const accounts = await db.collection('social_accounts').find({}).toArray();
  let eligible = accounts.filter(a => { const def = PLATFORMS[a.platform] || {}; return a.enabled !== false && !def.comingSoon && isAccountConfigured(a); });
  if (Array.isArray(opts.platforms) && opts.platforms.length) { const only = new Set(opts.platforms); eligible = eligible.filter(a => only.has(a.platform)); }
  if (!eligible.length) return { tenant: tenant.brand?.name || tenant.domain, created: 0, published: 0, failed: 0, items: [], note: 'no eligible platforms' };

  const acctByPlatform = {}; for (const a of eligible) acctByPlatform[a.platform] = a;
  const publishable = new Set(eligible.filter(a => a.lastTestOk !== false).map(a => a.platform));

  const designRaw = await db.collection('design').find({}).toArray();
  const D = {}; for (const d of designRaw) D[d.key] = d.value;
  const palette = { bg: D.color_primary || '#0D0D14', accent: D.color_accent || '#FFD700', text: D.color_text || '#E8E8F0' };

  const brandContext = await loadBrandContext(tenant, db);
  let research = '';
  try {
    const q = [tenant.brand?.name, tenant.brand?.businessType, opts.direction, 'social media content ideas'].filter(Boolean).join(' ').slice(0, 180);
    const r = await webSearch(q);
    if (r && !/^(Search|No results|Fetch)/.test(r)) research = r.slice(0, 1500);
  } catch { /* research optional */ }
  if (opts.trends && opts.trends.trim()) research = (research ? research + '\n\n' : '') + 'CURRENT TRENDS / LISTENER FINDINGS (work in timely angles where they fit):\n' + opts.trends.trim();
  const marketing = await gatherMarketingContent(db, tenant).catch(() => ({ items: [], text: '' }));
  const ideas = await draftPosts(brandContext, count, { direction: opts.direction, research, content: marketing.text });

  const out = { tenant: tenant.brand?.name || tenant.domain, db: tenant.db, created: 0, published: 0, failed: 0, items: [] };
  let idx = 0;
  for (const idea of ideas) {
    idx++;
    const headline = (idea.headline || idea.caption || 'Update').slice(0, 80);
    const subtitle = (idea.subtitle || '').slice(0, 90);
    const caption = (idea.caption || headline).slice(0, 2000);
    const seed = idea.image_seed || '';
    // Auto-attach a content link when a post clearly promotes a known blog/portfolio item.
    if (!(idea.link || '').trim()) { const m = matchContentItem(idea, marketing.items); if (m) idea.link = m.url; }

    // Background: reuse a matching one from the auto-folder pool, else SD-generate
    // a fresh on-theme bg and save it back into the pool (with metadata) for reuse.
    let sdBuf = null, sdBgUrl = null;
    // If this post promotes a content item with its own image, use that image as the bg.
    const promo = (idea.link || '').trim() ? marketing.items.find(it => it.image && it.url === idea.link.trim()) : null;
    if (promo) {
      try { const r = await fetch(promo.image, { signal: AbortSignal.timeout(20000) }); if (r.ok) { sdBuf = Buffer.from(await r.arrayBuffer()); sdBgUrl = promo.image; } } catch { /* fall through to pool/SD */ }
    }
    const pooled = sdBuf ? null : await pickPoolBackground(db, seed);
    if (pooled) {
      sdBuf = pooled.buffer; sdBgUrl = pooled.url;
    } else if (!sdBuf) {
      try {
        const branded = await buildBrandedSdPrompt(seed, brandContext, { sizePreset: 'fb-post' });
        sdBuf = await generateSdImage(branded.prompt, branded.negative, 'fb-post');
        const up = await uploadPng(sdBuf, tenant.s3Prefix, `sdbg-${idx}`);
        sdBgUrl = up.url;
        await db.collection('assets').insertOne({
          filename: up.key.split('/').pop(), originalName: `bg-${idx}.png`,
          folders: ['auto'], folder: 'auto', clientId: null,
          publicUrl: up.url, bucketKey: up.key, fileType: 'image', mimeType: 'image/png', size: sdBuf.length,
          title: `${headline} background`, description: branded.prompt,
          tags: ['background', 'auto', 'reusable-bg', ...bgTagsFromSeed(seed)], auto: true,
          generatedFrom: { source: 'auto-social-bg', seed, prompt: branded.prompt, createdAt: new Date() },
          uploadedAt: new Date(),
        });
        recordTrainingCandidate({ prompt: branded.prompt, negativePrompt: branded.negative, sizePreset: 'fb-post', bucketKey: up.key, publicUrl: up.url, byteSize: sdBuf.length, source: 'auto-social', tenant: { db: tenant.db, name: tenant.brand?.name, prefix: tenant.s3Prefix } });
      } catch { /* flat bg fallback */ }
    }
    // Find the calmest band so text doesn't cover busy / text-bearing areas.
    const band = sdBuf ? await analyzeClearBand(sdBuf, 'fb-post') : { y0: 0.18, y1: 0.82, dark: true };

    for (const acct of eligible) {
      const platform = acct.platform;
      const size = PLATFORM_SIZE[platform] || 'ig-post';
      const [pw, ph] = SIZE_PRESETS[size];
      const layers = buildLayersSmart(size, palette, headline, subtitle, band);
      const png = await renderLayersToPng({ size, bgColor: palette.bg, sdBackground: sdBuf, layers });
      const up = await uploadPng(png, tenant.s3Prefix, `${platform}-auto-${idx}`);

      const design = { size, bgColor: palette.bg, sdBgUrl, layers };
      const assetDoc = {
        filename: up.key.split('/').pop(), originalName: `${headline}-${platform}.png`,
        folders: ['auto'], folder: 'auto', clientId: null,
        publicUrl: up.url, bucketKey: up.key, fileType: 'image', mimeType: 'image/png', size: png.length,
        title: `${headline} — ${platform} (${pw}x${ph})`,
        description: caption,
        tags: ['social', 'auto', 'suggestion', platform, `${pw}x${ph}`], auto: true,
        generatedFrom: { source: 'auto-social', headline, caption, seed, platform, size, dims: [pw, ph], design, createdAt: new Date() },
        uploadedAt: new Date(),
      };
      const insAsset = await db.collection('assets').insertOne(assetDoc);

      const willPublish = mode === 'publish' && publishable.has(platform);
      const post = {
        body: caption, link: (idea.link || '').trim(), mediaUrls: [up.url], platforms: [platform],
        status: willPublish ? 'publishing' : 'draft',
        suggestion: mode !== 'publish', auto: true, source: 'auto', kind: idea.type || null,
        headline, subtitle, seed, design, dims: `${pw}x${ph}`,
        assetIds: [insAsset.insertedId], scheduledAt: null, publishedAt: null, results: [],
        createdBy, createdAt: new Date(), updatedAt: new Date(),
      };
      const insPost = await db.collection('social_posts').insertOne(post);
      out.created++;

      if (willPublish) {
        const r = await publishWithRetry(platform, post, acctByPlatform[platform]);
        await db.collection('social_posts').updateOne({ _id: insPost.insertedId }, { $set: { status: r.ok ? 'published' : 'failed', results: [r], publishedAt: new Date(), updatedAt: new Date() } });
        if (r.ok) out.published++; else out.failed++;
        out.items.push({ _id: insPost.insertedId, platform, status: r.ok ? 'published' : 'failed', url: up.url, dims: `${pw}x${ph}` });
      } else {
        out.items.push({ _id: insPost.insertedId, platform, status: 'draft', url: up.url, dims: `${pw}x${ph}`, caption });
      }
    }
  }
  return out;
}
