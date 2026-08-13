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
import { loadVoiceBlock } from './socialVoice.js';
import { getDesignPrefs, isSerifFont } from './socialDesign.js';
import { fontToken, isRegisteredFont } from './canvasFonts.js';   // registers brand TTFs on import
import { PLATFORMS, isAccountConfigured, publishToPlatform } from './socialPublish.js';

export const SIZE_PRESETS = {
  'ig-post': [1080, 1080], 'ig-story': [1080, 1920], 'fb-post': [1200, 630],
  'fb-cover': [1640, 624], 'twitter': [1600, 900], 'pinterest': [1000, 1500],
  'yt-thumb': [1280, 720], 'linkedin': [1200, 627], 'ig-portrait': [1080, 1350],
};
// Connected platform → its required social dimensions (size preset)
// Feed-style platforms use SQUARE (1080²), not the wide 1.9:1 'fb-post' link-preview
// size — a 1200×630 image gets cropped in-feed (and in the square review card),
// pushing the centered text outside the visible window. Only X (16:9) and
// LinkedIn (1.9:1), whose feeds render wide natively, keep a landscape preset.
export const PLATFORM_SIZE = {
  instagram: 'ig-post', facebook: 'ig-post', x: 'twitter', linkedin: 'linkedin',
  pinterest: 'pinterest', threads: 'ig-portrait', mastodon: 'ig-post',
  discord: 'ig-post', telegram: 'ig-post', bluesky: 'ig-post', reddit: 'ig-post', googlebusiness: 'ig-post', youtube: 'yt-thumb', tiktok: 'ig-story',
};

// Native voice/format rules per platform — drives DISTINCT, platform-tailored
// copy (no carbon-copy fan-out). max = soft char target; tags/links/mentions
// shape hashtags, URL handling, and @-mention etiquette per network.
export const PLATFORM_STYLE = {
  bluesky:        { max: 300, vibe: 'punchy, witty, a little playful; conversational', tags: '0–2 lowercase hashtags', links: 'bare URLs are NOT clickable here — avoid links unless essential', mentions: '@-mentions welcome' },
  mastodon:       { max: 500, vibe: 'warm, community-minded, earnest with light humor', tags: '2–4 hashtags (CamelCase ok)', links: 'links are clickable', mentions: '@-mentions welcome' },
  facebook:       { max: 600, vibe: 'friendly, story-driven, approachable', tags: '0–2 hashtags max', links: 'links get a preview card', mentions: 'avoid raw @-handles' },
  instagram:      { max: 400, vibe: 'visual-first, energetic, playful', tags: '3–8 relevant hashtags', links: 'links are NOT clickable — say "link in bio" if needed', mentions: '@-mentions ok' },
  threads:        { max: 480, vibe: 'casual, playful, conversational', tags: '1–3 hashtags', links: 'links allowed', mentions: '@-mentions ok' },
  x:              { max: 270, vibe: 'sharp, punchy, witty', tags: '1–2 hashtags', links: 'links allowed', mentions: '@-mentions ok' },
  linkedin:       { max: 500, vibe: 'professional but human, insight-driven', tags: '2–3 hashtags', links: 'links allowed', mentions: 'company @-mentions ok' },
  reddit:         { max: 500, vibe: 'authentic, value-first, zero marketing-speak', tags: 'NO hashtags', links: 'link or self-post', mentions: 'no @-handles' },
  discord:        { max: 600, vibe: 'casual community chat, hype-friendly', tags: 'NO hashtags', links: 'links allowed', mentions: 'no @-handles' },
  telegram:       { max: 600, vibe: 'newsy, friendly, direct', tags: '0–2 hashtags', links: 'links allowed', mentions: 'no @-handles' },
  googlebusiness: { max: 700, vibe: 'informative, local, trustworthy', tags: 'NO hashtags', links: 'CTA button', mentions: 'no @-handles' },
};
function platformStyle(p) { return PLATFORM_STYLE[p] || { max: 280, vibe: 'on-brand and engaging', tags: '2–3 hashtags', links: 'links allowed', mentions: '@-mentions ok' }; }

// Readable "own channels" lines so the agent can cross-mention the brand's other
// accounts where it fits. Built from each connected account's verified profile.
export function buildHandleMap(accounts) {
  const out = {};
  for (const a of accounts) {
    const prof = a.profile || {};
    let handle = prof.name || '';
    if (a.platform === 'bluesky') handle = (a.credentials?.identifier ? '@' + a.credentials.identifier : (prof.name ? '@' + prof.name : ''));
    else if (a.platform === 'mastodon' && prof.name) handle = '@' + String(prof.name).replace(/^@/, '');
    else if (a.platform === 'instagram' && prof.name) handle = '@' + String(prof.name).replace(/^@/, '');
    if (handle || prof.url) out[a.platform] = { handle: handle || prof.url, url: prof.url || '' };
  }
  return out;
}

// Strip template placeholders the model sometimes leaves in copy — e.g.
// "[Greeley]", "(your business)", "(insert offer)" — so captions read as finished
// posts, never fill-in-the-blank stubs.
export function cleanCopy(s) {
  return String(s || '')
    .replace(/\((?:insert|enter|add|your|company|business|e\.?g\.?\,?|tbd|name|link|url)[^)]*\)/gi, '')
    .replace(/\[([^\]]*)\]/g, '$1')          // keep the word, drop the brackets: [Greeley] → Greeley
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Color theory: pick the most legible ON-BRAND text color for a background ──
// WCAG relative luminance + contrast ratio, so headlines never disappear into the
// backdrop while still preferring the brand palette over plain black/white.
function _lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 0.5;
  const c = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function _contrast(a, b) { const l1 = _lum(a), l2 = _lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
// bandIsDark → the text sits on a dark area. candidates are tried in order and the
// highest-contrast one wins; if even the best brand color is weak, fall back to a
// near-white / near-black that guarantees legibility.
function bestTextColor(bandIsDark, palette, candidates) {
  const bg = bandIsDark ? '#0A0A0F' : '#F2F2F2';
  const pool = (candidates && candidates.length ? candidates : [palette.accent, palette.text, '#FFFFFF', '#0D0D14']).filter(Boolean);
  let best = pool[0], bestC = 0;
  for (const c of pool) { const k = _contrast(c, bg); if (k > bestC) { bestC = k; best = c; } }
  if (bestC < 3) best = bandIsDark ? '#F7F7FA' : '#0D0D14';   // WCAG-safe fallback
  return best;
}

// Remove emoji / pictographs / flag regional-indicators / variation-selectors —
// glyphs the brand fonts can't render (they show as tofu boxes with the codepoint
// on the canvas). Keeps plain text + common punctuation; collapses leftover space.
const CANVAS_EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;
function stripCanvasEmoji(s) {
  return String(s || '').replace(CANVAS_EMOJI_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}

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
  if (bg) {
    try {
      const img = await loadImage(bg);
      // Cover-fit (scale to fill + center-crop) instead of stretch — the shared SD
      // background is generated wide (fb-post) but composited onto each platform's
      // canvas, so stretching would distort it on square/portrait sizes.
      const s = Math.max(w / img.width, h / img.height);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } catch { /* flat bg */ }
  }
  for (const layer of (design.layers || [])) {
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    if (layer.type === 'image' && (layer._buf || layer.src)) {
      // Logo / image overlay — contain-fit inside the layer box, centered.
      try {
        const buf = layer._buf || await fetchImgBuf(layer.src);
        if (buf) {
          const im = await loadImage(buf);
          const s = Math.min(layer.w / im.width, layer.h / im.height);
          const dw = im.width * s, dh = im.height * s;
          ctx.drawImage(im, layer.x + (layer.w - dw) / 2, layer.y + (layer.h - dh) / 2, dw, dh);
        }
      } catch { /* skip a broken image layer */ }
    } else if (layer.type === 'rect' && layer.fill) {
      ctx.fillStyle = layer.fill;
      if (layer.radius) { ctx.beginPath(); ctx.roundRect(layer.x, layer.y, layer.w, layer.h, layer.radius); ctx.fill(); }
      else ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
    } else if (layer.type === 'text' && layer.text) {
      const fam = fontToken(layer.fontFamily);   // registered brand family, else serif/sans
      const weight = layer.bold ? 'bold ' : '';
      ctx.fillStyle = layer.color || '#FFFFFF';
      ctx.textAlign = layer.align || 'center';
      ctx.textBaseline = 'top';
      const maxW = layer.w || (w - 40);
      const maxH = layer.h || (h - (layer.y || 0) - 10);
      // Brand fonts have no emoji glyphs, so emoji in image text render as tofu
      // boxes (e.g. the U+1F1FA flag codepoint). Strip them from the overlay — the
      // post caption keeps its emoji; only the rendered graphic drops them.
      const text = stripCanvasEmoji(String(layer.text).trim());
      const wrap = (fs) => {
        ctx.font = `${weight}${fs}px ${fam}`;
        const lines = []; let line = '';
        for (const word of text.split(/\s+/)) {
          const test = line ? line + ' ' + word : word;
          if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
        }
        if (line) lines.push(line);
        return lines;
      };
      // Fit the wrapped text to the layer's w×h box. `fits(fs)` returns the wrapped
      // lines when they sit inside the box, else null. Default: shrink from the
      // target. With layer.grow: find the LARGEST size that fits (short copy fills
      // the bounding rect — better use of the pixel space, steadier visual weight).
      const fitsAt = (fs) => {
        const ls = wrap(fs);
        const widest = Math.max(0, ...ls.map(l => ctx.measureText(l).width));
        return (ls.length * fs * 1.25 <= maxH && widest <= maxW) ? ls : null;
      };
      const target = layer.fontSize || 48;
      let fs, lines;
      if (layer.grow) {
        const cap = Math.max(target, Math.min(Math.round(maxH * 0.9), Math.round(target * 2.4)));
        fs = 14; lines = wrap(14);
        for (let t = cap; t >= 14; t -= 2) { const ls = fitsAt(t); if (ls) { fs = t; lines = ls; break; } }
      } else {
        fs = target; lines = wrap(fs);
        for (; fs >= 14; fs -= 2) { const ls = fitsAt(fs); if (ls) { lines = ls; break; } }
      }
      ctx.font = `${weight}${fs}px ${fam}`;
      const lh = fs * 1.25;
      // Vertically center the wrapped block within its box, clamped to the canvas.
      const blockH = lines.length * lh;
      const dy = Math.max(2, (layer.y || 0) + Math.max(0, (maxH - blockH) / 2));
      let dx = layer.x || 0;
      if (ctx.textAlign === 'center') dx += maxW / 2; else if (ctx.textAlign === 'right') dx += maxW;
      lines.forEach((ln, i) => { const y = dy + i * lh; if (y + lh <= h) ctx.fillText(ln, dx, y); });
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

// Small module-level cache so a logo (or any image-layer URL) reused across a
// whole batch is fetched once, not per post.
const _imgBufCache = new Map();
async function fetchImgBuf(url) {
  if (_imgBufCache.has(url)) return _imgBufCache.get(url);
  let buf = null;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); } catch { /* leave null */ }
  _imgBufCache.set(url, buf);
  return buf;
}

// Logo slots the autogen may use, dark-bg first (light/white marks) then light-bg.
// Admins can upload to any of these in /admin/design → Brand Images.
const LOGO_SLOTS_LIGHT = ['logo_social_white', 'logo_white', 'logo_social', 'logo_primary', 'logo_icon'];
const LOGO_SLOTS_DARK = ['logo_social', 'logo_primary', 'logo_badge', 'logo_social_white', 'logo_white', 'logo_icon'];
async function findBrandLogo(db, prefer = 'light') {
  const order = prefer === 'dark' ? LOGO_SLOTS_DARK : LOGO_SLOTS_LIGHT;
  for (const slot of order) {
    const row = await db.collection('brand_images').findOne({ slot }).catch(() => null);
    if (row?.url) return { url: row.url, slot };
  }
  return null;
}

// SOLID typographic poster — no SD photo, just a brand color fill + large brand
// typeface filling the frame, an accent rule, the subtitle, and (if present) the
// logo. Clean and reliable — the antidote to muddy SD backgrounds.
function buildSolidDesign(size, palette, headline, subtitle, opts = {}) {
  const [w, h] = SIZE_PRESETS[size] || SIZE_PRESETS['ig-post']; const min = Math.min(w, h);
  const prefs = opts.prefs || {};
  const pick = (...c) => c.find(f => f && isRegisteredFont(f));
  const headFont = pick(prefs.fontFamily, opts.headingFont) || (opts.headingSerif ? 'serif' : 'sans-serif');
  const bodyFont = pick(opts.bodyFont, opts.headingFont) || 'sans-serif';
  const align = (prefs.align === 'left' || prefs.align === 'right') ? prefs.align : 'center';
  const padX = Math.round(w * 0.10); const innerW = w - padX * 2;
  const hasSub = !!(subtitle && String(subtitle).trim());
  const logo = opts.logo || null;

  // Solid poster: text sits on the brand background — pick the on-brand color with
  // the best contrast against it (color theory), and a matching accent rule.
  const bgDark = _lum(palette.bg) < 0.42;
  const headColor = bestTextColor(bgDark, palette, [palette.accent, palette.text, bgDark ? '#FFFFFF' : '#0D0D14']);
  const subColor = bestTextColor(bgDark, palette, [palette.text, palette.accent, bgDark ? '#FFFFFF' : '#0D0D14']);
  const ruleColor = bestTextColor(bgDark, palette, [palette.accent, palette.text]);

  const layers = [];
  const headY = Math.round(h * (logo ? 0.18 : 0.15));
  const headH = Math.round(h * (hasSub ? 0.42 : 0.54));
  layers.push({ type: 'text', text: headline, x: padX, y: headY, w: innerW, h: headH, fontSize: Math.round(min * 0.17 * (prefs.headlineScale || 1)), fontFamily: headFont, color: headColor, align, bold: true, grow: true });
  const ruleW = Math.round(w * 0.16);
  const ruleX = align === 'center' ? Math.round((w - ruleW) / 2) : padX;
  const ruleY = headY + headH + Math.round(h * 0.012);
  layers.push({ type: 'rect', x: ruleX, y: ruleY, w: ruleW, h: Math.max(4, Math.round(h * 0.007)), fill: ruleColor, opacity: 0.85 });
  if (hasSub) layers.push({ type: 'text', text: subtitle, x: padX, y: ruleY + Math.round(h * 0.03), w: innerW, h: Math.round(h * 0.16), fontSize: Math.round(min * 0.05), fontFamily: bodyFont, color: subColor, align, bold: false });
  if (logo) { const lw = Math.round(w * 0.26), lh = Math.round(h * 0.12); layers.push({ type: 'image', src: logo.url, x: Math.round((w - lw) / 2), y: Math.round(h * 0.86 - lh / 2), w: lw, h: lh, opacity: 0.95 }); }
  return layers;
}

// Build text layers positioned inside the clear band (text-aware placement).
// Dimension-responsive + memory-aware text layout. `opts.prefs` is the learned
// design taste (serif/sans, alignment, headline-size nudge) from socialDesign.js;
// `opts.headingSerif` is the brand's heading-font axis used when no preference
// has been learned yet. renderLayersToPng still auto-fits text to each box, so
// these set the *target* sizes — here we adapt them to the canvas aspect ratio
// and copy length so wide/portrait/square canvases stay balanced.
function buildLayersSmart(size, palette, headline, subtitle, band, opts = {}) {
  const [w, h] = SIZE_PRESETS[size] || SIZE_PRESETS['ig-post']; const min = Math.min(w, h);
  const prefs = opts.prefs || {};
  const aspect = w > h * 1.15 ? 'landscape' : h > w * 1.15 ? 'portrait' : 'square';
  const by0 = Math.round((band?.y0 ?? 0.18) * h);
  const by1 = Math.round((band?.y1 ?? 0.82) * h);
  const bh = Math.max(Math.round(h * 0.26), by1 - by0);

  const hlen = (headline || '').length;
  const lenAdj = hlen > 42 ? 0.80 : hlen > 26 ? 0.90 : 1;            // long copy → smaller
  const aspectAdj = aspect === 'landscape' ? 0.78 : aspect === 'portrait' ? 1.12 : 1;
  const scale = prefs.headlineScale || 1;                            // learned size nudge
  const headFs = Math.max(20, Math.round(min * 0.092 * lenAdj * aspectAdj * scale));
  const subFs = Math.max(13, Math.round(min * 0.042 * (aspect === 'landscape' ? 0.85 : 1)));

  // Typeface: learned preference wins, else the brand's heading/body fonts, else
  // a serif/sans keyword. Only registered brand families are used by name (the
  // compositor falls back to generic otherwise).
  const pick = (...cands) => cands.find(f => f && isRegisteredFont(f));
  const headFont = pick(prefs.fontFamily, opts.headingFont) || (opts.headingSerif ? 'serif' : 'sans-serif');
  const bodyFont = pick(opts.bodyFont, prefs.fontFamily, opts.headingFont) || 'sans-serif';
  const align = (prefs.align === 'left' || prefs.align === 'right' || prefs.align === 'center') ? prefs.align : 'center';
  const padX = Math.round(w * 0.08);

  // Text lands on the dark scrim, so pick the brand color that reads best there
  // (accent first, then text/white) — color theory, kept on-brand.
  const headColor = bestTextColor(true, palette, [palette.accent, palette.text, '#FFFFFF']);
  const subColor = bestTextColor(true, palette, [palette.text, '#FFFFFF', palette.accent]);
  const layers = [
    { type: 'rect', x: 0, y: by0, w, h: bh, fill: 'rgba(5,5,8,0.5)', opacity: 1 },
    { type: 'text', text: headline, x: padX, y: by0 + Math.round(bh * 0.14), w: Math.round(w * 0.84), h: Math.round(bh * 0.52), fontSize: headFs, fontFamily: headFont, color: headColor, align, bold: true, grow: true },
    { type: 'text', text: subtitle, x: Math.round(w * 0.10), y: by0 + Math.round(bh * 0.62), w: Math.round(w * 0.80), h: Math.round(bh * 0.30), fontSize: subFs, fontFamily: bodyFont, color: subColor, align, bold: false },
  ];
  // Small logo in the top-left safe corner (kept clear of the text band).
  if (opts.logo) { const lw = Math.round(w * 0.20), lh = Math.round(h * 0.09); layers.push({ type: 'image', src: opts.logo.url, x: Math.round(w * 0.06), y: Math.round(h * 0.05), w: lw, h: lh, opacity: 0.92 }); }
  return layers;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORY BUILDER — a vertical (1080×1920) multi-frame sequence.
//
// Instagram's story chrome (profile row up top, reply bar / actions at the
// bottom) eats roughly the top and bottom ~14% of the canvas, so ALL text and
// interactive-looking elements are kept inside the safe band. Each frame is a
// standard `design` object (renderLayersToPng needs no changes); a sequence is
// just an ordered array of them.
// ─────────────────────────────────────────────────────────────────────────────
const STORY_SAFE = { top: 0.14, bottom: 0.14 };   // fraction of height reserved for IG chrome

// Build ONE ig-story frame's design from a copy spec. `frame.kind` shapes the
// layout: 'hook' (big centered opener), 'body' (headline + supporting line),
// 'cta' (adds an accent pill near the bottom of the safe area).
export function buildStoryFrameDesign(frame, opts = {}) {
  const size = 'ig-story';
  const [w, h] = SIZE_PRESETS[size]; const min = Math.min(w, h);
  const palette = opts.palette || { bg: '#0D0D14', accent: '#C9A848', text: '#FFFFFF' };
  const bgColor = palette.bg || '#0D0D14';
  const safeTop = Math.round(h * STORY_SAFE.top);
  const safeBot = Math.round(h * (1 - STORY_SAFE.bottom));
  const safeH = safeBot - safeTop;
  const padX = Math.round(w * 0.10); const innerW = w - padX * 2;
  const pick = (...c) => c.find(f => f && isRegisteredFont(f));
  const headFont = pick(opts.headingFont) || (opts.headingSerif ? 'serif' : 'sans-serif');
  const bodyFont = pick(opts.bodyFont, opts.headingFont) || 'sans-serif';
  const kind = frame.kind || 'body';
  const headline = cleanCopy(frame.headline || '');
  const subtitle = cleanCopy(frame.subtitle || '');

  const layers = [];
  // Legibility scrim across the safe band (also visually anchors the frame when
  // there's an SD background behind it).
  layers.push({ type: 'rect', x: 0, y: safeTop, w, h: safeH, fill: 'rgba(5,5,8,0.45)', opacity: 1 });
  // Logo pinned inside the top of the safe area.
  if (opts.logo) { const lw = Math.round(w * 0.24), lh = Math.round(h * 0.06); layers.push({ type: 'image', src: opts.logo.url, x: Math.round((w - lw) / 2), y: safeTop + Math.round(h * 0.02), w: lw, h: lh, opacity: 0.95 }); }

  const headScale = kind === 'hook' ? 0.15 : 0.115;
  const headY = safeTop + Math.round(safeH * (kind === 'hook' ? 0.30 : 0.18));
  const headH = Math.round(safeH * (subtitle ? 0.32 : 0.42));
  layers.push({ type: 'text', text: headline, x: padX, y: headY, w: innerW, h: headH, fontSize: Math.round(min * headScale), fontFamily: headFont, color: palette.accent, align: 'center', bold: true });
  if (subtitle) layers.push({ type: 'text', text: subtitle, x: padX, y: headY + headH + Math.round(h * 0.015), w: innerW, h: Math.round(safeH * 0.22), fontSize: Math.round(min * 0.05), fontFamily: bodyFont, color: palette.text, align: 'center', bold: false });

  // CTA frames get an accent "pill" button sitting above the bottom safe margin.
  if (kind === 'cta') {
    const cta = cleanCopy(frame.cta || 'Link in bio');
    const pillH = Math.round(h * 0.06), pillW = Math.round(w * 0.68);
    const pillY = safeBot - Math.round(h * 0.06) - pillH;
    layers.push({ type: 'rect', x: Math.round((w - pillW) / 2), y: pillY, w: pillW, h: pillH, radius: Math.round(pillH / 2), fill: palette.accent, opacity: 0.96 });
    layers.push({ type: 'text', text: cta, x: Math.round((w - pillW) / 2), y: pillY, w: pillW, h: pillH, fontSize: Math.round(min * 0.045), fontFamily: bodyFont, color: bgColor, align: 'center', bold: true });
  }
  return { size, bgColor, sdBgUrl: opts.sdBgUrl || null, layers, kind };
}

// Render an ordered list of frame copy specs → uploaded ig-story PNGs.
// Returns [{ url, design, kind, headline, subtitle }] in sequence order.
export async function renderStoryFrames(frames, opts = {}) {
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const design = buildStoryFrameDesign(frames[i], opts);
    const buf = await renderLayersToPng(design);
    const up = await uploadPng(buf, opts.prefix, `story-${i + 1}`);
    out.push({ url: up.url, design, kind: design.kind, headline: cleanCopy(frames[i].headline || ''), subtitle: cleanCopy(frames[i].subtitle || '') });
  }
  return out;
}

// Reuse a previously generated abstract background whose metadata matches the
// idea's mood — so the agent draws on its own growing background pool instead of
// always paying for a fresh SD gen. Pool lives in the dedicated
// `social_backgrounds` collection (NOT the user's `assets` library), so batch
// output never pollutes Assets and nothing is marked `auto`.
// Persist a freshly generated abstract background into the agent's own reuse
// pool (`social_backgrounds`) — never the user's Assets library, never `auto`.
async function saveBackground(db, { url, key, size, seed, prompt, title }) {
  try {
    await db.collection('social_backgrounds').insertOne({
      publicUrl: url, bucketKey: key, size: size || 0,
      title: title || 'background', description: prompt || '',
      tags: ['abstract-v2', ...bgTagsFromSeed(seed)], seed: seed || '',
      createdAt: new Date(),
    });
  } catch { /* pool insert is best-effort */ }
}

async function pickPoolBackground(db, seed, opts = {}) {
  try {
    // safeOnly = only backgrounds the admin 👍'd (never the 👎'd / unproven ones).
    const filter = opts.safeOnly ? { safe: true } : { safe: { $ne: false } };
    const pool = await db.collection('social_backgrounds').find(filter)
      .sort({ createdAt: -1 }).limit(80).toArray();
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


// Holidays / marketing moments for a given year (fixed + computed floating
// dates). Exported so the platform calendar can lay them onto ANY range, not
// just the rolling window upcomingObservances() reports to the agent.
export function observancesForYear(y) {
  const nth = (yy, m, wd, n) => { const d = new Date(yy, m, 1); let c = 0; while (true) { if (d.getDay() === wd) { c++; if (c === n) return new Date(d); } d.setDate(d.getDate() + 1); } };
  const lastWd = (yy, m, wd) => { const d = new Date(yy, m + 1, 0); while (d.getDay() !== wd) d.setDate(d.getDate() - 1); return d; };
  const thx = (yy) => nth(yy, 10, 4, 4);
  return [
    ['New Year', new Date(y,0,1)], ["Valentine's Day", new Date(y,1,14)], ["St. Patrick's Day", new Date(y,2,17)],
    ['Earth Day', new Date(y,3,22)], ["Mother's Day", nth(y,4,0,2)], ['Memorial Day', lastWd(y,4,1)],
    ["Father's Day", nth(y,5,0,3)], ['Juneteenth', new Date(y,5,19)], ['Independence Day (July 4th)', new Date(y,6,4)],
    ['Labor Day', nth(y,8,1,1)], ['Halloween', new Date(y,9,31)], ['Veterans Day', new Date(y,10,11)],
    ['Thanksgiving', thx(y)],
    ['Black Friday', (()=>{const d=new Date(thx(y));d.setDate(d.getDate()+1);return d;})()],
    ['Small Business Saturday', (()=>{const d=new Date(thx(y));d.setDate(d.getDate()+2);return d;})()],
    ['Cyber Monday', (()=>{const d=new Date(thx(y));d.setDate(d.getDate()+4);return d;})()],
    ['Christmas', new Date(y,11,25)], ["New Year's Eve", new Date(y,11,31)],
  ].map(([name, date]) => ({ name, date }));
}

/** Observances falling inside [start, end) — the calendar's holiday layer. */
export function observancesBetween(start, end) {
  const out = [];
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    for (const o of observancesForYear(y)) if (o.date >= start && o.date < end) out.push(o);
  }
  return out.sort((a, b) => a.date - b.date);
}

// Upcoming holidays / marketing moments within a window of today — always fed
// to the suggestion agent so posts stay timely.
export function upcomingObservances(daysAhead = 30) {
  const now = new Date(); const Y = now.getFullYear();
  const soon = [];
  for (const { name, date } of [...observancesForYear(Y), ...observancesForYear(Y + 1)]) {
    const diff = (date - now) / 86400000;
    if (diff >= -1 && diff <= daysAhead) soon.push(`${name} (${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`);
  }
  return soon;
}

// Gather recent marketing-worthy content the suggestion agent can promote — blog
// posts, portfolio pieces, and OPEN careers — each with its own image + link back
// to the site. `sources` filters which kinds to include (null = all). `leadGen`
// appends a standing lead-capture prompt so posts drive newsletter/signups back to
// the site. This is how Autopilot "follows the rest of the platform".
export async function gatherMarketingContent(db, tenant, { days = 45, limit = 6, sources = null, leadGen = false } = {}) {
  const base = 'https://' + (tenant?.domain || tenant?.public?.customDomain || tenant?.meta?.customDomain || '');
  const want = (k) => !Array.isArray(sources) || sources.includes(k);
  const items = [];
  if (want('blog')) try {
    const blogs = await db.collection('blog').find({ status: 'published' }).sort({ publishedAt: -1, createdAt: -1 }).limit(limit).toArray();
    for (const b of blogs) items.push({ kind: 'blog', title: b.title, summary: (b.excerpt || '').slice(0, 160), url: b.slug ? `${base}/blog/${b.slug}` : base, image: b.featuredImageUrl || '', date: b.publishedAt || b.createdAt, tags: b.tags || [] });
  } catch { /* no blog */ }
  if (want('portfolio')) try {
    const port = await db.collection('portfolio').find({ status: 'published' }).sort({ createdAt: -1 }).limit(limit).toArray();
    for (const p of port) items.push({ kind: 'portfolio', title: p.title, summary: (p.description || '').slice(0, 160), url: (p.linkUrl && /^https?:/i.test(p.linkUrl)) ? p.linkUrl : `${base}/portfolio`, image: p.imageUrl || '', date: p.createdAt, tags: p.tags || [], client: p.clientName });
  } catch { /* no portfolio */ }
  if (want('careers')) try {
    const jobs = await db.collection('jobs').find({ status: 'open' }).sort({ publishedAt: -1, createdAt: -1 }).limit(limit).toArray();
    for (const j of jobs) items.push({ kind: 'careers', title: j.title || j.role || j.position || 'We’re hiring', summary: ('We’re hiring' + (j.location ? ' · ' + j.location : '') + (j.employmentType ? ' · ' + j.employmentType : '')).slice(0, 160), url: j.slug ? `${base}/careers/${j.slug}` : `${base}/careers`, image: j.imageUrl || j.featuredImageUrl || '', date: j.publishedAt || j.createdAt, tags: j.tags || [] });
  } catch { /* no careers */ }
  items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const now = Date.now();
  items.forEach(it => { it.isNew = it.date && (now - new Date(it.date).getTime()) / 86400000 <= days; });
  const top = items.slice(0, limit);
  let text = top.map(it => `- [${it.kind}${it.isNew ? ', NEW' : ''}] "${it.title}"${it.summary ? ` — ${it.summary}` : ''}${it.url ? ` (${it.url})` : ''}`).join('\n');
  // Lead capture: a standing instruction so some posts push newsletter signups.
  if (leadGen) text += (text ? '\n' : '') + `- [lead-gen] Where it fits, invite people to JOIN OUR NEWSLETTER / get updates with a clear CTA and a link to ${base} — this captures leads for the business.`;
  return { items: top, text, base, leadGen: !!leadGen };
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
  const grab = (b, key) => { const m = b.match(new RegExp('^\\s*' + key + '\\s*:[ \\t]*(.+)$', 'im')); return m ? m[1].trim().replace(/^["'`]|["'`]$/g, '').replace(/<\/?(POST|FRAME|SLIDE)>\s*$/i, '').trim() : ''; };
  let posts = blocks.map(b => { const lk = grab(b, 'LINK'); const tp = grab(b, 'TYPE').toLowerCase().replace(/[^a-z]/g, ''); return { type: tp || 'value', headline: grab(b, 'HEADLINE'), subtitle: grab(b, 'SUBTITLE'), caption: grab(b, 'CAPTION'), image_seed: grab(b, 'SEED'), link: /^https?:\/\//i.test(lk) ? lk : '' }; }).filter(p => p.caption || p.headline);
  if (!posts.length) throw new Error('LLM returned unparseable posts: ' + raw.slice(0, 200));
  return posts.slice(0, count);
}

// Critic self-audit pass: score each draft against the brand voice and rewrite
// the weak ones. Returns posts with caption/headline possibly improved. Never
// throws — on any failure the original posts pass through unchanged.
export async function applyCritic(brandContext, voiceBlock, posts) {
  if (!posts?.length) return posts;
  try {
    const sys = `You are a ruthless brand-voice editor. Below is the brand context${voiceBlock ? ' and its VOICE PROFILE' : ''}. For EACH draft, judge whether the caption truly sounds on-brand and earns engagement. If it's already great, return it unchanged. If it's generic, off-voice, or limp, rewrite it.
${brandContext}${voiceBlock ? '\n\n' + voiceBlock : ''}

Return ONLY a raw JSON array (no prose, no fences), one object per draft IN THE SAME ORDER:
[{ "caption": "final caption, on-voice, under 240 chars, 2-4 hashtags", "headline": "<=6 word on-image headline" }]
Rules: keep any URL already present in the caption. Never invent facts. Escape double quotes as \\".`;
    const list = posts.map((p, i) => `#${i + 1} HEADLINE: ${p.headline || ''}\nCAPTION: ${p.caption || ''}`).join('\n---\n');
    const raw = await callLLM([{ role: 'user', content: `Audit and fix these ${posts.length} drafts:\n\n${list}` }], sys, 90000);
    const m = String(raw).replace(/```(?:json)?/gi, '').match(/\[[\s\S]*\]/);
    if (!m) return posts;
    const fixed = JSON.parse(m[0]);
    return posts.map((p, i) => {
      const f = fixed[i];
      if (f && typeof f === 'object') {
        if (f.caption && String(f.caption).trim()) p.caption = String(f.caption).trim().slice(0, 2000);
        if (f.headline && String(f.headline).trim()) p.headline = String(f.headline).trim().slice(0, 80);
      }
      return p;
    });
  } catch { return posts; }
}

// Draft DISTINCT, platform-native posts — one set per platform, never the same
// copy twice. Each post carries its own hook, caption (with native hashtags +
// optional cross-mention of the brand's other channels), and its own background
// SEED. Returns a flat array of { platform, type, headline, subtitle, caption,
// image_seed, link }.
export async function draftPlatformPosts(brandContext, platforms, opts = {}) {
  const perPlatform = Math.max(1, Math.min(5, opts.perPlatform || 1));
  const direction = (opts.direction || '').trim();
  const research = (opts.research || '').trim();
  const handleMap = opts.handleMap || {};
  const obs = upcomingObservances(30);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const holidayLine = obs.length ? `Upcoming dates to weave in where it fits: ${obs.join(', ')}.` : 'No major holidays in the next few weeks.';
  const dirLine = direction ? `\nSTEER THIS BATCH toward: "${direction}". Keep variety across posts.` : '';
  const researchBlock = research ? `\n\n--- FRESH RESEARCH (ground angles in this; never fabricate) ---\n${research}\n--- END RESEARCH ---` : '';
  const contentBlock = (opts.content || '').trim() ? `\n\n--- YOUR RECENT CONTENT WORTH PROMOTING (copy the exact URL into LINK) ---\n${opts.content.trim()}\n--- END CONTENT ---` : '';

  const ownChannels = Object.entries(handleMap).map(([p, h]) => `- ${PLATFORMS[p]?.name || p}: ${h.handle}${h.url ? ` (${h.url})` : ''}`).join('\n');
  const channelBlock = ownChannels ? `\n\nThe brand's OWN channels — cross-promote BETWEEN them where it feels natural (never in every post, at most one per post, and never plug a platform on itself):\n${ownChannels}` : '';

  const platformSpec = platforms.map(p => {
    const s = platformStyle(p);
    return `  • ${PLATFORMS[p]?.name || p} [key: ${p}] — ~${s.max} chars; ${s.vibe}; ${s.tags}; ${s.links}; ${s.mentions}.`;
  }).join('\n');

  const sys = `You are a senior social strategist who writes NATIVELY for each platform. Every post must be DISTINCT — never reuse a caption, hook, or background idea across platforms. Lean playful and human.
${brandContext}

Today is ${today}. ${holidayLine}${dirLine}${channelBlock}

Write ${perPlatform} DISTINCT post(s) for EACH of these platforms, honoring each one's native style:
${platformSpec}

Output EXACTLY one <POST> block per post and NOTHING else (no prose, no JSON, no fences):
<POST>
PLATFORM: the exact [key] from the list above
TYPE: one of value|service|proof|local|holiday|question|poll|wacky|cta
HEADLINE: 3-6 word punchy on-image headline
SUBTITLE: 5-9 word supporting line for the image
CAPTION: the finished caption written NATIVELY for THIS platform — brand voice, platform-appropriate hashtags, and (only where natural) one cross-mention of another channel
LINK: if promoting a listed item copy its exact URL VERBATIM; else leave blank
SEED: ABSTRACT texture/mood/palette words for the background — NO objects, furniture, rooms, people, products, or text
</POST>

Guidance:
- Vary the hook, angle, AND background SEED across every post — make them feel hand-written per network.
- Respect each platform's hashtag + link rules above (e.g. no bare links on Bluesky/Instagram, no hashtags on Reddit).
- Make at least one engagement post (a real question, or a "A or B? tell us below" prompt) per platform set.
- About one post in five can be playfully WACKY while staying on-brand.
- Write FINISHED copy only — use the brand's real details (location, services, name). NEVER leave fill-in-the-blank placeholders like [City], [your business], (insert offer), or bracketed/parenthetical stubs.${researchBlock}${contentBlock}`;

  const raw = await callLLM([{ role: 'user', content: `Write ${perPlatform} distinct post(s) per platform now.${direction ? ' Focus: ' + direction : ''}` }], sys, 120000);
  const blocks = raw.match(/<POST>([\s\S]*?)<\/POST>/gi) || [];
  const grab = (b, key) => { const m = b.match(new RegExp('^\\s*' + key + '\\s*:[ \\t]*(.+)$', 'im')); return m ? m[1].trim().replace(/^["'`]|["'`]$/g, '').replace(/<\/?(POST|FRAME|SLIDE)>\s*$/i, '').trim() : ''; };
  const valid = new Set(platforms);
  let posts = blocks.map(b => {
    const lk = grab(b, 'LINK');
    const pf = grab(b, 'PLATFORM').toLowerCase().replace(/[^a-z]/g, '');
    const tp = grab(b, 'TYPE').toLowerCase().replace(/[^a-z]/g, '');
    return { platform: pf, type: tp || 'value', headline: cleanCopy(grab(b, 'HEADLINE')), subtitle: cleanCopy(grab(b, 'SUBTITLE')), caption: cleanCopy(grab(b, 'CAPTION')), image_seed: grab(b, 'SEED'), link: /^https?:\/\//i.test(lk) ? lk : '' };
  }).filter(p => valid.has(p.platform) && (p.caption || p.headline));

  // Safety net: if the model skipped a platform entirely, fall back to a generic
  // draft for it so every selected platform still gets at least one post.
  for (const p of platforms) {
    if (!posts.some(x => x.platform === p)) {
      try {
        const [one] = await draftPosts(brandContext, 1, { direction, research, content: opts.content });
        if (one) posts.push({ ...one, platform: p });
      } catch { /* skip */ }
    }
  }
  if (!posts.length) throw new Error('LLM returned no usable platform posts: ' + raw.slice(0, 200));
  return posts;
}

// Script an Instagram STORY sequence — N vertical frames (hook → body… → cta)
// with short, on-screen copy. Returns [{ kind, headline, subtitle, cta }] which
// renderStoryFrames turns into images. Mirrors the <POST>-block parsing above.
export async function draftStoryFrames(brandContext, opts = {}) {
  const count = Math.max(2, Math.min(8, opts.count || 4));
  const direction = (opts.direction || '').trim();
  const obs = (Array.isArray(opts.observances) && opts.observances.length) ? opts.observances : [];
  const holidayLine = obs.length ? `\nTimely moments to lean into where it fits: ${obs.slice(0, 6).join(', ')}.` : '';
  const contentBlock = (opts.content || '').trim()
    ? `\n\n--- YOUR SITE CONTENT WORTH PROMOTING (a story can tease one — put its exact URL in the CTA) ---\n${opts.content.trim()}\n--- END CONTENT ---`
    : '';
  const sys = `You script an Instagram STORY sequence — ${count} vertical full-screen frames that tell a quick, snackable story. Frame 1 is the HOOK, the last is a CTA, everything between is BODY.
${brandContext}
${direction ? `Steer the story toward: "${direction}".` : ''}${holidayLine}

On-screen story copy is SHORT and punchy — a few words per line, not paragraphs.${contentBlock}

Output EXACTLY one <FRAME> block per frame and NOTHING else (no prose, no JSON, no fences):
<FRAME>
KIND: hook|body|cta
HEADLINE: 2-6 word big on-screen line
SUBTITLE: 4-9 word supporting line (may be blank)
CTA: only on the cta frame — a short call to action (e.g. "Link in bio", "DM us")
</FRAME>

Rules: EXACTLY ${count} frames; the first is KIND=hook, the last is KIND=cta, the rest KIND=body. Finished copy only — never leave bracketed/parenthetical placeholders.`;

  const raw = await callLLM([{ role: 'user', content: `Script the ${count}-frame story now.${direction ? ' Focus: ' + direction : ''}` }], sys, 90000);
  const blocks = raw.match(/<FRAME>([\s\S]*?)<\/FRAME>/gi) || [];
  const grab = (b, key) => { const m = b.match(new RegExp('^\\s*' + key + '\\s*:[ \\t]*(.+)$', 'im')); return m ? m[1].trim().replace(/^["'`]|["'`]$/g, '').replace(/<\/?(POST|FRAME|SLIDE)>\s*$/i, '').trim() : ''; };
  let frames = blocks.map(b => ({
    kind: grab(b, 'KIND').toLowerCase().replace(/[^a-z]/g, '') || 'body',
    headline: cleanCopy(grab(b, 'HEADLINE')),
    subtitle: cleanCopy(grab(b, 'SUBTITLE')),
    cta: cleanCopy(grab(b, 'CTA')),
  })).filter(f => f.headline || f.subtitle || f.cta);
  if (!frames.length) throw new Error('LLM returned no usable story frames: ' + raw.slice(0, 200));
  // Normalize the arc: first frame hooks, last frame is the CTA.
  frames[0].kind = 'hook';
  frames[frames.length - 1].kind = 'cta';
  return frames;
}

// End-to-end story builder: load brand palette/logo/voice, draft the frames,
// render them to ig-story PNGs, and return the frame list (URLs + copy). Does
// NOT create a post — the caller decides what to do with the frames.
export async function generateStoryFrames(tenant, db, opts = {}) {
  const designRaw = await db.collection('design').find({}).toArray();
  const D = {}; for (const d of designRaw) D[d.key] = d.value;
  const palette = { bg: D.color_primary || '#0D0D14', accent: D.color_accent || '#C9A848', text: D.color_text || '#E8E8F0' };
  const headingFont = D.font_heading || '';
  const bodyFont = D.font_body || '';
  const logo = await findBrandLogo(db, 'dark').catch(() => null);
  const baseBrandContext = await loadBrandContext(tenant, db);
  const voiceBlock = await loadVoiceBlock(db).catch(() => '');
  const brandContext = voiceBlock ? baseBrandContext + '\n\n' + voiceBlock : baseBrandContext;

  // Content + calendar awareness — a story can promote real site content and lean
  // into timely moments, same as Autopilot/Batch.
  let content = '';
  if (Array.isArray(opts.sources) ? opts.sources.length : opts.sources !== false) {
    const mk = await gatherMarketingContent(db, tenant, { sources: Array.isArray(opts.sources) && opts.sources.length ? opts.sources : null, leadGen: !!opts.leadGen }).catch(() => ({ text: '' }));
    content = mk.text || '';
  }
  const observances = (() => { try { return upcomingObservances(30); } catch { return []; } })();

  const frames = await draftStoryFrames(brandContext, { count: opts.count, direction: opts.direction, content, observances });
  const rendered = await renderStoryFrames(frames, {
    palette, headingFont, bodyFont, headingSerif: isSerifFont(headingFont), logo, prefix: tenant.s3Prefix,
  });
  return { frames: rendered, count: rendered.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEAMLESS ("panorama") CAROUSEL — one wide canvas sliced into N portrait tiles.
//
// The background is drawn ONCE across a canvas (tileW × N) wide, then sliced into
// N equal 1080×1350 tiles. Posted as an IG/Threads carousel, swiping stitches the
// tiles back into a continuous panorama, while each tile carries its own header.
// Headers are kept inside each tile's inner box so text never lands on a swipe
// seam. Background source is a caller-supplied buffer (an uploaded wide image
// today; an SD-generated one with a width dimension can plug in later).
// ─────────────────────────────────────────────────────────────────────────────

// Darken (amt<0) or lighten (amt>0) a #rrggbb color. Used for the gradient fallback.
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex || '#0D0D14';
  let [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  const f = amt < 0 ? (1 + amt) : 1; const add = amt > 0 ? amt * 255 : 0;
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x * f + add)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Draw auto-fitting, word-wrapped, vertically-centered text inside a box —
// mirrors renderLayersToPng's text logic (emoji stripped; shrink-to-fit).
function drawBoxedText(ctx, text, box) {
  const clean = stripCanvasEmoji(String(text || '').trim());
  if (!clean) return;
  const { x, y, w, h, color = '#fff', align = 'center', bold = false } = box;
  const fam = fontToken(box.fontFamily);
  const weight = bold ? 'bold ' : '';
  ctx.save();
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top';
  const wrap = (fs) => {
    ctx.font = `${weight}${fs}px ${fam}`;
    const lines = []; let line = '';
    for (const word of clean.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > w && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  let fs = box.fontSize || 64, lines = wrap(fs);
  for (; fs >= 16; fs -= 2) {
    lines = wrap(fs);
    const widest = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
    if (lines.length * fs * 1.25 <= h && widest <= w) break;
  }
  ctx.font = `${weight}${fs}px ${fam}`;
  const lh = fs * 1.25; const blockH = lines.length * lh;
  const dy = y + Math.max(0, (h - blockH) / 2);
  let dx = x; if (align === 'center') dx += w / 2; else if (align === 'right') dx += w;
  lines.forEach((ln, i) => ctx.fillText(ln, dx, dy + i * lh));
  ctx.restore();
}

const PANO_TILE = { w: 1080, h: 1350 };

// Compose the FULL wide panorama canvas (background + per-slide headers). This is
// the single source of truth — NOT sliced. `slides` = [{ headline, subtitle }].
// Blank fields render greyed placeholder text in the tile's text zone so the
// admin can see where copy lands. opts.showSeams draws dashed tile boundaries
// (preview only, never on the published slices).
async function composeSeamlessWide(slides, opts = {}) {
  const { w: tileW, h: tileH } = PANO_TILE;
  const N = Math.max(2, Math.min(10, slides.length));
  const W = tileW * N;
  const palette = opts.palette || { bg: '#0D0D14', accent: '#C9A848', text: '#FFFFFF' };
  const padX = Math.round(tileW * 0.10);
  const canvas = createCanvas(W, tileH);
  const ctx = canvas.getContext('2d');

  // Background: cover-fit the wide image across the FULL canvas so the panorama is
  // continuous end-to-end; otherwise a brand gradient wash (crisp at any width).
  ctx.fillStyle = palette.bg || '#0D0D14';
  ctx.fillRect(0, 0, W, tileH);
  let drewImage = false;
  // Prefer the pre-fetched buffer, but fall back to loading the URL directly —
  // node-canvas fetches it itself, which sidesteps a failed server-side fetch
  // (e.g. undici Host quirks) that would otherwise drop us to the gradient.
  const bgSrc = opts.bgBuffer || opts.bgUrl || null;
  if (bgSrc) {
    try {
      const img = await loadImage(bgSrc);
      const s = Math.max(W / img.width, tileH / img.height);
      ctx.drawImage(img, (W - img.width * s) / 2, (tileH - img.height * s) / 2, img.width * s, img.height * s);
      drewImage = true;
    } catch (e) { console.warn('[seamless] background load failed:', e.message); }
  }
  if (!drewImage) {
    const g = ctx.createLinearGradient(0, 0, W, tileH);
    g.addColorStop(0, palette.bg || '#0D0D14');
    g.addColorStop(1, shade(palette.accent || '#C9A848', -0.45));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, tileH);
  }

  // Per-tile overlays. A tile ONLY gets the legibility scrim + text when it
  // actually HAS copy — a blank tile keeps the background untouched (in the preview
  // AND the final slices), so an image with no text never gets a dark gradient or a
  // baked "placeholder" over it. `noText` skips overlays wholesale. In the preview,
  // empty tiles get a faint, scrim-free hint only.
  if (!opts.noText) {
    for (let i = 0; i < N; i++) {
      const ox = i * tileW;
      const f = slides[i] || {};
      const hl = (f.headline || '').trim();
      const st = (f.subtitle || '').trim();
      if (hl || st) {
        const scrimY = Math.round(tileH * 0.50);
        const grad = ctx.createLinearGradient(0, scrimY, 0, tileH);
        grad.addColorStop(0, 'rgba(5,5,8,0)');
        grad.addColorStop(1, 'rgba(5,5,8,0.74)');
        ctx.fillStyle = grad; ctx.fillRect(ox, scrimY, tileW, tileH - scrimY);
        if (hl) drawBoxedText(ctx, hl, { x: ox + padX, y: Math.round(tileH * 0.60), w: tileW - padX * 2, h: Math.round(tileH * 0.20), fontSize: Math.round(tileW * 0.11), fontFamily: opts.headingFont, color: palette.accent, align: 'center', bold: true });
        if (st) drawBoxedText(ctx, st, { x: ox + padX, y: Math.round(tileH * 0.815), w: tileW - padX * 2, h: Math.round(tileH * 0.10), fontSize: Math.round(tileW * 0.045), fontFamily: opts.bodyFont, color: palette.text, align: 'center', bold: false });
      } else if (opts.showSeams) {
        // Preview-only hint (no scrim so the background shows through cleanly).
        drawBoxedText(ctx, 'add copy in editor', { x: ox + padX, y: Math.round(tileH * 0.62), w: tileW - padX * 2, h: Math.round(tileH * 0.08), fontSize: Math.round(tileW * 0.038), fontFamily: opts.bodyFont, color: 'rgba(255,255,255,0.34)', align: 'center', bold: false });
      }
    }
  }

  // Brand logo on the first tile (top-center), kept in the safe area.
  if (opts.logoBuffer && !opts.noText) {
    try {
      const lg = await loadImage(opts.logoBuffer);
      const lw = Math.round(tileW * 0.24), lh = Math.round(tileH * 0.06);
      const s = Math.min(lw / lg.width, lh / lg.height);
      ctx.drawImage(lg, Math.round((tileW - lg.width * s) / 2), Math.round(tileH * 0.06), lg.width * s, lg.height * s);
    } catch { /* skip logo */ }
  }

  // Preview-only dashed seam guides so the admin sees the tile boundaries.
  if (opts.showSeams) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.setLineDash([14, 12]); ctx.lineWidth = 2;
    for (let i = 1; i < N; i++) { ctx.beginPath(); ctx.moveTo(i * tileW, 0); ctx.lineTo(i * tileW, tileH); ctx.stroke(); }
    ctx.restore();
  }

  return { canvas, tileW, tileH, N };
}

// Render + upload the wide panorama as ONE preview image (with seam guides). This
// is what the review card shows; slicing is deferred to publish time.
export async function renderSeamlessPreview(slides, opts = {}) {
  const { canvas } = await composeSeamlessWide(slides, { ...opts, showSeams: true });
  const up = await uploadPng(canvas.toBuffer('image/png'), opts.prefix, 'pano-preview');
  return { url: up.url, width: canvas.width, height: canvas.height };
}

// Slice the wide panorama into N uploaded 1080×1350 tiles (no seam guides). Called
// ONLY when the carousel is sent to Instagram. Returns tile URLs in order.
export async function sliceSeamless(slides, opts = {}) {
  const { canvas, tileW, tileH, N } = await composeSeamlessWide(slides, { ...opts, showSeams: false });
  const urls = [];
  for (let i = 0; i < N; i++) {
    const tile = createCanvas(tileW, tileH);
    tile.getContext('2d').drawImage(canvas, i * tileW, 0, tileW, tileH, 0, 0, tileW, tileH);
    const up = await uploadPng(tile.toBuffer('image/png'), opts.prefix, `pano-${i + 1}`);
    urls.push(up.url);
  }
  return urls;
}

// Script N carousel slides where EACH slide is a distinct on-topic point (not a
// story arc): slide 1 titles the topic, the middle slides each make one concrete
// point, the last is a CTA. Returns [{ headline, subtitle }] per slide.
export async function draftCarouselSlides(brandContext, opts = {}) {
  const count = Math.max(2, Math.min(10, opts.count || 4));
  const direction = (opts.direction || '').trim();
  const sys = `You script a ${count}-slide Instagram CAROUSEL about ONE topic. Every slide must make a DIFFERENT, concrete point on that topic — no repetition, no filler. Slide 1 is the title/hook, slides 2–${count - 1} each deliver one distinct point, slide ${count} is a clear call to action.
${brandContext}
${direction ? `The topic / angle: "${direction}".` : 'Pick a genuinely useful topic for this brand.'}

On-slide copy is SHORT — a punchy headline plus one supporting line, not paragraphs.

Output EXACTLY one <SLIDE> block per slide and NOTHING else (no prose, no JSON, no fences):
<SLIDE>
HEADLINE: 2-6 word on-slide headline (the point of THIS slide)
SUBTITLE: 4-12 word supporting line (may be blank)
</SLIDE>

Rules: EXACTLY ${count} slides, each covering a DIFFERENT aspect of the topic, in a logical order. Finished copy only — never bracketed/parenthetical placeholders.`;

  const raw = await callLLM([{ role: 'user', content: `Write the ${count}-slide carousel now.${direction ? ' Topic: ' + direction : ''}` }], sys, 90000);
  const blocks = raw.match(/<SLIDE>([\s\S]*?)<\/SLIDE>/gi) || [];
  const grab = (b, key) => { const m = b.match(new RegExp('^\\s*' + key + '\\s*:[ \\t]*(.+)$', 'im')); return m ? m[1].trim().replace(/^["'`]|["'`]$/g, '').replace(/<\/?(POST|FRAME|SLIDE)>\s*$/i, '').trim() : ''; };
  let slides = blocks.map(b => ({ headline: cleanCopy(grab(b, 'HEADLINE')), subtitle: cleanCopy(grab(b, 'SUBTITLE')) })).filter(s => s.headline || s.subtitle);
  if (!slides.length) throw new Error('LLM returned no usable carousel slides: ' + raw.slice(0, 200));
  return slides.slice(0, count);
}

// Load the brand render context (palette/fonts/logo) shared by every seamless
// render path, plus a small buffer fetcher.
async function seamlessRenderCtx(tenant, db) {
  const designRaw = await db.collection('design').find({}).toArray();
  const D = {}; for (const d of designRaw) D[d.key] = d.value;
  const palette = { bg: D.color_primary || '#0D0D14', accent: D.color_accent || '#C9A848', text: D.color_text || '#E8E8F0' };
  const brandLogo = await findBrandLogo(db, 'light').catch(() => null);
  const logoBuffer = await fetchImgBuf(brandLogo?.url || '').catch(() => null);
  return { palette, headingFont: D.font_heading || '', bodyFont: D.font_body || '', logoBuffer, prefix: tenant.s3Prefix };
}

const fetchBufUrl = async (url, ms = 20000) => {
  if (!url) return null;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch { /* null */ }
  return null;
};

// Resolve the wide background to a buffer + a persisted URL. Priority: an uploaded
// URL → an AI-generated SD texture (uploaded so edits reuse it) → null (gradient).
async function resolveSeamlessBg(tenant, db, opts, count) {
  let bgUrl = opts.bgUrl || null;
  let bgBuffer = await fetchBufUrl(bgUrl);
  if (!bgBuffer && opts.useSd) {
    try {
      const baseBrandContext = await loadBrandContext(tenant, db);
      const aspect = (1080 * count) / 1350;                       // panorama aspect
      const H2 = 384;
      const W2 = Math.max(512, Math.min(768, Math.round((H2 * aspect) / 64) * 64));  // GPU-safe (TDR-prone box)
      const seed = (opts.direction || `${tenant.brand?.businessType || 'brand'} abstract texture`).slice(0, 120);
      const branded = await buildBrandedSdPrompt(seed, baseBrandContext, {}).catch(() => null);
      if (branded) bgBuffer = await generateSdImage(branded.prompt, branded.negative, `${W2}x${H2}`).catch(() => null);
      if (bgBuffer) { try { const up = await uploadPng(bgBuffer, tenant.s3Prefix, 'pano-bg'); bgUrl = up.url; } catch { /* keep buffer only */ } }
    } catch { /* gradient fallback */ }
  }
  return { bgBuffer, bgUrl };
}

function sanitizeSlides(arr, count) {
  return (arr || []).slice(0, count).map(s => ({
    headline: String(s?.headline || '').slice(0, 120),
    subtitle: String(s?.subtitle || '').slice(0, 160),
  }));
}

// Build a seamless carousel DRAFT: resolve background, get on-topic per-slide copy
// (or caller edits), render the wide PREVIEW (unsliced). Slicing is deferred until
// publish. Returns { previewUrl, slides, bgUrl, count }. No post created.
export async function generateSeamlessCarousel(tenant, db, opts = {}) {
  const count = Math.max(2, Math.min(10, opts.count || 4));
  const noText = !!opts.noText;
  const rc = await seamlessRenderCtx(tenant, db);
  const { bgBuffer, bgUrl } = await resolveSeamlessBg(tenant, db, opts, count);

  let slides;
  if (noText) {
    // Background-only carousel — the admin's own design carries any text. Skip the
    // AI copy pass; keep N blank slides just to carry the tile count.
    slides = Array.from({ length: count }, () => ({ headline: '', subtitle: '' }));
  } else if (Array.isArray(opts.slides) && opts.slides.length) {
    slides = sanitizeSlides(opts.slides, count);
  } else {
    const baseBrandContext = await loadBrandContext(tenant, db);
    const voiceBlock = await loadVoiceBlock(db).catch(() => '');
    const brandContext = voiceBlock ? baseBrandContext + '\n\n' + voiceBlock : baseBrandContext;
    slides = await draftCarouselSlides(brandContext, { count, direction: opts.direction });
  }

  const preview = await renderSeamlessPreview(slides, { ...rc, bgBuffer, bgUrl, noText });
  return { previewUrl: preview.url, slides, bgUrl, count: slides.length, noText };
}

// Re-render only the wide PREVIEW (copy and/or background edits) — used by the
// review-card editor. Returns { previewUrl, slides, bgUrl }.
export async function rerenderSeamlessPreview(tenant, db, opts = {}) {
  const noText = !!opts.noText;
  const slides = sanitizeSlides(opts.slides, opts.slides?.length || 0);
  const count = Math.max(2, Math.min(10, slides.length));
  const rc = await seamlessRenderCtx(tenant, db);
  const { bgBuffer, bgUrl } = await resolveSeamlessBg(tenant, db, opts, count);
  const preview = await renderSeamlessPreview(slides, { ...rc, bgBuffer, bgUrl, noText });
  return { previewUrl: preview.url, slides, bgUrl };
}

// Slice a pre-rendered wide image (baked in the canvas editor) into N tiles as-is,
// no scrim/text overlay. Used when the admin designed the whole canvas by hand.
async function sliceBakedImage(bgUrl, N, prefix) {
  const buf = await fetchBufUrl(bgUrl);
  if (!buf) return [];
  const tileW = 1080, tileH = 1350;
  const img = await loadImage(buf);
  // Cover-fit the image across the full N-tile width, then cut.
  const W = tileW * N;
  const canvas = createCanvas(W, tileH);
  const ctx = canvas.getContext('2d');
  const s = Math.max(W / img.width, tileH / img.height);
  ctx.drawImage(img, (W - img.width * s) / 2, (tileH - img.height * s) / 2, img.width * s, img.height * s);
  const urls = [];
  for (let i = 0; i < N; i++) {
    const tile = createCanvas(tileW, tileH);
    tile.getContext('2d').drawImage(canvas, i * tileW, 0, tileW, tileH, 0, 0, tileW, tileH);
    const up = await uploadPng(tile.toBuffer('image/png'), prefix, `pano-${i + 1}`);
    urls.push(up.url);
  }
  return urls;
}

// Materialize the panorama into published tiles — called at send-to-Instagram.
// A baked background (designed in the canvas editor) is sliced as-is; otherwise we
// re-compose from the draft's bgUrl + slides. Returns tile URLs.
export async function sliceSeamlessForPublish(tenant, db, post) {
  const N = Math.max(2, Math.min(10, (post.slides || []).length || 2));
  if (post.bakedBg && post.bgUrl) return sliceBakedImage(post.bgUrl, N, tenant.s3Prefix);
  const slides = sanitizeSlides(post.slides, (post.slides || []).length);
  if (slides.length < 2) return [];
  const rc = await seamlessRenderCtx(tenant, db);
  const bgBuffer = await fetchBufUrl(post.bgUrl);
  return sliceSeamless(slides, { ...rc, bgBuffer, bgUrl: post.bgUrl, noText: !!post.noText });
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
  const baseBrandContext = await loadBrandContext(tenant, db);
  const voiceBlock = await loadVoiceBlock(db).catch(() => '');
  const brandContext = voiceBlock ? baseBrandContext + '\n\n' + voiceBlock : baseBrandContext;

  const label = kind === 'owner' ? 'Owner Spotlight' : kind === 'mission' ? 'Our Mission' : 'Client Love';
  const attribution = subject ? `\u2014 ${subject}${role ? `, ${role}` : ''}` : '';

  const sys = `You are a social media strategist for the brand below.\n${brandContext}\n\nWrite ONE on-brand caption for a "${label}" post built around this EXACT quote (never alter or invent a quote): "${quote}"${subject ? ` by ${subject}${role ? `, ${role}` : ''}` : ''}.\nReturn ONLY the caption text — no surrounding quotes, no preamble — under 240 characters, with 2-4 relevant hashtags.`;
  let caption = '';
  try { caption = (await callLLM([{ role: 'user', content: 'Write the caption.' }], sys, 60000)).trim().replace(/^["'`]|["'`]$/g, ''); } catch { /* fallback below */ }
  if (!caption) caption = `${quote} ${attribution}`.trim();
  caption = cleanCopy(caption).slice(0, 2000);
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
      await saveBackground(db, { url: up.url, key: up.key, size: sdBuf.length, seed, prompt: branded.prompt, title: `${label} background` });
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
    // Composite lives in S3 + the post only \u2014 it does NOT enter the Assets library.
    const post = {
      body: caption, link: '', mediaUrls: [up.url], platforms: [platform], status: 'draft',
      suggestion: true, source: 'spotlight', kind: `spotlight-${kind}`,
      headline: label, subtitle: attribution, seed, design, dims: `${pw}x${ph}`,
      assetIds: [], scheduledAt: null, publishedAt: null, results: [],
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
  // Learned layout taste (👍/👎 memory) + the brand's heading-font axis, both fed
  // into the responsive text layout for consistency with what the admin liked.
  const designPrefs = await getDesignPrefs(db).catch(() => ({}));
  const headingFont = D.font_heading || '';
  const bodyFont = D.font_body || '';
  const layoutOpts = { prefs: designPrefs, headingFont, bodyFont, headingSerif: isSerifFont(headingFont) };
  // Background style: 'solid' (clean brand-color typographic poster — default),
  // 'photo' (SD/photo bg), or 'auto' (alternate for variety). Logo loaded once.
  const style = opts.style === 'photo' ? 'photo' : opts.style === 'auto' ? 'auto' : 'solid';
  const brandLogo = await findBrandLogo(db, 'light').catch(() => null);
  layoutOpts.logo = brandLogo;

  const baseBrandContext = await loadBrandContext(tenant, db);
  const voiceBlock = await loadVoiceBlock(db).catch(() => '');
  const brandContext = voiceBlock ? baseBrandContext + '\n\n' + voiceBlock : baseBrandContext;
  const progress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  progress(0, count, 'researching');
  let research = '';
  try {
    const q = [tenant.brand?.name, tenant.brand?.businessType, opts.direction, 'social media content ideas'].filter(Boolean).join(' ').slice(0, 180);
    const r = await webSearch(q);
    if (r && !/^(Search|No results|Fetch)/.test(r)) research = r.slice(0, 1500);
  } catch { /* research optional */ }
  if (opts.trends && opts.trends.trim()) research = (research ? research + '\n\n' : '') + 'CURRENT TRENDS / LISTENER FINDINGS (work in timely angles where they fit):\n' + opts.trends.trim();
  const marketing = await gatherMarketingContent(db, tenant, {
    sources: Array.isArray(opts.sources) && opts.sources.length ? opts.sources : null,
    leadGen: !!opts.leadGen,
  }).catch(() => ({ items: [], text: '' }));
  // Distinct, platform-native posts (one set per platform) — no carbon copies.
  const platformKeys = eligible.map(a => a.platform);
  const handleMap = buildHandleMap(eligible);
  const perPlatform = Math.max(1, Math.round(count / platformKeys.length));
  progress(0, count, 'drafting platform-native copy');
  let posts = await draftPlatformPosts(brandContext, platformKeys, { perPlatform, direction: opts.direction, research, content: marketing.text, handleMap });
  if (opts.critic) { progress(0, posts.length, `critic review — polishing all ${posts.length} drafts (~1 min)`); posts = await applyCritic(brandContext, voiceBlock, posts); }

  // ONE cohesive background look for the whole batch: a single brand-abstract SD
  // prompt, rendered once per unique platform size and cached — so every post in
  // the batch shares the same visual style and only the copy differs.
  const batchSeed = [opts.direction, tenant.brand?.businessType, 'brand mood texture'].filter(Boolean).join(' ').slice(0, 120);
  let batchBranded = null;
  try { batchBranded = await buildBrandedSdPrompt(batchSeed, brandContext, { sizePreset: 'fb-post' }); } catch { /* flat fallback */ }
  const bgCache = {};
  async function getBatchBg(size) {
    if (bgCache[size]) return bgCache[size];
    let entry = { buf: null, url: null };
    // Reuse a known-good (👍'd) background before rolling the SD dice again.
    const safe = await pickPoolBackground(db, batchSeed, { safeOnly: true });
    if (safe) { bgCache[size] = { buf: safe.buffer, url: safe.url }; return bgCache[size]; }
    if (batchBranded) {
      try {
        const buf = await generateSdImage(batchBranded.prompt, batchBranded.negative, size);
        const up = await uploadPng(buf, tenant.s3Prefix, `sdbg-batch-${size}`);
        entry = { buf, url: up.url };
        await saveBackground(db, { url: up.url, key: up.key, size: buf.length, seed: batchSeed, prompt: batchBranded.prompt, title: `batch background ${size}` });
        recordTrainingCandidate({ prompt: batchBranded.prompt, negativePrompt: batchBranded.negative, sizePreset: size, bucketKey: up.key, publicUrl: up.url, byteSize: buf.length, source: 'auto-social', tenant: { db: tenant.db, name: tenant.brand?.name, prefix: tenant.s3Prefix } });
      } catch { /* flat bg */ }
    }
    bgCache[size] = entry;
    return entry;
  }

  // Optional: draw post backgrounds from the admin's OWN tagged assets instead of
  // SD. Configured via Autopilot's "asset tags". Case-insensitive tag match; the
  // pool is round-robined across the batch so posts vary.
  let assetPool = [], assetPick = 0;
  if (Array.isArray(opts.assetTags) && opts.assetTags.length) {
    try {
      const orTags = opts.assetTags
        .map(t => String(t).trim()).filter(Boolean)
        .map(t => ({ tags: { $elemMatch: { $regex: `^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } } }));
      if (orTags.length) assetPool = await db.collection('assets').find({ fileType: 'image', $or: orTags }).sort({ uploadedAt: -1 }).limit(40).toArray();
    } catch { assetPool = []; }
  }

  const out = { tenant: tenant.brand?.name || tenant.domain, db: tenant.db, created: 0, published: 0, failed: 0, items: [] };
  let idx = 0;
  for (const idea of posts) {
    idx++;
    const platform = idea.platform;
    const size = PLATFORM_SIZE[platform] || 'ig-post';
    const [pw, ph] = SIZE_PRESETS[size];
    progress(idx - 1, posts.length, `composing ${platform} ${idx}/${posts.length}`);
    const headline = cleanCopy(idea.headline || idea.caption || 'Update').slice(0, 80);
    const subtitle = cleanCopy(idea.subtitle || '').slice(0, 90);
    const caption = cleanCopy(idea.caption || headline).slice(0, 2000);
    const seed = idea.image_seed || '';
    // Auto-attach a content link when a post clearly promotes a known blog/portfolio item.
    if (!(idea.link || '').trim()) { const m = matchContentItem(idea, marketing.items); if (m) idea.link = m.url; }

    // Cohesive batch background (shared style across the batch), unless this post
    // promotes a content item that brings its own image.
    let sdBuf = null, sdBgUrl = null, layers, designStyle;
    const promo = (idea.link || '').trim() ? marketing.items.find(it => it.image && it.url === idea.link.trim()) : null;
    if (promo) {
      try { const r = await fetch(promo.image, { signal: AbortSignal.timeout(20000) }); if (r.ok) { sdBuf = Buffer.from(await r.arrayBuffer()); sdBgUrl = promo.image; } } catch { /* fall through */ }
    }
    // No promo image → use a tagged asset background when the pool has any.
    if (!sdBuf && assetPool.length) {
      const a = assetPool[assetPick++ % assetPool.length];
      const url = a.publicUrl || a.url;
      if (url) { try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (r.ok) { sdBuf = Buffer.from(await r.arrayBuffer()); sdBgUrl = url; } } catch { /* fall through to SD/solid */ } }
    }
    // A promo post keeps its own content image (photo). Otherwise honor the style:
    // solid poster, photo bg, or auto (alternate so a batch has visual variety).
    const useSolid = !sdBuf && (style === 'solid' || (style === 'auto' && idx % 2 === 1));
    if (useSolid) {
      layers = buildSolidDesign(size, palette, headline, subtitle, layoutOpts);
      designStyle = 'solid';
    } else {
      if (!sdBuf) { const bg = await getBatchBg(size); sdBuf = bg.buf; sdBgUrl = bg.url; }
      const band = sdBuf ? await analyzeClearBand(sdBuf, size) : { y0: 0.18, y1: 0.82, dark: true };
      layers = buildLayersSmart(size, palette, headline, subtitle, band, layoutOpts);
      designStyle = 'photo';
    }
    const png = await renderLayersToPng({ size, bgColor: palette.bg, sdBackground: sdBuf, layers });
    const up = await uploadPng(png, tenant.s3Prefix, `${platform}-auto-${idx}`);
    const design = { size, bgColor: palette.bg, sdBgUrl, layers, style: designStyle };
    // Composite lives in S3 + the post doc only — it does NOT enter the Assets library.

    const willPublish = mode === 'publish' && publishable.has(platform);
    const post = {
      body: caption, link: (idea.link || '').trim(), mediaUrls: [up.url], platforms: [platform],
      status: willPublish ? 'publishing' : 'draft',
      suggestion: mode !== 'publish', source: 'auto', kind: idea.type || null,
      headline, subtitle, seed, design, dims: `${pw}x${ph}`,
      assetIds: [], scheduledAt: null, publishedAt: null, results: [],
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
  progress(posts.length, posts.length, 'done');
  return out;
}
