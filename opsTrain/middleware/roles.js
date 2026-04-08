// Role hierarchy: superadmin > admin > manager > user
// superadmin  — platform owner (you)
// admin       — customer / brand owner (signs up, pays)
// manager     — assigned by admin to oversee shifts
// user        — shift workers, no auth — verified by geolocation + QR scan + PIN
const ROLE_LEVELS = {
  superadmin: 4,
  admin: 3,
  manager: 2,
  user: 1
};

// Require authentication
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.session && req.session.shiftUser) return next();
  return res.redirect('/auth/login');
}

// Require minimum role (Google-authed users)
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.redirect('/auth/login');
    }
    const userLevel = ROLE_LEVELS[req.user.role] || 0;
    const requiredLevel = ROLE_LEVELS[minRole] || 0;
    if (userLevel < requiredLevel) {
      return res.status(403).render('errors/error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.'
      });
    }
    next();
  };
}

// Require admin+ AND matching brand (managers see their own brand too)
function requireBrandAccess(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }
  const userLevel = ROLE_LEVELS[req.user.role] || 0;
  // superadmin can access any brand
  if (userLevel >= ROLE_LEVELS.superadmin) return next();
  // admin or manager must match brand
  if (userLevel >= ROLE_LEVELS.manager) {
    const brandId = req.params.brandId || req.body.brandId || req.query.brandId;
    if (brandId && req.user.brand && req.user.brand.toString() === brandId.toString()) {
      return next();
    }
    // If no brandId in request, allow access to their own brand context
    if (!brandId && req.user.brand) return next();
  }
  return res.status(403).render('errors/error', {
    title: 'Access Denied',
    message: 'You do not have access to this brand.'
  });
}

// Require manager+ role (admin dashboard sections managers can see)
function requireManager(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }
  const userLevel = ROLE_LEVELS[req.user.role] || 0;
  if (userLevel < ROLE_LEVELS.manager) {
    return res.status(403).render('errors/error', {
      title: 'Access Denied',
      message: 'Manager access required.'
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
  requireManager
};
