// ─────────────────────────────────────────────────────────────────────────────
// billingEnforce.js — read-only enforcement for lapsed subscriptions.
//
// When the subscription sweep (plugins/subscriptionCron.js) flips a tenant to
// meta.billingState === 'lapsed', this middleware makes the admin dashboard
// READ-ONLY: GETs still work (they can look around and reactivate), but any
// write (POST/PUT/PATCH/DELETE) is blocked until they pay.
//
// Deliberately narrow — it NEVER touches the public site, NEVER blocks reads,
// NEVER blocks superadmins, and always leaves an escape hatch so the owner can
// actually reactivate. Mounted inside the /admin router only.
// ─────────────────────────────────────────────────────────────────────────────

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Write paths that must stay open even while lapsed, so the owner isn't trapped:
// logout and dismissing the billing banner. (Reactivation/checkout lives under
// /start, which this middleware doesn't cover at all.)
const ALLOW_WRITE = [
  /^\/logout\b/,
  /^\/notifications\/[^/]+\/dismiss\b/,
];

export function billingEnforce(req, res, next) {
  // Reads always pass; only writes are gated.
  if (!WRITE_METHODS.has(req.method)) return next();

  // Superadmins are never restricted.
  if (req.isSuperAdmin) return next();

  const state = req.tenant?.meta?.billingState;
  if (state !== 'lapsed') return next();

  if (ALLOW_WRITE.some((re) => re.test(req.path))) return next();

  // Blocked. JSON for fetch/XHR callers; a redirect for plain form posts.
  const wantsJson = req.xhr
    || (req.get('accept') || '').includes('application/json')
    || (req.get('content-type') || '').includes('application/json');

  if (wantsJson) {
    return res.status(402).json({
      error: 'Your subscription has lapsed — the dashboard is read-only until you reactivate.',
      billingLapsed: true,
      reactivateUrl: '/admin?billing=lapsed',
    });
  }
  return res.redirect('/admin?billing=lapsed');
}
