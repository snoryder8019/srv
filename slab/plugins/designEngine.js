/**
 * designEngine.js — parametric design: tokens derived, not hand-picked.
 * ─────────────────────────────────────────────────────────────────────
 * Input:  the tenant design object (two brand colors + optional scale knobs).
 * Output: a flat { '--var': value } map that partials/_tokens.ejs prints.
 *
 * Three engines:
 *   culori       → OKLCH color ramps. Perceptually-uniform lightness ladder
 *                  (50…900) per brand color, hue preserved, chroma tapered at
 *                  the extremes and gamut-clamped, so ANY tenant hue yields a
 *                  balanced palette instead of sRGB-mix mud.
 *   apca-w3      → text-on-color choices by APCA Lc (the WCAG-3 candidate
 *                  algorithm), not the old ratio: picks ink vs paper per
 *                  swatch by whichever scores higher perceptual contrast.
 *   utopia-core  → fluid type + space scales (the clamp() math) from four
 *                  parameters. Tenants get a typographic *system*; changing
 *                  `type_ratio_max` re-tunes the whole page rhythm.
 *
 * Exposed to every EJS render via app.locals.designEngine (app.js).
 * Memoized — same design in, cached vars out.
 *
 * Design-panel knobs (all optional, sane defaults):
 *   type_base_min / type_base_max   base font px at 360px / 1440px viewports
 *   type_ratio_min / type_ratio_max scale ratio at each end (1.2 = minor third)
 *   space_base_min / space_base_max base spacing px at each end
 */
import { converter, formatHex, clampChroma, parse } from 'culori';
import { APCAcontrast, sRGBtoY } from 'apca-w3';
import { calculateTypeScale, calculateSpaceScale } from 'utopia-core';

const toOklch = converter('oklch');
const toRgb = converter('rgb');

const RAMP = [
  ['50', 0.975], ['100', 0.94], ['200', 0.88], ['300', 0.79], ['400', 0.70],
  ['500', 0.60], ['600', 0.51], ['700', 0.42], ['800', 0.33], ['900', 0.25],
];

/** Chroma taper — full saturation mid-ramp, gentler at the light/dark ends. */
function chromaAt(l, baseC) {
  const t = 1 - Math.abs(l - 0.58) / 0.42;          // 1 near L=.58, →0 at ends
  return baseC * Math.max(0.25, Math.min(1, 0.35 + 0.75 * t));
}

function ramp(prefix, hex, vars) {
  const src = toOklch(parse(hex));
  if (!src) return;
  const baseC = src.c ?? 0;
  for (const [step, l] of RAMP) {
    const c = clampChroma({ mode: 'oklch', l, c: chromaAt(l, baseC), h: src.h }, 'rgb');
    vars[`--${prefix}-${step}`] = formatHex(c);
  }
}

/** APCA Lc between text and bg hexes (needs 0-255 rgb triples). */
function lc(txtHex, bgHex) {
  const t = toRgb(parse(txtHex)), b = toRgb(parse(bgHex));
  if (!t || !b) return 0;
  const tr = [t.r, t.g, t.b].map(v => Math.round(v * 255));
  const br = [b.r, b.g, b.b].map(v => Math.round(v * 255));
  return APCAcontrast(sRGBtoY(tr), sRGBtoY(br));
}

/** Pick the higher-|Lc| text color for a background. */
function onColor(bgHex, paper, ink) {
  return Math.abs(lc(paper, bgHex)) >= Math.abs(lc(ink, bgHex)) ? paper : ink;
}

const cache = new Map();
const num = (v, fb) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };

export function buildDesignVars(design = {}) {
  const accent  = design.color_accent  || '#c9a848';
  const primary = design.color_primary || '#12233F';
  const knobs = {
    accent, primary,
    tbMin: num(design.type_base_min, 17),  tbMax: num(design.type_base_max, 19),
    trMin: num(design.type_ratio_min, 1.2), trMax: num(design.type_ratio_max, 1.25),
    sbMin: num(design.space_base_min, 16), sbMax: num(design.space_base_max, 20),
  };
  const key = JSON.stringify(knobs);
  if (cache.has(key)) return cache.get(key);

  const vars = {};

  /* ── OKLCH ramps ── */
  ramp('accent', accent, vars);
  ramp('primary', primary, vars);

  /* ── APCA text-on-color (paper = primary-50 tint, ink = primary-900) ── */
  const paper = vars['--primary-50'] || '#FDFCFA';
  const ink = vars['--primary-900'] || '#14181F';
  vars['--on-accent-apca']  = onColor(accent, paper, ink);
  vars['--on-primary-apca'] = onColor(primary, paper, ink);
  vars['--on-accent-700-apca'] = onColor(vars['--accent-700'] || accent, paper, ink);

  /* ── Utopia fluid type: steps -2 … 8 ── */
  try {
    calculateTypeScale({
      minWidth: 360, maxWidth: 1440,
      minFontSize: knobs.tbMin, maxFontSize: knobs.tbMax,
      minTypeScale: knobs.trMin, maxTypeScale: knobs.trMax,
      negativeSteps: 2, positiveSteps: 8,
    }).forEach(s => { vars[`--step-${s.step}`.replace('--step--', '--step--')] = s.clamp; });
  } catch (e) { console.error('[designEngine] type scale:', e.message); }

  /* ── Utopia fluid space ── */
  try {
    const sp = calculateSpaceScale({
      minWidth: 360, maxWidth: 1440,
      minSize: knobs.sbMin, maxSize: knobs.sbMax,
      negativeSteps: [0.75, 0.5, 0.25],
      positiveSteps: [1.5, 2, 3, 4, 6, 8],
      customSizes: ['s-2xl', 'm-3xl'],
    });
    for (const g of [sp.sizes, sp.oneUpPairs, sp.customPairs]) {
      (g || []).forEach(s => { vars[`--space-${s.label}`] = s.clamp; });
    }
  } catch (e) { console.error('[designEngine] space scale:', e.message); }

  if (cache.size > 200) cache.clear();
  cache.set(key, vars);
  return vars;
}
