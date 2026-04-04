exports.ensureAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Please sign in to continue.');
  res.redirect('/auth/google');
};

exports.ensureAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.isAdmin) return next();
  res.status(403).render('error', { message: 'Admin access required.' });
};

exports.ensureRole = (...roles) => (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash('error', 'Please sign in to continue.');
    return res.redirect('/auth/google');
  }
  if (req.user.isAdmin) return next();
  if (req.user.roles && roles.some(r => req.user.roles.includes(r))) return next();
  res.status(403).render('error', { message: 'You do not have permission to access this page.' });
};

exports.ensureCan = (perm) => (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash('error', 'Please sign in to continue.');
    return res.redirect('/auth/google');
  }
  if (req.user.isAdmin) return next();
  if (req.user.permissions && req.user.permissions[perm]) return next();
  res.status(403).render('error', { message: 'You do not have permission to perform this action.' });
};
