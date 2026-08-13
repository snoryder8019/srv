// ─────────────────────────────────────────────────────────────────────────────
// Slab — per-locale copy resolver
//
// The `copy` collection stores tenant marketing text as { key, value } docs in a
// single (English) language. Bilingual support is ADDITIVE and backward-compatible:
// a Spanish value for `hero_heading` is stored as a sibling doc keyed
// `hero_heading__es`. The base key stays English; only non-default locales get a
// suffixed sibling.
//
// At render time we overlay: for the active locale, each base key resolves to its
// `__<locale>` sibling when that sibling has a non-empty value, else it falls back
// to the base (English) value. Because we localize the `copy` OBJECT before it
// reaches the view, every existing `c.hero_heading` reference gets the localized
// string with ZERO view changes.
//
// For the default locale (English) the base values are returned unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_LOCALE, isSupportedLocale } from './i18n.js';

export const LOCALE_SEP = '__';

/** Build the suffixed key for a locale, e.g. localeKey('hero_heading','es') → 'hero_heading__es'. */
export function localeKey(baseKey, locale) {
  return `${baseKey}${LOCALE_SEP}${locale}`;
}

/** True if a key carries a supported locale suffix (e.g. 'hero_heading__es'). */
export function isLocaleKey(key) {
  const i = key.lastIndexOf(LOCALE_SEP);
  if (i === -1) return false;
  return isSupportedLocale(key.slice(i + LOCALE_SEP.length));
}

/** The base key of a possibly-suffixed key ('hero_heading__es' → 'hero_heading'). */
export function baseKeyOf(key) {
  if (!isLocaleKey(key)) return key;
  return key.slice(0, key.lastIndexOf(LOCALE_SEP));
}

/** The locale of a suffixed key, or null ('hero_heading__es' → 'es'). */
export function localeOf(key) {
  if (!isLocaleKey(key)) return null;
  return key.slice(key.lastIndexOf(LOCALE_SEP) + LOCALE_SEP.length);
}

/**
 * Overlay a flat { key: value } copy map for `locale`.
 * Returns a NEW object containing only BASE keys, each resolved to its localized
 * value (non-empty `__<locale>` sibling) or the base value. Suffixed keys are
 * dropped from the output so views never see them.
 * For the default/English locale (or an unsupported code) the base map minus any
 * suffixed keys is returned unchanged.
 */
export function localizeCopyMap(map, locale) {
  const out = {};
  const overlay = locale && locale !== DEFAULT_LOCALE && isSupportedLocale(locale);
  for (const [key, value] of Object.entries(map || {})) {
    if (isLocaleKey(key)) continue;          // suffixed siblings handled below
    if (overlay) {
      const loc = map[localeKey(key, locale)];
      out[key] = (loc !== undefined && loc !== null && String(loc).trim() !== '') ? loc : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Convenience for the common load pattern: given the raw copy docs
 * ([{ key, value }, …]) straight from the collection, return a localized copy
 * object ready to hand to a view. Replaces:
 *   const copy = {}; for (const c of rawCopy) copy[c.key] = c.value;
 * with:
 *   const copy = buildLocalizedCopy(rawCopy, res.locals.locale);
 */
export function buildLocalizedCopy(rawCopy, locale) {
  const map = {};
  for (const c of (rawCopy || [])) {
    if (c && c.key != null) map[c.key] = c.value;
  }
  return localizeCopyMap(map, locale);
}
