/**
 * Color contrast utilities for WCAG-compliant brand theming.
 * Computes readable text colors and contrast ratios so tenant
 * palettes never produce invisible text.
 */

/** Parse hex (#RGB or #RRGGBB) → { r, g, b } (0-255) */
export function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Mix two hex colors: mixHex('#000', '#FFF', 0.5) → '#808080' */
export function mixHex(hex1, hex2, weight = 0.5) {
  const a = hexToRgb(hex1), b = hexToRgb(hex2);
  const mix = (c1, c2) => Math.round(c1 * weight + c2 * (1 - weight));
  const r = mix(a.r, b.r), g = mix(a.g, b.g), bl = mix(a.b, b.b);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1).toUpperCase();
}

/** WCAG 2.1 relative luminance (0 = black, 1 = white) */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG contrast ratio between two hex colors (1:1 to 21:1) */
export function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Returns white or dark text hex for readability on the given background */
export function readableTextColor(bgHex, lightText = '#FDFCFA', darkText = '#0F1B30') {
  const lum = relativeLuminance(bgHex);
  // Use light text on dark backgrounds, dark text on light backgrounds
  return lum > 0.179 ? darkText : lightText;
}

/** WCAG AA pass/fail for a pair (4.5:1 normal, 3:1 large text) */
export function wcagAA(fgHex, bgHex) {
  const ratio = contrastRatio(fgHex, bgHex);
  return { ratio: Math.round(ratio * 100) / 100, aa: ratio >= 4.5, aaLarge: ratio >= 3 };
}

/**
 * Enrich a design object with computed contrast variables.
 * Adds _on_* keys that views inject as --on-* CSS vars.
 */
export function enrichDesignContrast(design) {
  const d = { ...design };
  try {
    d._on_primary      = readableTextColor(d.color_primary);
    d._on_primary_deep = readableTextColor(d.color_primary_deep);
    d._on_primary_mid  = readableTextColor(d.color_primary_mid);
    d._on_accent       = readableTextColor(d.color_accent);
    d._on_accent_light = readableTextColor(d.color_accent_light);
    d._on_bg           = readableTextColor(d.color_bg);
    d._on_white        = readableTextColor('#FDFCFA');  // page bg is always near-white
    // Muted secondary text: 55% text color mixed with the background
    d._on_bg_muted     = mixHex(d._on_bg, d.color_bg, 0.6);

    // ── Admin surface contrast ──
    // Card/input surfaces: always high-contrast against the page bg
    const bgLum = relativeLuminance(d.color_bg);
    // If bg is light, cards/inputs are white; if bg is dark, lift slightly
    d._surface         = bgLum > 0.4 ? '#FFFFFF' : mixHex('#FFFFFF', d.color_bg, 0.12);
    d._on_surface      = readableTextColor(d._surface);
    d._on_surface_muted = mixHex(d._on_surface, d._surface, 0.65);
    // Input border: visible against both bg AND surface
    d._border          = bgLum > 0.4
      ? mixHex(d._on_bg, d.color_bg, 0.22)
      : mixHex(d._on_bg, d.color_bg, 0.30);
    // Input border focus: use primary if it contrasts with surface, else use accent
    const primaryOnSurface = contrastRatio(d.color_primary, d._surface);
    d._border_focus    = primaryOnSurface >= 3 ? d.color_primary : d.color_accent;
    // Placeholder text: guaranteed readable but subdued
    d._placeholder     = mixHex(d._on_surface, d._surface, 0.35);
    // Badge text: for tinted-transparent badges on surface bg, use darkened accent
    d._badge_accent    = readableTextColor(d._surface) === '#0F1B30'
      ? mixHex(d.color_accent, '#000000', 0.65)
      : mixHex(d.color_accent, '#FFFFFF', 0.75);

    // Contrast checks for common pairings
    d._contrast = {
      text_on_page:       wcagAA(d.color_primary_deep, '#FDFCFA'),
      text_on_bg:         wcagAA(d._on_bg, d.color_bg),
      muted_on_bg:        wcagAA(d._on_bg_muted, d.color_bg),
      accent_on_bg:       wcagAA(d.color_accent, d.color_bg),
      primary_on_bg:      wcagAA(d.color_primary, d.color_bg),
      text_on_primary:    wcagAA(d._on_primary, d.color_primary),
      text_on_deep:       wcagAA(d._on_primary_deep, d.color_primary_deep),
      accent_on_deep:     wcagAA(d.color_accent_light, d.color_primary_deep),
      text_on_surface:    wcagAA(d._on_surface, d._surface),
      muted_on_surface:   wcagAA(d._on_surface_muted, d._surface),
      border_on_surface:  wcagAA(d._border, d._surface),
    };
  } catch {
    // If any color is malformed, fall back to safe defaults
    d._on_primary = d._on_primary_deep = d._on_primary_mid = '#FDFCFA';
    d._on_accent = d._on_accent_light = d._on_bg = '#0F1B30';
    d._on_bg_muted = '#6B7380';
    d._surface = '#FFFFFF'; d._on_surface = '#0F1B30';
    d._on_surface_muted = '#6B7380'; d._border = '#CBD5E1';
    d._border_focus = '#1C2B4A'; d._placeholder = '#9CA3AF';
    d._badge_accent = '#92722A';
    d._contrast = {};
  }
  return d;
}
