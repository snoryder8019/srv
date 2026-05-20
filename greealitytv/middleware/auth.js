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

exports.ensureAiAccess = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash('error', 'Please sign in to continue.');
    return res.redirect('/auth/google');
  }
  if (req.user.isAdmin || req.user.isVerified) return next();
  if (req.xhr || req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: 'AI tools require verified-author or admin access.' });
  }
  res.status(403).render('error', { message: 'AI tools require verified-author or admin access.' });
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
