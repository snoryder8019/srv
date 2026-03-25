/**
 * Authentication & authorization middleware
 */

/** Redirect to /login if user is not authenticated */
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

/** Return 403 if authenticated user is not an admin */
function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  res.status(403).send('Forbidden');
}

/**
 * Return middleware that checks whether the authenticated user
 * has the given permission string in their permissions array.
 */
function ensurePermission(permission) {
  return function (req, res, next) {
    if (
      req.isAuthenticated() &&
      Array.isArray(req.user.permissions) &&
      req.user.permissions.includes(permission)
    ) {
      return next();
    }
    res.status(403).send('Forbidden');
  };
}

module.exports = { ensureAuth, ensureAdmin, ensurePermission };
