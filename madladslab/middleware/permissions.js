// permissions.js
// Usage: requireModule('finances', 'write')
// Levels: read < write < admin
// Superuser (isAdmin) bypasses everything.
// req.userLevel is set so routes/views can branch on it.

const LEVELS = { read: 1, write: 2, admin: 3 };

export function requireModule(moduleName, minLevel = 'read') {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/auth');
    }

    // Superuser bypasses all module checks
    if (req.user.isAdmin === true) {
      req.userLevel = 'admin';
      return next();
    }

    const granted = req.user.permissions?.get
      ? req.user.permissions.get(moduleName)       // Mongoose Map
      : req.user.permissions?.[moduleName];         // plain object fallback

    if (!granted) {
      return res.status(403).render('errors/errors.ejs', {
        message: 'Access denied',
        error: { status: 403, stack: '' }
      });
    }

    if ((LEVELS[granted] || 0) < (LEVELS[minLevel] || 1)) {
      return res.status(403).render('errors/errors.ejs', {
        message: `This action requires "${minLevel}" access to ${moduleName}`,
        error: { status: 403, stack: '' }
      });
    }

    req.userLevel = granted;
    next();
  };
}

// Convenience — just checks login, no module required
export function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/auth');
  next();
}
