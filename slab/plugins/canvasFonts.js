// ─────────────────────────────────────────────────────────────────────────────
// canvasFonts.js — register the brand typefaces with node-canvas so server-side
// composites render the actual brand fonts (Cormorant, Playfair, Lora, …) instead
// of generic serif/sans. TTFs live in /srv/slab/assets/fonts (regular + bold per
// family). registerFont() MUST run before any canvas getContext(), so this module
// registers on import — import it before creating canvases.
// ─────────────────────────────────────────────────────────────────────────────
import { registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';

const FONT_DIR = process.env.BRAND_FONT_DIR || '/srv/slab/assets/fonts';

// Family display name → is it a serif? (mirrors the Asset Generator + design.js lists)
export const BRAND_FONT_META = {
  'Cormorant Garamond': true, 'Playfair Display': true, 'Lora': true,
  'Merriweather': true, 'Libre Baskerville': true,
  'Jost': false, 'Inter': false, 'Poppins': false, 'Raleway': false,
  'Nunito': false, 'DM Sans': false,
};

export const REGISTERED_FONTS = new Set();
let done = false;

export function registerBrandFonts() {
  if (done) return REGISTERED_FONTS;
  done = true;
  for (const family of Object.keys(BRAND_FONT_META)) {
    const base = family.replace(/\s+/g, '');
    const reg = path.join(FONT_DIR, `${base}-400.ttf`);
    const bold = path.join(FONT_DIR, `${base}-700.ttf`);
    try {
      let any = false;
      if (fs.existsSync(reg)) { registerFont(reg, { family, weight: 'normal' }); any = true; }
      if (fs.existsSync(bold)) { registerFont(bold, { family, weight: 'bold' }); any = true; }
      if (any) REGISTERED_FONTS.add(family);
    } catch { /* skip unreadable font file */ }
  }
  return REGISTERED_FONTS;
}

// Register immediately on import.
registerBrandFonts();

export function isRegisteredFont(name) { return REGISTERED_FONTS.has(String(name || '').trim()); }

// CSS font-family token for node-canvas: registered brand families are quoted;
// anything else collapses to the generic serif/sans-serif keyword.
export function fontToken(family) {
  const f = String(family || '').trim();
  if (REGISTERED_FONTS.has(f)) return `"${f}"`;
  if (f === 'serif') return 'serif';
  if (f === 'sans-serif' || f === 'sans') return 'sans-serif';
  if (BRAND_FONT_META[f] !== undefined) return BRAND_FONT_META[f] ? 'serif' : 'sans-serif';
  return 'sans-serif';
}
