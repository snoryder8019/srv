const { decodeSlabToken, isSuperAdminEmail } = require('./jwtAuth');

const SUPERADMIN_EMAILS = ['snoryder8019@gmail.com', 'scott@madladslab.com'];

function requireSuperadmin(req, res, next) {
  // JWT path (preferred)
  const payload = decodeSlabToken(req);
  if (payload && isSuperAdminEmail(payload.email)) {
    req.adminUser = payload;
    req.isSuperAdmin = true;
    res.locals.isSuperAdmin = true;
    return next();
  }
  // Passport session fallback
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    if (req.user.role === 'superadmin' || SUPERADMIN_EMAILS.includes(req.user.email)) {
      req.isSuperAdmin = true;
      res.locals.isSuperAdmin = true;
      return next();
    }
  }
  return res.redirect('/auth/login');
}

module.exports = { requireSuperadmin, SUPERADMIN_EMAILS };
