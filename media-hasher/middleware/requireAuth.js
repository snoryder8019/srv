export function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.accepts('html')) return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  return res.status(401).json({ error: 'auth_required' });
}
