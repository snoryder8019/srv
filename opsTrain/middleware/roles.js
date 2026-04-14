// Role hierarchy: superadmin > admin > manager > user
// superadmin  — platform owner
// admin       — customer / brand owner (signs up, pays)
// manager     — assigned by admin to oversee shifts
// user        — shift workers, no auth — verified by geolocation + QR scan + PIN

const { decodeSlabToken, isSuperAdminEmail } = require('./jwtAuth');

const ROLE_LEVELS = {
  superadmin: 4,
  admin: 3,
  manager: 2,
  user: 1,
};

/**
 * Resolve the current user from JWT (preferred) or Passport session (fallback).
 * Sets req.adminUser and req.user consistently.
 */
function resolveUser(req) {
  // JWT path — slab_token cookie
  const payload = decodeSlabToken(req);
  if (payload) {
    payload.isSuperAdmin = isSuperAdminEmail(payload.email);
    if (payload.isSuperAdmin) payload.role = 'superadmin';
    req.adminUser = payload;
    req.isSuperAdmin = payload.isSuperAdmin;
    // Shim req.user so legacy route code (req.user.role, req.user.brand) keeps working
    req.user = req.user || payload;
    if (payload.isSuperAdmin) req.user.role = 'superadmin';
    return payload;
  }
  // Passport session fallback
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    const u = req.user;
    u.isSuperAdmin = isSuperAdminEmail(u.email) || u.role === 'superadmin';
    req.adminUser = u;
    req.isSuperAdmin = u.isSuperAdmin;
    return u;
  }
  return null;
}

// Require authentication (JWT or Passport)
function requireAuth(req, res, next) {
  const user = resolveUser(req);
  if (user) {
    res.locals.isSuperAdmin = req.isSuperAdmin;
    res.locals.adminUser = req.adminUser;
    return next();
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
}

// Require minimum role
function requireRole(minRole) {
  return (req, res, next) => {
    const user = resolveUser(req);
    if (!user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth/login');
    }
    res.locals.isSuperAdmin = req.isSuperAdmin;
    res.locals.adminUser = req.adminUser;
    const userLevel = ROLE_LEVELS[user.role] || 0;
    const requiredLevel = ROLE_LEVELS[minRole] || 0;
    if (userLevel < requiredLevel) {
      return res.status(403).render('errors/error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
      });
    }
    next();
  };
}

// Require admin+ AND matching brand (superadmin bypasses)
function requireBrandAccess(req, res, next) {
  const user = resolveUser(req);
  if (!user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  res.locals.isSuperAdmin = req.isSuperAdmin;
  res.locals.adminUser = req.adminUser;
  const userLevel = ROLE_LEVELS[user.role] || 0;
  if (userLevel >= ROLE_LEVELS.superadmin) return next();
  if (userLevel >= ROLE_LEVELS.manager) {
    const brandId = req.params.brandId || req.body.brandId || req.query.brandId;
    if (brandId && user.brand && user.brand.toString() === brandId.toString()) return next();
    if (!brandId && user.brand) return next();
  }
  return res.status(403).render('errors/error', {
    title: 'Access Denied',
    message: 'You do not have access to this brand.',
  });
}

// Require manager+ role
function requireManager(req, res, next) {
  const user = resolveUser(req);
  if (!user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  res.locals.isSuperAdmin = req.isSuperAdmin;
  res.locals.adminUser = req.adminUser;
  const userLevel = ROLE_LEVELS[user.role] || 0;
  if (userLevel < ROLE_LEVELS.manager) {
    return res.status(403).render('errors/error', {
      title: 'Access Denied',
      message: 'Manager access required.',
    });
  }
  next();
}

// Shift user middleware — checks session.shiftUser
function requireShiftUser(req, res, next) {
  if (req.session && req.session.shiftUser) return next();
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect('/shift/checkin');
}

module.exports = {
  ROLE_LEVELS,
  requireAuth,
  requireRole,
  requireBrandAccess,
  requireShiftUser,
  requireManager,
  resolveUser,
};
