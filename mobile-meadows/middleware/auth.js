// Ensure user is authenticated
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/google');
}

// Ensure user is admin
function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  res.status(403).render('pages/public/error', {
    title: 'Access Denied',
    message: 'You do not have permission to access this page.'
  });
}

module.exports = { ensureAuth, ensureAdmin };
