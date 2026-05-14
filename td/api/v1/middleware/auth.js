/**
 * Auth middleware - role-gated access for API routes.
 *
 * Usage:
 *   router.post('/towers', requireAuth, handler);
 *   router.delete('/towers/:id', requireRole('moderator'), handler);
 */

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!req.user.hasRole(role)) {
      return res.status(403).json({ success: false, error: `Requires ${role} role` });
    }
    next();
  };
}

/**
 * Soft-attach user info to res.locals for view templates.
 * Always passes through, even if not logged in.
 */
export function attachUserToLocals(req, res, next) {
  res.locals.currentUser = req.user || null;
  next();
}
