// ─────────────────────────────────────────────────────────────────────────────
// Print Studio — branded print-marketing campaign generator.
// Mounted at /admin/print-studio. A "campaign" doc holds shared content + a set
// of enabled formats + per-format drag layouts. The editor shows a board of ALL
// enabled formats; downloads zip every format; any format can be gang-imposed
// (auto-fill + crop marks) for cutting. Reuses qr_links, design, brand_images.
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';
import QRCode from 'qrcode';
import archiver from 'archiver';
import { ObjectId } from 'mongodb';
import {
  PRINT_FORMATS, PRINT_THEMES, DEFAULT_FORMAT, DEFAULT_THEME,
  ALL_FORMAT_KEYS, REGION_KEYS, PAGE_SIZES, brandColors,
  PICKER_FONTS, PICKER_FONT_CSS,
} from '../../plugins/printConfig.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { callLLM, webSearch, tryParseAgentResponse, generateSdImage } from '../../plugins/agentMcp.js';
import { relativeLuminance } from '../../plugins/colorContrast.js';
import { htmlToPdf, htmlToPng, htmlToBatch } from '../../plugins/headless.js';
import { renderStyledQRDataUrl } from '../../plugins/qrStyle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS = path.resolve(__dirname, '..', '..', 'views', 'print');
const T_MATERIAL = path.join(VIEWS, 'material.ejs');
const T_GANG = path.join(VIEWS, 'gangsheet.ejs');

const router = express.Router();
const COPY_FIELDS = ['headline', 'subhead', 'body', 'offer', 'cta', 'tagline'];

// ── small helpers ──
const num = (x, d = 0) => { const n = parseFloat(x); return Number.isFinite(n) ? n : d; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));
const slugify = (s) => String(s || 'material').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

async function loadDesign(db) {
  const rows = await db.collection('design').find({}).toArray();
  const d = {}; for (const r of rows) d[r.key] = r.value; return d;
}
// Load the theme's display fonts PLUS every picker font, so any per-object font
// choice renders in both the live preview and the exported file.
const fontsHrefFor = (theme) => {
  const fams = [...(theme.googleFonts || []), ...PICKER_FONTS.map((f) => f.g)];
  return `https://fonts.googleapis.com/css2?family=${[...new Set(fams)].join('&family=')}&display=swap`;
};
const isHex = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(s);
const isSafeUrl = (s) => typeof s === 'string' && /^https?:\/\//.test(s) && s.length < 600;

// Default (deterministic) absolute layout used when a format is first edited.
function defaultRegions(c) {
  const { wTotalIn: W, hTotalIn: H, safeIn: S, qr, fmtKey, _present: P } = c;
  const x = S, cw = Math.max(W - 2 * S, 0.5), R = {};
  // Images (logo/qr) get a modest width that their box fills (aspect locked).
  // Text blocks get a wrap width; short ones (offer/cta) shrink-wrap (no width).
  const logoW = Math.min(cw * 0.42, 1.7);
  if (P.has('logo')) R.logo = { x, y: S, w: logoW };
  if (P.has('headline')) R.headline = { x, y: H * 0.30, w: cw };
  if (P.has('subhead')) R.subhead = { x, y: H * 0.45, w: cw };
  if (P.has('body')) R.body = { x, y: H * 0.53, w: cw * 0.9 };
  if (P.has('offer')) R.offer = { x, y: H * 0.64 };
  if (P.has('cta')) R.cta = { x, y: H * 0.72 };
  if (P.has('contact')) R.contact = { x, y: H * 0.80, w: cw * 0.55 };
  if (P.has('qr')) { const q = qr ? qr.sizeIn : 0.8; R.qr = { x: W - S - q * 1.15, y: H - S - q * 1.6, w: +(q * 1.05).toFixed(3) }; }
  if (fmtKey === 'button-1') {
    if (R.logo) R.logo = { x: W * 0.2, y: H * 0.16, w: W * 0.6 };
    if (R.qr) { const q = qr.sizeIn; R.qr = { x: (W - q) / 2, y: H * 0.5, w: q }; }
  }
  for (const k in R) { R[k].x = +R[k].x.toFixed(3); R[k].y = +R[k].y.toFixed(3); if (R[k].w) R[k].w = +(+R[k].w).toFixed(3); }
  return R;
}

// Build the EJS render context for one campaign + one format.
async function buildContext(req, material, formatKey, opts = {}) {
  const db = req.db;
  const design = await loadDesign(db);
  const bc = brandColors(design);
  const brand = req.tenant?.brand || {};

  const fmtKey = PRINT_FORMATS[formatKey] ? formatKey : DEFAULT_FORMAT;
  const themeKey = PRINT_THEMES[material.theme] ? material.theme : DEFAULT_THEME;
  const fmt = PRINT_FORMATS[fmtKey];
  const theme = PRINT_THEMES[themeKey];
  const pal = theme.mapPalette(bc);
  const allow = new Set(fmt.fields);
  const data = material.fields || {};

  // Logo
  let logoUrl = '';
  const showLogo = material.showLogo !== false && allow.has('logo');
  if (showLogo) {
    const slot = material.logoSlot || 'logo_primary';
    const row = await db.collection('brand_images').findOne({ slot })
      || await db.collection('brand_images').findOne({ slot: 'logo_primary' })
      || await db.collection('brand_images').findOne({ slot: 'logo_icon' });
    logoUrl = row?.url || '';
  }

  const contact = {
    name: brand.name || '', phone: brand.phone || '', email: brand.email || '',
    location: brand.location || '', website: req.tenant?.domain || '',
  };

  // QR
  let qr = null;
  if (allow.has('qr') && material.qrLinkId) {
    try {
      const link = await db.collection('qr_links').findOne({ _id: new ObjectId(material.qrLinkId) });
      if (link) {
        // Inherit the QR link's style (module shape / fill / logo / phantom) but
        // RE-TINT colors to the material palette for cohesion. Renders on the
        // template's white QR card (transparent bg = quiet zone).
        const ls = link.style || {};
        const dark = relativeLuminance(pal.ink) > 0.4 ? '#111111' : pal.ink;
        const style = {
          module: ls.module || 'square',
          fill: ls.fill === 'gradient' ? 'gradient' : 'solid',
          gradientType: ls.gradientType || 'linear',
          color1: dark, color2: pal.accent,
          logo: !!ls.logo, bg: 'transparent',
        };
        let logoUrl;
        if (style.logo) { const lr = await db.collection('brand_images').findOne({ slot: 'logo_primary' }); logoUrl = lr?.url; }
        const dataUrl = await renderStyledQRDataUrl(link.url, style, {
          size: 600, transparent: true, logoUrl, alpha: ls.phantom ? 0.78 : 1,
        });
        const minSide = Math.min(fmt.wIn, fmt.hIn);
        qr = { dataUrl, caption: material.qrCaption || 'Scan to connect', sizeIn: Math.max(0.55, Math.min(minSide * 0.22, 2.2)) };
      }
    } catch { /* skip */ }
  }

  // Background
  const bg = { type: material.bgType || 'theme', color: material.bgColor || '', color2: material.bgColor2 || '', imageUrl: material.bgImageUrl || '' };
  if (bg.type === 'theme' || (bg.type === 'color' && !bg.color)) { bg.type = 'color'; bg.color = pal.bg; }
  const scrim = (bg.type === 'image' || bg.type === 'ai');

  const wTotalIn = +(fmt.wIn + fmt.bleedIn * 2).toFixed(3);
  const hTotalIn = +(fmt.hIn + fmt.bleedIn * 2).toFixed(3);
  const rootPx = +Math.max(7, Math.min(Math.min(wTotalIn, hTotalIn) * 96 / 22, 64)).toFixed(2);

  // present-region set (mirrors _material-body present())
  const _present = new Set(REGION_KEYS.filter((k) => {
    const v = (x) => (data[x] != null ? String(data[x]) : '');
    if (k === 'logo') return showLogo && (logoUrl || contact.name);
    if (k === 'contact') return allow.has('contact') && (contact.name || contact.phone || contact.email || contact.website || contact.location || (allow.has('tagline') && v('tagline')));
    if (k === 'qr') return allow.has('qr') && qr;
    return allow.has(k) && v(k);
  }));

  const ctx = {
    fmtKey, fmt, themeKey, theme, pal, fonts: theme.fonts, fontsHref: fontsHrefFor(theme),
    themeCss: theme.css || '', decoHtml: theme.deco || '',
    data, contact, logoUrl, showLogo, qr, bg, scrim,
    wTotalIn, hTotalIn, safeIn: fmt.safeIn, rootPx, allow, REGION_KEYS, _present,
    edit: !!opts.edit, custom: false, regions: null, objects: [], pickerFonts: PICKER_FONTS,
  };

  const saved = material.layouts && material.layouts[fmtKey];
  if (ctx.edit) {
    ctx.regions = (saved && saved.regions) ? saved.regions : defaultRegions(ctx);
  } else if (saved && saved.custom && saved.regions) {
    ctx.custom = true; ctx.regions = saved.regions;
  }
  // User-placed image objects (only in absolute/custom mode).
  if ((ctx.edit || ctx.custom) && saved && Array.isArray(saved.objects)) ctx.objects = saved.objects;

  // Heal custom layouts against newer/added content:
  //  • a present region with NO saved entry (e.g. a QR added after the layout
  //    was saved) renders with no position/width → it shrink-wraps to its
  //    intrinsic pixel size (the QR is 600px ≈ 6.25in) and fills the piece.
  //  • an image region missing an explicit width does the same.
  // Seed both from the deterministic defaults so nothing blows up.
  if (ctx.regions) {
    const defs = defaultRegions(ctx);
    for (const k of REGION_KEYS) {
      if (!_present.has(k)) continue;
      const r = ctx.regions[k];
      if (!r) {
        if (defs[k]) ctx.regions[k] = defs[k];
      } else if ((k === 'logo' || k === 'qr') && (r.w == null || r.w === '') && defs[k] && defs[k].w) {
        ctx.regions[k] = { ...r, w: defs[k].w };
      }
    }
  }
  return ctx;
}

const renderMaterial = async (req, material, formatKey, opts) =>
  ejs.renderFile(T_MATERIAL, await buildContext(req, material, formatKey, opts), { async: false });

// ── input parsing ──
function sanitizeEnabled(raw) {
  const out = {};
  try { const o = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); for (const k of ALL_FORMAT_KEYS) if (o[k]) out[k] = true; } catch { /* */ }
  if (!Object.keys(out).length) for (const k of ALL_FORMAT_KEYS) out[k] = true; // default: all on
  return out;
}
function sanitizeLayouts(raw) {
  const out = {};
  let o; try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return out; }
  if (!o || typeof o !== 'object') return out;
  for (const fk of ALL_FORMAT_KEYS) {
    const L = o[fk]; if (!L || typeof L !== 'object') continue;
    const regs = L.regions || {}; const ro = {};
    for (const rk of REGION_KEYS) {
      const r = regs[rk]; if (!r || typeof r !== 'object') continue;
      const e = { x: num(r.x), y: num(r.y) };
      if (r.w != null && r.w !== '') e.w = Math.max(0.1, num(r.w));
      if (r.fs != null) e.fs = clamp(num(r.fs, 1), 0.3, 6);
      if (r.opacity != null) e.opacity = clamp(num(r.opacity, 1), 0.05, 1);
      if (r.z != null && parseInt(r.z, 10)) e.z = clamp(parseInt(r.z, 10), -50, 50);
      if (['center', 'right'].includes(r.align)) e.align = r.align;
      if (PICKER_FONT_CSS.has(r.font)) e.font = r.font;
      if (isHex(r.color)) e.color = r.color;
      if (r.hidden) e.hidden = true;
      ro[rk] = e;
    }
    // user-placed image objects
    const objs = [];
    if (Array.isArray(L.objects)) {
      for (const o of L.objects.slice(0, 30)) {
        if (!o || !isSafeUrl(o.url)) continue;
        const e = { id: String(o.id || '').slice(0, 40) || ('o' + objs.length), url: o.url, x: num(o.x), y: num(o.y) };
        if (o.w != null && o.w !== '') e.w = Math.max(0.1, num(o.w));
        if (o.opacity != null) e.opacity = clamp(num(o.opacity, 1), 0.05, 1);
        if (o.z != null && parseInt(o.z, 10)) e.z = clamp(parseInt(o.z, 10), -50, 50);
        objs.push(e);
      }
    }
    if (Object.keys(ro).length || objs.length) out[fk] = { custom: true, regions: ro, objects: objs };
  }
  return out;
}
function materialFromInput(src = {}) {
  const fields = {}; for (const k of COPY_FIELDS) if (src[k] != null) fields[k] = String(src[k]);
  return {
    name: src.name || 'Untitled campaign',
    theme: src.theme || DEFAULT_THEME,
    fields,
    showLogo: src.showLogo !== '0' && src.showLogo !== false,
    logoSlot: src.logoSlot || 'logo_primary',
    qrLinkId: src.qrLinkId || '',
    qrCaption: src.qrCaption || '',
    bgType: src.bgType || 'theme',
    bgColor: src.bgColor || '',
    bgColor2: src.bgColor2 || '',
    bgImageUrl: src.bgImageUrl || '',
    enabled: sanitizeEnabled(src.enabledJson),
    layouts: sanitizeLayouts(src.layoutsJson),
  };
}

// ── List + editor ──
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const [materials, qrLinks, brandImages] = await Promise.all([
      db.collection('print_materials').find({}).sort({ updatedAt: -1 }).toArray(),
      db.collection('qr_links').find({}).sort({ createdAt: -1 }).toArray(),
      db.collection('brand_images').find({ slot: { $in: ['logo_primary', 'logo_icon', 'hero_bg', 'support'] } }).toArray(),
    ]);
    const design = await loadDesign(db);
    res.render('admin/printStudio', {
      user: req.adminUser, page: 'print-studio', title: 'Print Studio',
      materials, qrLinks, brandImages,
      formats: PRINT_FORMATS, themes: PRINT_THEMES, pageSizes: PAGE_SIZES, allFormatKeys: ALL_FORMAT_KEYS,
      brandColors: brandColors(design),
      defaultFormat: DEFAULT_FORMAT, defaultTheme: DEFAULT_THEME, copyFields: COPY_FIELDS,
      saved: req.query.saved === '1', error: req.query.error || null,
    });
  } catch (err) {
    console.error('[PrintStudio] list error:', err);
    res.redirect('/admin?error=print');
  }
});

router.post('/', async (req, res) => {
  try {
    const now = new Date();
    const r = await req.db.collection('print_materials').insertOne({ ...materialFromInput(req.body), createdAt: now, updatedAt: now });
    res.redirect(`/admin/print-studio?saved=1#m-${r.insertedId}`);
  } catch (err) { console.error('[PrintStudio] create error:', err); res.redirect('/admin/print-studio?error=create'); }
});

router.post('/:id/update', async (req, res) => {
  try {
    await req.db.collection('print_materials').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...materialFromInput(req.body), updatedAt: new Date() } });
    res.redirect(`/admin/print-studio?saved=1#m-${req.params.id}`);
  } catch (err) { console.error('[PrintStudio] update error:', err); res.redirect('/admin/print-studio?error=update'); }
});

router.post('/:id/duplicate', async (req, res) => {
  try {
    const doc = await req.db.collection('print_materials').findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.redirect('/admin/print-studio?error=notfound');
    delete doc._id; doc.name = `${doc.name} (copy)`; doc.createdAt = doc.updatedAt = new Date();
    const r = await req.db.collection('print_materials').insertOne(doc);
    res.redirect(`/admin/print-studio?saved=1#m-${r.insertedId}`);
  } catch (err) { console.error('[PrintStudio] dup error:', err); res.redirect('/admin/print-studio?error=1'); }
});

router.post('/:id/delete', async (req, res) => {
  try { await req.db.collection('print_materials').deleteOne({ _id: new ObjectId(req.params.id) }); res.redirect('/admin/print-studio?saved=1'); }
  catch (err) { console.error('[PrintStudio] delete error:', err); res.redirect('/admin/print-studio?error=1'); }
});

// ── Asset library (images) for the "Add asset" picker ──
router.get('/assets', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const find = { fileType: 'image' };
    if (q) find.$or = [{ title: { $regex: q, $options: 'i' } }, { originalName: { $regex: q, $options: 'i' } }];
    const rows = await req.db.collection('assets').find(find).sort({ uploadedAt: -1 }).limit(120).toArray();
    res.json({ assets: rows.map((a) => ({ url: a.publicUrl, thumb: a.thumbUrl || a.publicUrl, title: a.title || a.originalName || '' })).filter((a) => a.url) });
  } catch (err) { console.error('[PrintStudio] assets error:', err); res.status(500).json({ error: err.message }); }
});

// ── Live preview for one format (draft from query; ?edit=1 enables drag) ──
router.get('/preview', async (req, res) => {
  try {
    const html = await renderMaterial(req, materialFromInput(req.query), req.query.format || DEFAULT_FORMAT,
      { edit: req.query.edit === '1' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    console.error('[PrintStudio] preview error:', err);
    res.status(500).send(`<pre style="font:13px monospace;padding:16px;color:#a00">Preview error: ${err.message}</pre>`);
  }
});

// ── Export one format as PDF / PNG ──
router.get('/:id/export.pdf', async (req, res) => exportOne(req, res, 'pdf'));
router.get('/:id/export.png', async (req, res) => exportOne(req, res, 'png'));
async function exportOne(req, res, kind) {
  try {
    const doc = await req.db.collection('print_materials').findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).send('Not found');
    const fmtKey = PRINT_FORMATS[req.query.format] ? req.query.format : DEFAULT_FORMAT;
    const ctx = await buildContext(req, doc, fmtKey);
    const html = await ejs.renderFile(T_MATERIAL, ctx, { async: false });
    const fname = `${slugify(doc.name)}-${fmtKey}.${kind}`;
    if (kind === 'pdf') {
      const buf = await htmlToPdf(html, ctx.wTotalIn, ctx.hTotalIn);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${fname}"`);
      return res.send(buf);
    }
    const buf = await htmlToPng(html, ctx.wTotalIn, ctx.hTotalIn, 300);
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (err) { console.error('[PrintStudio] export error:', err); res.status(500).send('Render failed: ' + err.message); }
}

// ── Export ALL enabled formats as a ZIP ──
router.get('/:id/export.zip', async (req, res) => {
  try {
    const doc = await req.db.collection('print_materials').findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).send('Not found');
    const enabled = ALL_FORMAT_KEYS.filter((k) => (doc.enabled || {})[k]);
    const keys = enabled.length ? enabled : [DEFAULT_FORMAT];

    // Render everything FIRST (one shared browser) so any failure is a clean 500
    // rather than a half-written/corrupt download.
    const items = [];
    for (const fmtKey of keys) {
      const fmt = PRINT_FORMATS[fmtKey];
      const ctx = await buildContext(req, doc, fmtKey);
      const html = await ejs.renderFile(T_MATERIAL, ctx, { async: false });
      const kind = fmt.output.includes('pdf') ? 'pdf' : 'png';
      items.push({ html, wIn: ctx.wTotalIn, hIn: ctx.hTotalIn, kind, name: `${fmtKey}.${kind}` });
    }
    const rendered = await htmlToBatch(items, 300);
    const good = rendered.filter((r) => r.buffer);
    rendered.filter((r) => r.error).forEach((r) => console.warn('[PrintStudio] zip skip', r.name, r.error));
    if (!good.length) return res.status(500).send('Zip failed: no formats rendered');

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${slugify(doc.name)}-print-pack.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (e) => { console.error('[PrintStudio] zip error:', e); try { res.end(); } catch { /* */ } });
    archive.pipe(res);
    for (const r of good) archive.append(r.buffer, { name: r.name });
    await archive.finalize();
  } catch (err) { console.error('[PrintStudio] zip build error:', err); if (!res.headersSent) res.status(500).send('Zip failed: ' + err.message); }
});

// ── Gang / imposition sheet (auto-fill + crop marks) ──
router.get('/:id/gang.pdf', async (req, res) => {
  try {
    const doc = await req.db.collection('print_materials').findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).send('Not found');
    const fmtKey = PRINT_FORMATS[req.query.format] ? req.query.format : DEFAULT_FORMAT;
    const page = PAGE_SIZES[req.query.page] || PAGE_SIZES.letter;
    const ctx = await buildContext(req, doc, fmtKey);

    const cellW = ctx.wTotalIn, cellH = ctx.hTotalIn;
    const gutterIn = Math.max(0.16, ctx.fmt.bleedIn);
    const innerW = page.wIn - page.marginIn * 2, innerH = page.hIn - page.marginIn * 2;
    const cols = Math.max(1, Math.floor((innerW + gutterIn) / (cellW + gutterIn)));
    const rows = Math.max(1, Math.floor((innerH + gutterIn) / (cellH + gutterIn)));

    const html = await ejs.renderFile(T_GANG, {
      ...ctx, page, cols, rows, cellW, cellH, gutterIn, bleedIn: ctx.fmt.bleedIn,
    }, { async: false });
    const buf = await htmlToPdf(html, page.wIn, page.hIn);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${slugify(doc.name)}-${fmtKey}-gang-${cols * rows}up.pdf"`);
    res.send(buf);
  } catch (err) { console.error('[PrintStudio] gang error:', err); res.status(500).send('Gang sheet failed: ' + err.message); }
});

// ── AI agent: fill copy fields from brand context ──
router.post('/agent', async (req, res) => {
  try {
    const { messages, format, currentFields } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });
    const fmt = PRINT_FORMATS[format] || PRINT_FORMATS[DEFAULT_FORMAT];
    // Copy is shared across the whole campaign — the agent may set every copy
    // field regardless of which format is in the edit stage.
    const allowed = COPY_FIELDS;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const search = await webSearch(lastUser.slice(0, 200));
    const researchCtx = search && !search.startsWith('Search') ? `\n\n--- WEB RESEARCH ---\n${search}\n--- END RESEARCH ---` : '';
    const brandCtx = await loadBrandContext(req.tenant, req.db);
    const currentCtx = currentFields ? `\n\nCurrent copy:\n${Object.entries(currentFields).map(([k, v]) => `  ${k}: "${v}"`).join('\n')}` : '';
    const guide = {
      headline: 'big punchy primary line (a few words)', subhead: 'short supporting line',
      body: 'one or two short sentences', offer: 'deal/promo badge e.g. "20% OFF"',
      cta: 'short call-to-action e.g. "Book Now"', tagline: 'brief brand tagline',
    };
    const systemPrompt = `You are a print-marketing copywriter for this business, writing copy used across a whole print campaign (cards, flyers, posters, stickers).

${brandCtx}

Write concise, punchy, print-ready copy. Headlines short; body tight. Match the brand voice.

Respond with ONLY valid JSON:
{ "message": "one-sentence note", "fill": { "field_key": "value" } }
Only include fields you set. If just chatting, use "fill": {}.

Fields you may set:
${allowed.map((k) => `- ${k}: ${guide[k]}`).join('\n')}
${currentCtx}${researchCtx}`;
    const parsed = tryParseAgentResponse(await callLLM(messages, systemPrompt));
    if (parsed.fill) for (const k of Object.keys(parsed.fill)) if (!allowed.includes(k)) delete parsed.fill[k];
    res.json(parsed);
  } catch (err) { console.error('[PrintStudio] agent error:', err); res.status(500).json({ error: 'Agent error: ' + err.message }); }
});

// ── AI background (Stable Diffusion, abstract texture only) ──
router.post('/bg/ai', async (req, res) => {
  try {
    const seed = (req.body?.seed || '').toString().trim().slice(0, 120);
    const bc = brandColors(await loadDesign(req.db));
    const prompt = `abstract seamless background texture, ${seed || 'soft subtle gradient pattern'}, `
      + `muted tones harmonizing with ${bc.primary} and ${bc.accent}, gentle, low-contrast, even lighting, `
      + `no focal point, suitable as a backdrop behind text`;
    const negative = 'text, words, letters, numbers, logo, watermark, people, face, person, object, product, '
      + 'animal, building, hands, sharp focal subject, busy, cluttered, high contrast';
    const buffer = await generateSdImage(prompt, negative, 'ig-post');
    const ins = await req.db.collection('print_assets').insertOne({ kind: 'ai-bg', mime: 'image/png', data: buffer, seed, createdAt: new Date() });
    res.json({ url: `/admin/print-studio/bg/${ins.insertedId}.png` });
  } catch (err) { console.error('[PrintStudio] ai-bg error:', err); res.status(500).json({ error: 'Background generation failed: ' + err.message }); }
});

router.get('/bg/:id.png', async (req, res) => {
  try {
    const doc = await req.db.collection('print_assets').findOne({ _id: new ObjectId(req.params.id.replace(/\.png$/, '')) });
    if (!doc) return res.status(404).end();
    res.set('Content-Type', doc.mime || 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(doc.data?.buffer ? Buffer.from(doc.data.buffer) : doc.data);
  } catch { res.status(500).end(); }
});

export default router;
