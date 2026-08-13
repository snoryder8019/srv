// ─────────────────────────────────────────────────────────────────────────────
// Slab — i18n engine (lightweight, SSR-safe, zero-dependency)
//
// Why not i18next? In a multi-tenant SSR app the footgun is locale bleed across
// concurrent requests when a single shared instance's language is mutated
// per-request. This engine sidesteps that entirely: dictionaries are immutable
// after boot and every request gets its own bound `t` (see makeT). No global
// mutable "current language" exists.
//
// Storage: locales/<code>.json — nested objects, looked up by dot-path
// (e.g. t('nav.home')). Missing keys fall back to English, then to the key
// itself, so a partially-translated dictionary never throws or renders blank.
//
// Interpolation: {{name}} placeholders, filled from the vars object.
//   t('greeting.hi', { name: 'Ana' })  →  "Hola, Ana"
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// Ordered: first is the source/fallback language. Keep in sync with the switcher.
export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English', short: 'EN', flag: '🇺🇸' },
  { code: 'es', label: 'Español', short: 'ES', flag: '🇲🇽' },
];
export const DEFAULT_LOCALE = 'en';
const SUPPORTED_CODES = SUPPORTED_LOCALES.map(l => l.code);

/** code → nested dictionary object. Loaded once at boot, immutable thereafter. */
let DICTS = {};

function loadDicts() {
  const next = {};
  for (const { code } of SUPPORTED_LOCALES) {
    const file = path.join(LOCALES_DIR, `${code}.json`);
    try {
      next[code] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      // A missing/broken dictionary must never take the site down — fall back to
      // an empty dict so lookups resolve to English (or the key) instead.
      if (err.code !== 'ENOENT') console.error(`[i18n] failed to load ${code}.json:`, err.message);
      next[code] = {};
    }
  }
  DICTS = next;
}
loadDicts();

/** Dev/reload hook — re-read the JSON files without a process restart. */
export function reloadLocales() { loadDicts(); }

export function isSupportedLocale(code) {
  return SUPPORTED_CODES.includes(code);
}

/** Resolve a dot-path ('a.b.c') against a nested object; undefined if absent. */
function dig(obj, dotPath) {
  if (!obj) return undefined;
  let cur = obj;
  for (const seg of dotPath.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(str, vars) {
  if (!vars || str.indexOf('{{') === -1) return str;
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
    (vars[k] === undefined || vars[k] === null) ? m : String(vars[k]));
}

/**
 * Build a request-bound translator for `locale`.
 * Lookup order: requested locale → English → the key itself (so a missing
 * string renders its own key, which is greppable rather than blank).
 */
export function makeT(locale) {
  const code = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  return function t(key, vars) {
    if (!key) return '';
    const hit = dig(DICTS[code], key) ?? dig(DICTS[DEFAULT_LOCALE], key) ?? key;
    return interpolate(hit, vars);
  };
}

/**
 * Decide the active locale for a request.
 * Priority (highest first):
 *   1. explicit ?lang= override (validated) — the switcher uses this
 *   2. slab_lang cookie (a prior explicit choice, persisted)
 *   3. tenant default (tenant.public.language, set by the site owner)
 *   4. Accept-Language header, best supported match
 *   5. DEFAULT_LOCALE
 * Returns { locale, source, explicit } — `explicit` true when 1 or 2 chose it,
 * so the middleware knows whether to (re)write the persistence cookie.
 */
export function resolveLocale({ query, cookieLocale, tenantDefault, acceptLanguage } = {}) {
  const q = query && String(query).toLowerCase();
  if (isSupportedLocale(q)) return { locale: q, source: 'query', explicit: true };

  const c = cookieLocale && String(cookieLocale).toLowerCase();
  if (isSupportedLocale(c)) return { locale: c, source: 'cookie', explicit: true };

  const td = tenantDefault && String(tenantDefault).toLowerCase();
  if (isSupportedLocale(td)) return { locale: td, source: 'tenant', explicit: false };

  const fromHeader = pickFromAcceptLanguage(acceptLanguage);
  if (fromHeader) return { locale: fromHeader, source: 'header', explicit: false };

  return { locale: DEFAULT_LOCALE, source: 'default', explicit: false };
}

/** Parse an Accept-Language header and return the best supported primary tag. */
function pickFromAcceptLanguage(header) {
  if (!header) return null;
  const ranked = String(header)
    .split(',')
    .map(part => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find(p => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.split('=')[1]) : 1;
      return { primary: (tag || '').trim().toLowerCase().split('-')[0], q: isNaN(q) ? 0 : q };
    })
    .filter(x => x.primary)
    .sort((a, b) => b.q - a.q);
  for (const { primary } of ranked) {
    if (isSupportedLocale(primary)) return primary;
  }
  return null;
}
