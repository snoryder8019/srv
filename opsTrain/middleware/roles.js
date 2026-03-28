// Role hierarchy: superadmin > admin > brandAdmin > user > visitor
const ROLE_LEVELS = {
  superadmin: 5,
  admin: 4,
  brandAdmin: 3,
  user: 2,
  visitor: 1
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

// Require brandAdmin+ AND matching brand
function requireBrandAccess(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }
  const userLevel = ROLE_LEVELS[req.user.role] || 0;
  // superadmin and admin can access any brand
  if (userLevel >= ROLE_LEVELS.admin) return next();
  // brandAdmin must match brand
  if (userLevel >= ROLE_LEVELS.brandAdmin) {
    const brandId = req.params.brandId || req.body.brandId || req.query.brandId;
    if (brandId && req.user.brand && req.user.brand.toString() === brandId.toString()) {
      return next();
    }
  }
  return res.status(403).render('errors/error', {
    title: 'Access Denied',
    message: 'You do not have access to this brand.'
  });
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
  requireShiftUser
};
