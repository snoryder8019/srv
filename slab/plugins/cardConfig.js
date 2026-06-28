// ─────────────────────────────────────────────────────────────────────────────
// Digital business-card design options — layout templates + color schemes.
// Stored on the business-card qr_links doc as `card: { template, scheme }`.
// Consumed by the /card/:slug route + views/card.ejs (and the QR admin editor).
// ─────────────────────────────────────────────────────────────────────────────

// Layout / design templates. The card view applies `data-tpl="<key>"` and skins
// the shared markup per template.
export const CARD_TEMPLATES = {
  classic: { label: 'Classic',  blurb: 'Header band, round logo, centered' },
  modern:  { label: 'Modern',   blurb: 'Gradient header, rounded, bold' },
  minimal: { label: 'Minimal',  blurb: 'Clean white, understated' },
  cover:   { label: 'Cover',    blurb: 'Full cover top, overlapping avatar' },
  dark:    { label: 'Dark',     blurb: 'Dark surface, glowing accent' },
  mono:    { label: 'Mono',     blurb: 'Monochrome, typographic' },
};
export const DEFAULT_CARD_TEMPLATE = 'classic';

// Color schemes. `brand` is resolved from the tenant's design palette at render
// time; the rest are fixed presets.
export const CARD_SCHEMES = {
  brand:    { label: 'Brand colors' },
  midnight: { label: 'Midnight', primary: '#1e293b', primaryDeep: '#0f172a', accent: '#38bdf8', accentLight: '#7dd3fc', bg: '#eef2f7', white: '#ffffff', dark: '#0f172a' },
  gold:     { label: 'Black & Gold', primary: '#1a1a1a', primaryDeep: '#000000', accent: '#d4af37', accentLight: '#f0d98c', bg: '#f7f5f0', white: '#ffffff', dark: '#1a1a1a' },
  forest:   { label: 'Forest', primary: '#1b4332', primaryDeep: '#081c15', accent: '#74c69d', accentLight: '#d8f3dc', bg: '#eef4f0', white: '#ffffff', dark: '#1b4332' },
  ocean:    { label: 'Ocean', primary: '#0c4a6e', primaryDeep: '#082f49', accent: '#06b6d4', accentLight: '#a5f3fc', bg: '#eff9fd', white: '#ffffff', dark: '#082f49' },
  sunset:   { label: 'Sunset', primary: '#9d174d', primaryDeep: '#831843', accent: '#fb923c', accentLight: '#fed7aa', bg: '#fff7ed', white: '#ffffff', dark: '#431407' },
  plum:     { label: 'Plum', primary: '#4c1d95', primaryDeep: '#2e1065', accent: '#c084fc', accentLight: '#e9d5ff', bg: '#f5f1fb', white: '#ffffff', dark: '#2e1065' },
  mono:     { label: 'Mono', primary: '#262626', primaryDeep: '#000000', accent: '#737373', accentLight: '#d4d4d4', bg: '#fafafa', white: '#ffffff', dark: '#171717' },
};
export const DEFAULT_CARD_SCHEME = 'brand';

// Resolve a scheme key into a concrete color set. `brand` (or anything missing
// its palette) falls back to the tenant design tokens.
export function resolveScheme(schemeKey, design = {}) {
  const s = CARD_SCHEMES[schemeKey];
  if (!s || !s.primary) {
    return {
      primary: design.color_primary || '#1C2B4A',
      primaryDeep: design.color_primary_deep || '#0F1B30',
      accent: design.color_accent || '#C9A848',
      accentLight: design.color_accent_light || '#E8D08A',
      bg: design.color_bg || '#F5F3EF',
      white: design.color_white || '#FDFCFA',
      dark: design.color_dark || '#0F1B30',
    };
  }
  return { primary: s.primary, primaryDeep: s.primaryDeep, accent: s.accent, accentLight: s.accentLight, bg: s.bg, white: s.white, dark: s.dark };
}

export function normalizeCard(card = {}) {
  return {
    template: CARD_TEMPLATES[card.template] ? card.template : DEFAULT_CARD_TEMPLATE,
    scheme: CARD_SCHEMES[card.scheme] ? card.scheme : DEFAULT_CARD_SCHEME,
  };
}
