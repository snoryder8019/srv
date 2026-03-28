// Superadmin — platform-level access
// Hardcoded email list (same pattern as slab)
const SUPERADMIN_EMAILS = [
  'snoryder8019@gmail.com'
];

function requireSuperadmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }
  if (req.user.role !== 'superadmin' && !SUPERADMIN_EMAILS.includes(req.user.email)) {
    return res.status(403).render('errors/error', {
      title: '403',
      message: 'Platform admin access only.'
    });
  }
  next();
}

module.exports = { requireSuperadmin, SUPERADMIN_EMAILS };
