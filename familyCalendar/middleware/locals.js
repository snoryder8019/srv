export function attachLocals(req, res, next) {
  res.locals.user = req.user || null;
  res.locals.isAdmin = !!(req.user && req.user.isAdmin);
  res.locals.brand = { name: 'Family Calendar', shortName: 'familyCal' };
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/auth/google');
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).send('Forbidden');
  next();
}
