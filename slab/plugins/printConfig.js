// ─────────────────────────────────────────────────────────────────────────────
// Print Studio config — formats (dimensions/fields) + design themes (type/palette)
//
// Used by routes/admin/printStudio.js and views/print/material.ejs. The route
// resolves a tenant's brand colors into a working palette via theme.mapPalette(),
// sets CSS variables in the render template, and each theme's `css` skins the
// generic regions (.m-logo .m-headline .m-subhead .m-body .m-offer .m-cta
// .m-contact .m-qr). Px = inches × 300 (300 dpi print).
// ─────────────────────────────────────────────────────────────────────────────
import { mixHex, relativeLuminance, readableTextColor } from './colorContrast.js';

// All field keys a material can carry. A format's `fields` array whitelists
// which of these the editor exposes (the "input may be exclusive" rule).
export const FIELD_KEYS = ['logo', 'headline', 'subhead', 'body', 'offer', 'cta', 'tagline', 'contact', 'qr'];

// ── Formats ──────────────────────────────────────────────────────────────────
// shape: 'rect' | 'round'. orientation derived from w/h. output: which exports
// make sense (buttons/stickers → png; everything supports pdf).
export const PRINT_FORMATS = {
  'business-card': {
    label: 'Business Card', group: 'Cards', wIn: 3.5, hIn: 2, bleedIn: 0.125, safeIn: 0.125,
    shape: 'rect', fields: ['logo', 'tagline', 'contact', 'qr'], output: ['pdf', 'png'],
  },
  'postcard': {
    label: 'Postcard (6×4)', group: 'Cards', wIn: 6, hIn: 4, bleedIn: 0.125, safeIn: 0.15,
    shape: 'rect', fields: ['logo', 'headline', 'subhead', 'offer', 'cta', 'contact', 'qr'], output: ['pdf', 'png'],
  },
  'flyer-half': {
    label: 'Flyer — Half (5.5×8.5)', group: 'Flyers', wIn: 5.5, hIn: 8.5, bleedIn: 0.125, safeIn: 0.25,
    shape: 'rect', fields: ['logo', 'headline', 'subhead', 'body', 'offer', 'cta', 'contact', 'qr'], output: ['pdf', 'png'],
  },
  'flyer-letter': {
    label: 'Flyer — Letter (8.5×11)', group: 'Flyers', wIn: 8.5, hIn: 11, bleedIn: 0.125, safeIn: 0.25,
    shape: 'rect', fields: ['logo', 'headline', 'subhead', 'body', 'offer', 'cta', 'contact', 'qr'], output: ['pdf', 'png'],
  },
  'poster-tabloid': {
    label: 'Poster — Tabloid (11×17)', group: 'Posters', wIn: 11, hIn: 17, bleedIn: 0.125, safeIn: 0.3,
    shape: 'rect', fields: ['logo', 'headline', 'subhead', 'offer', 'cta', 'qr'], output: ['pdf'],
  },
  'poster-18x24': {
    label: 'Poster — Large (18×24)', group: 'Posters', wIn: 18, hIn: 24, bleedIn: 0.125, safeIn: 0.4,
    shape: 'rect', fields: ['logo', 'headline', 'subhead', 'offer', 'cta', 'qr'], output: ['pdf'],
  },
  'poster-24x36': {
    label: 'Poster — Big (24×36)', group: 'Posters', wIn: 24, hIn: 36, bleedIn: 0.125, safeIn: 0.5,
    shape: 'rect', fields: ['logo', 'headline', 'subhead', 'offer', 'cta', 'qr'], output: ['pdf'],
  },
  'sticker-round': {
    label: 'Sticker — Round (3″)', group: 'Stickers & Buttons', wIn: 3, hIn: 3, bleedIn: 0.125, safeIn: 0.2,
    shape: 'round', fields: ['logo', 'headline', 'qr'], output: ['png', 'pdf'],
  },
  'sticker-square': {
    label: 'Sticker — Square (3″)', group: 'Stickers & Buttons', wIn: 3, hIn: 3, bleedIn: 0.125, safeIn: 0.2,
    shape: 'rect', fields: ['logo', 'headline', 'qr'], output: ['png', 'pdf'],
  },
  'button-225': {
    label: 'Button (2.25″)', group: 'Stickers & Buttons', wIn: 2.25, hIn: 2.25, bleedIn: 0.25, safeIn: 0.3,
    shape: 'round', fields: ['logo', 'headline', 'qr'], output: ['png'],
  },
  'button-1': {
    label: 'Button (1″)', group: 'Stickers & Buttons', wIn: 1, hIn: 1, bleedIn: 0.25, safeIn: 0.15,
    shape: 'round', fields: ['logo', 'qr'], output: ['png'],
  },
  'door-hanger': {
    label: 'Door Hanger (4.25×11)', group: 'Specialty', wIn: 4.25, hIn: 11, bleedIn: 0.125, safeIn: 0.25,
    shape: 'rect', hole: true, fields: ['logo', 'headline', 'subhead', 'offer', 'cta', 'contact', 'qr'], output: ['pdf'],
  },
  'table-tent': {
    label: 'Table Tent (4×6)', group: 'Specialty', wIn: 4, hIn: 6, bleedIn: 0.125, safeIn: 0.25,
    shape: 'rect', fields: ['logo', 'headline', 'subhead', 'offer', 'qr'], output: ['pdf'],
  },
  'yard-sign': {
    label: 'Yard Sign (24×18)', group: 'Specialty', wIn: 24, hIn: 18, bleedIn: 0.25, safeIn: 0.6,
    shape: 'rect', fields: ['logo', 'headline', 'subhead', 'cta', 'contact', 'qr'], output: ['pdf'],
  },
};

export const DEFAULT_FORMAT = 'business-card';
export const ALL_FORMAT_KEYS = Object.keys(PRINT_FORMATS);

// Draggable regions in the render template (tagline lives inside contact).
export const REGION_KEYS = ['logo', 'headline', 'subhead', 'body', 'offer', 'cta', 'contact', 'qr'];

// Pages for gang/imposition sheets (printable sheet size, inches).
export const PAGE_SIZES = {
  letter: { label: 'Letter (8.5×11)', wIn: 8.5, hIn: 11, marginIn: 0.25 },
  tabloid: { label: 'Tabloid (11×17)', wIn: 11, hIn: 17, marginIn: 0.3 },
};

// Normalize a tenant design doc into the brand colors the themes consume.
export function brandColors(design = {}) {
  return {
    primary: design.color_primary || '#1C2B4A',
    deep: design.color_primary_deep || design.color_primary || '#0F1B30',
    mid: design.color_primary_mid || design.color_primary || '#2E4270',
    accent: design.color_accent || '#C9A848',
    accentLight: design.color_accent_light || '#E8D08A',
    bg: design.color_bg || '#F5F3EF',
    ink: design.color_dark || '#0F1B30',
    paper: design.color_white || '#FDFCFA',
  };
}

// Desaturate a hex toward its luminance-equivalent grey.
function grey(hex) {
  const l = Math.round(relativeLuminance(hex) * 255);
  const h = l.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

// ── Themes ───────────────────────────────────────────────────────────────────
// Each theme: { label, fonts, googleFonts, mode, mapPalette(bc), css, deco }
// mapPalette returns { bg, ink, accent, sub, panel, line }. css uses the CSS
// vars the base template sets (--bg --ink --accent --sub --panel --line
// --f-head --f-body) and skins the generic regions. `deco` is static ornament
// HTML laid behind content inside the safe area.
export const PRINT_THEMES = {
  classic: {
    label: 'Classic', mode: 'color',
    fonts: { heading: "'Cormorant Garamond', serif", body: "'Jost', sans-serif" },
    googleFonts: ['Cormorant+Garamond:wght@500;600;700', 'Jost:wght@300;400;500'],
    mapPalette: (bc) => ({ bg: bc.paper, ink: bc.ink, accent: bc.accent, sub: mixHex(bc.ink, bc.paper, 0.45), panel: bc.bg, line: mixHex(bc.ink, bc.paper, 0.8) }),
    css: `
      .m-headline{font-weight:600;letter-spacing:-0.01em;line-height:1.05}
      .m-subhead{font-style:italic;color:var(--sub)}
      .m-offer{color:var(--accent);font-weight:600;letter-spacing:0.04em}
      .m-cta{border:1.5px solid var(--accent);color:var(--accent);border-radius:2px;padding:0.5em 1.1em;display:inline-block}
      .m-rule{height:1px;background:var(--line);width:38%}
      .m-frame{position:absolute;inset:4% 5%;border:1px solid var(--line);pointer-events:none}`,
    deco: `<div class="m-frame"></div>`,
  },
  deco: {
    label: 'Art Deco', mode: 'color',
    fonts: { heading: "'Cinzel', serif", body: "'Poiret One', sans-serif" },
    googleFonts: ['Cinzel:wght@500;600;700', 'Poiret+One'],
    mapPalette: (bc) => ({ bg: bc.deep, ink: bc.paper, accent: bc.accent, sub: mixHex(bc.paper, bc.deep, 0.4), panel: mixHex(bc.deep, '#000000', 0.85), line: bc.accent }),
    css: `
      .m-headline{font-weight:700;letter-spacing:0.06em;text-transform:uppercase;line-height:1.1}
      .m-subhead{letter-spacing:0.32em;text-transform:uppercase;color:var(--accent);font-size:0.7em}
      .m-offer{color:var(--accent);font-weight:600}
      .m-cta{border:2px solid var(--accent);color:var(--accent);padding:0.5em 1.3em;letter-spacing:0.2em;text-transform:uppercase;display:inline-block}
      .m-frame{position:absolute;inset:5%;border:2px solid var(--accent);pointer-events:none}
      .m-frame::before,.m-frame::after{content:'';position:absolute;width:14%;height:14%;border:2px solid var(--accent)}
      .m-frame::before{top:-2px;left:-2px;border-right:0;border-bottom:0}
      .m-frame::after{bottom:-2px;right:-2px;border-left:0;border-top:0}
      .m-sun{position:absolute;left:50%;top:8%;width:30%;aspect-ratio:2/1;transform:translateX(-50%);background:repeating-conic-gradient(from 180deg at 50% 100%, var(--accent) 0 4deg, transparent 4deg 12deg);opacity:0.5}`,
    deco: `<div class="m-frame"></div><div class="m-sun"></div>`,
  },
  punk: {
    label: 'Punk Zine', mode: 'color',
    fonts: { heading: "'Rubik Glitch', system-ui", body: "'Special Elite', monospace" },
    googleFonts: ['Rubik+Glitch', 'Special+Elite'],
    mapPalette: (bc) => ({ bg: '#111111', ink: '#f4f4f4', accent: bc.accent, sub: '#bdbdbd', panel: '#000000', line: bc.accent }),
    css: `
      .m-headline{text-transform:uppercase;line-height:0.92;transform:rotate(-2deg)}
      .m-subhead{background:var(--accent);color:#111;display:inline-block;padding:0.05em 0.4em;transform:rotate(1.5deg);font-weight:700}
      .m-offer{background:#f4f4f4;color:#111;display:inline-block;padding:0.1em 0.4em;transform:rotate(-1deg);font-weight:700}
      .m-cta{background:var(--accent);color:#111;padding:0.5em 1.1em;display:inline-block;transform:rotate(1deg);font-weight:700;border:2px solid #111}
      .m-tape{position:absolute;width:22%;height:5%;background:rgba(244,244,244,0.35);top:6%;left:9%;transform:rotate(-7deg)}
      .m-tape.b{top:auto;left:auto;bottom:9%;right:8%;transform:rotate(6deg)}
      .m-noise{position:absolute;inset:0;opacity:0.06;background-image:radial-gradient(#fff 1px,transparent 1px);background-size:4px 4px;pointer-events:none}`,
    deco: `<div class="m-noise"></div><div class="m-tape"></div><div class="m-tape b"></div>`,
  },
  'old-english': {
    label: 'Old English', mode: 'color',
    fonts: { heading: "'Pirata One', system-ui", body: "'EB Garamond', serif" },
    googleFonts: ['Pirata+One', 'EB+Garamond:wght@400;500;600'],
    mapPalette: (bc) => ({ bg: bc.paper, ink: '#1a1a1a', accent: bc.deep, sub: '#555', panel: bc.bg, line: '#1a1a1a' }),
    css: `
      .m-headline{font-weight:400;line-height:1.0}
      .m-subhead{font-variant:small-caps;letter-spacing:0.12em;color:var(--accent)}
      .m-offer{font-variant:small-caps;letter-spacing:0.1em;font-weight:600}
      .m-cta{border:3px double var(--ink);padding:0.45em 1.1em;display:inline-block;font-variant:small-caps;letter-spacing:0.08em}
      .m-frame{position:absolute;inset:4%;border:3px double var(--ink);pointer-events:none}
      .m-rule{height:0;border-top:3px double var(--ink);width:44%}`,
    deco: `<div class="m-frame"></div>`,
  },
  pencil: {
    label: 'Pencil Sketch', mode: 'grey',
    fonts: { heading: "'Caveat', cursive", body: "'Shadows Into Light', cursive" },
    googleFonts: ['Caveat:wght@500;600;700', 'Shadows+Into+Light'],
    mapPalette: (bc) => ({ bg: '#fbfbf9', ink: '#2b2b2b', accent: grey(bc.accent), sub: '#6b6b6b', panel: '#f2f2ee', line: '#2b2b2b' }),
    css: `
      .m-headline{line-height:0.95}
      .m-subhead{color:var(--sub)}
      .m-cta{border:2px solid var(--ink);border-radius:14px 10px 16px 8px/8px 16px 10px 14px;padding:0.4em 1.1em;display:inline-block}
      .m-offer{text-decoration:underline wavy var(--ink)}
      .m-frame{position:absolute;inset:5%;border:2px solid var(--ink);border-radius:18px 8px 20px 10px/10px 20px 8px 18px;pointer-events:none}
      .m-hatch{position:absolute;inset:0;opacity:0.05;background-image:repeating-linear-gradient(45deg,#000 0 1px,transparent 1px 6px);pointer-events:none}`,
    deco: `<div class="m-hatch"></div><div class="m-frame"></div>`,
  },
  bw: {
    label: 'Black & White', mode: 'bw',
    fonts: { heading: "'Archivo Black', system-ui", body: "'Inter', sans-serif" },
    googleFonts: ['Archivo+Black', 'Inter:wght@400;600;800'],
    mapPalette: () => ({ bg: '#ffffff', ink: '#000000', accent: '#000000', sub: '#444444', panel: '#000000', line: '#000000' }),
    css: `
      .m-headline{text-transform:uppercase;letter-spacing:-0.02em;line-height:0.9}
      .m-subhead{font-weight:600;text-transform:uppercase;letter-spacing:0.1em}
      .m-offer{background:#000;color:#fff;display:inline-block;padding:0.1em 0.45em;font-weight:800}
      .m-cta{background:#000;color:#fff;padding:0.55em 1.3em;display:inline-block;font-weight:800;text-transform:uppercase;letter-spacing:0.06em}
      .m-bar{height:0.4em;background:#000;width:55%}
      .m-frame{position:absolute;inset:4%;border:4px solid #000;pointer-events:none}`,
    deco: `<div class="m-frame"></div>`,
  },
  greyscale: {
    label: 'Greyscale', mode: 'grey',
    fonts: { heading: "'Oswald', sans-serif", body: "'Inter', sans-serif" },
    googleFonts: ['Oswald:wght@400;500;600;700', 'Inter:wght@400;500;600'],
    mapPalette: (bc) => ({ bg: '#f3f3f3', ink: '#1c1c1c', accent: grey(bc.accent), sub: '#6a6a6a', panel: '#dedede', line: '#bdbdbd' }),
    css: `
      .m-headline{text-transform:uppercase;letter-spacing:0.02em;line-height:1.0;font-weight:600}
      .m-subhead{color:var(--sub);text-transform:uppercase;letter-spacing:0.18em;font-size:0.72em}
      .m-offer{background:var(--ink);color:#fff;display:inline-block;padding:0.1em 0.5em}
      .m-cta{border:2px solid var(--ink);padding:0.5em 1.2em;display:inline-block;text-transform:uppercase;letter-spacing:0.05em}
      .m-rule{height:2px;background:var(--ink);width:40%}`,
    deco: ``,
  },
  minimal: {
    label: 'Minimal', mode: 'color',
    fonts: { heading: "'Inter', sans-serif", body: "'Inter', sans-serif" },
    googleFonts: ['Inter:wght@300;400;500;600;700'],
    mapPalette: (bc) => ({ bg: bc.paper, ink: bc.ink, accent: bc.accent, sub: mixHex(bc.ink, bc.paper, 0.5), panel: bc.bg, line: mixHex(bc.ink, bc.paper, 0.86) }),
    css: `
      .m-headline{font-weight:600;letter-spacing:-0.03em;line-height:1.02}
      .m-subhead{color:var(--sub);font-weight:400}
      .m-offer{color:var(--accent);font-weight:600}
      .m-cta{background:var(--accent);color:#fff;padding:0.6em 1.4em;border-radius:6px;display:inline-block;font-weight:500}
      .m-dot{width:0.5em;height:0.5em;border-radius:50%;background:var(--accent);display:inline-block}`,
    deco: ``,
  },
  'bold-poster': {
    label: 'Bold Poster', mode: 'color',
    fonts: { heading: "'Anton', sans-serif", body: "'Barlow Condensed', sans-serif" },
    googleFonts: ['Anton', 'Barlow+Condensed:wght@400;500;600;700'],
    mapPalette: (bc) => ({ bg: bc.accent, ink: readableTextColor(bc.accent), accent: bc.deep, sub: mixHex(readableTextColor(bc.accent), bc.accent, 0.3), panel: bc.deep, line: readableTextColor(bc.accent) }),
    css: `
      .m-headline{text-transform:uppercase;letter-spacing:-0.01em;line-height:0.84}
      .m-subhead{text-transform:uppercase;letter-spacing:0.06em;font-weight:600}
      .m-offer{background:var(--ink);color:var(--bg);display:inline-block;padding:0.08em 0.5em;font-weight:700}
      .m-cta{background:var(--accent);color:var(--bg);padding:0.55em 1.4em;display:inline-block;text-transform:uppercase;font-weight:700;letter-spacing:0.04em}
      .m-bar{height:0.6em;background:var(--ink);width:60%}`,
    deco: ``,
  },
  retro: {
    label: 'Retro', mode: 'color',
    fonts: { heading: "'Monoton', system-ui", body: "'Righteous', sans-serif" },
    googleFonts: ['Monoton', 'Righteous'],
    mapPalette: (bc) => ({ bg: bc.deep, ink: bc.accentLight, accent: bc.accent, sub: mixHex(bc.accentLight, bc.deep, 0.35), panel: mixHex(bc.deep, '#000', 0.7), line: bc.accent }),
    css: `
      .m-headline{line-height:1.0;text-shadow:0.04em 0.04em 0 var(--accent)}
      .m-subhead{letter-spacing:0.2em;text-transform:uppercase;color:var(--accent)}
      .m-offer{color:var(--bg);background:var(--accent);display:inline-block;padding:0.1em 0.5em;border-radius:999px}
      .m-cta{border:3px solid var(--accent);color:var(--ink);padding:0.5em 1.3em;border-radius:999px;display:inline-block;text-transform:uppercase;letter-spacing:0.1em}
      .m-stripes{position:absolute;left:0;right:0;bottom:0;height:10%;background:repeating-linear-gradient(90deg,var(--accent) 0 8%,transparent 8% 16%);opacity:0.5}`,
    deco: `<div class="m-stripes"></div>`,
  },
};

export const DEFAULT_THEME = 'classic';

// Fonts offered in the per-object font picker. `g` = Google Fonts family param;
// all are loaded into every material so any pick renders in preview AND export.
export const PICKER_FONTS = [
  { label: 'Cormorant', css: "'Cormorant Garamond', serif", g: 'Cormorant+Garamond:wght@500;600;700' },
  { label: 'Playfair', css: "'Playfair Display', serif", g: 'Playfair+Display:wght@500;700;900' },
  { label: 'Cinzel', css: "'Cinzel', serif", g: 'Cinzel:wght@500;700' },
  { label: 'Roboto Slab', css: "'Roboto Slab', serif", g: 'Roboto+Slab:wght@400;700' },
  { label: 'EB Garamond', css: "'EB Garamond', serif", g: 'EB+Garamond:wght@400;600' },
  { label: 'Inter', css: "'Inter', sans-serif", g: 'Inter:wght@400;600;800' },
  { label: 'Jost', css: "'Jost', sans-serif", g: 'Jost:wght@300;400;500;700' },
  { label: 'Montserrat', css: "'Montserrat', sans-serif", g: 'Montserrat:wght@400;600;800' },
  { label: 'Oswald', css: "'Oswald', sans-serif", g: 'Oswald:wght@400;600;700' },
  { label: 'Bebas Neue', css: "'Bebas Neue', sans-serif", g: 'Bebas+Neue' },
  { label: 'Anton', css: "'Anton', sans-serif", g: 'Anton' },
  { label: 'Archivo Black', css: "'Archivo Black', sans-serif", g: 'Archivo+Black' },
  { label: 'Pacifico', css: "'Pacifico', cursive", g: 'Pacifico' },
  { label: 'Lobster', css: "'Lobster', cursive", g: 'Lobster' },
  { label: 'Caveat', css: "'Caveat', cursive", g: 'Caveat:wght@500;700' },
  { label: 'Special Elite', css: "'Special Elite', monospace", g: 'Special+Elite' },
];
export const PICKER_FONT_CSS = new Set(PICKER_FONTS.map((f) => f.css));

// Build the Google Fonts href param for a theme (merged with body fonts upstream).
export function themeFontsParam(themeKey) {
  const t = PRINT_THEMES[themeKey] || PRINT_THEMES[DEFAULT_THEME];
  return (t.googleFonts || []).join('&family=');
}
