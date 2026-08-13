// ─────────────────────────────────────────────────────────────────────────────
// Slab — locale middleware
//
// Runs right after resolveTenant (so tenant.public.language is available) and
// sets, on every request:
//   res.locals.locale        active locale code ('en' | 'es')
//   res.locals.htmlLang      value for <html lang="…"> (== locale)
//   res.locals.t             request-bound translator, t('nav.home', vars)
//   res.locals.locales       SUPPORTED_LOCALES (for the switcher UI)
//   res.locals.multilangOn   tenant opted into showing the language switcher
//
// A visitor's explicit choice (?lang= or the switcher) is persisted in the
// slab_lang cookie so it survives navigation. The tenant's default language is
// the fallback when the visitor hasn't chosen.
// ─────────────────────────────────────────────────────────────────────────────
import {
  resolveLocale, makeT, SUPPORTED_LOCALES, DEFAULT_LOCALE, isSupportedLocale,
} from '../plugins/i18n.js';

// Two independent locale contexts so a Spanish-speaking owner can run the admin
// in Spanish while serving an English public site (or vice-versa). Each context
// keeps its OWN persistence cookie so a visitor's choice on the storefront never
// bleeds into the dashboard, and the admin's choice never changes the storefront.
const PUBLIC_COOKIE = 'slab_lang';
const ADMIN_COOKIE = 'slab_admin_lang';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function localeMiddleware(req, res, next) {
  const p = req.path || '';
  const isAdminCtx = p.startsWith('/admin') || p.startsWith('/superadmin');
  const cookieName = isAdminCtx ? ADMIN_COOKIE : PUBLIC_COOKIE;

  // Admin uses adminLanguage, falling back to the public default when unset —
  // so tenants who never touch the admin setting behave exactly as before.
  const tenantDefault = isAdminCtx
    ? (req.tenant?.public?.adminLanguage || req.tenant?.public?.language)
    : req.tenant?.public?.language;

  const { locale, source } = resolveLocale({
    query: req.query?.lang,
    cookieLocale: req.cookies?.[cookieName],
    tenantDefault,
    acceptLanguage: req.headers['accept-language'],
  });

  // Persist an explicit ?lang= choice so it sticks across pages — to the cookie
  // for THIS context only. Not httpOnly: a non-sensitive UI preference.
  if (source === 'query' && isSupportedLocale(req.query?.lang)) {
    res.cookie(cookieName, locale, {
      maxAge: ONE_YEAR_MS, sameSite: 'lax', path: '/', httpOnly: false,
    });
  }

  // Switcher links swap ?lang= on the current URL — expose it (minus any
  // existing lang param) so the partial can build clean hrefs.
  res.locals.localeBaseUrl = stripLangParam(req.originalUrl || req.url || '/');
  res.locals.locale = locale;
  res.locals.htmlLang = locale;
  res.locals.t = makeT(locale);
  res.locals.locales = SUPPORTED_LOCALES;
  res.locals.defaultLocale = DEFAULT_LOCALE;
  // Switcher is opt-in per tenant so English-only sites stay unchanged.
  res.locals.multilangOn = String(req.tenant?.public?.multilang ?? 'false') === 'true';

  next();
}

/** Remove a `lang` query param from a URL, preserving the rest of the query. */
function stripLangParam(url) {
  const hashIdx = url.indexOf('#');
  const hash = hashIdx === -1 ? '' : url.slice(hashIdx);
  const noHash = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const [pathPart, queryPart] = noHash.split('?');
  if (!queryPart) return pathPart + hash;
  const kept = queryPart.split('&').filter(p => p && !/^lang=/i.test(p));
  return pathPart + (kept.length ? '?' + kept.join('&') : '') + hash;
}
