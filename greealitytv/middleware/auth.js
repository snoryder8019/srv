exports.ensureAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Please sign in to continue.');
  res.redirect('/auth/google');
};

exports.ensureAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.isAdmin) return next();
  res.status(403).render('error', { message: 'Admin access required.' });
};
