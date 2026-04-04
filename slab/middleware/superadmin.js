import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

const SUPERADMIN_EMAILS = ['snoryder8019@gmail.com', 'scott@madladslab.com'];

export function isSuperAdminEmail(email) {
  return SUPERADMIN_EMAILS.includes(email?.toLowerCase());
}

/**
 * Hard guard for /superadmin/* routes.
 * Checks the admin JWT (slab_token) — superadmin is derived from email, not a separate cookie.
 */
export function requireSuperAdmin(req, res, next) {
  const token = req.cookies?.slab_token;
  if (!token) return res.redirect('/superadmin/login');
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!isSuperAdminEmail(decoded.email)) {
      return res.redirect('/superadmin/login?error=unauthorized');
    }
    req.superAdmin = decoded;
    req.isSuperAdmin = true;
    res.locals.isSuperAdmin = true;
    next();
  } catch {
    res.redirect('/superadmin/login');
  }
}

/**
 * Lightweight check for admin routes — sets req.isSuperAdmin + res.locals.isSuperAdmin.
 * Reads from the same slab_token JWT, checks email against the hardcoded list.
 */
export function checkSuperAdmin(req, res, next) {
  req.isSuperAdmin = false;
  res.locals.isSuperAdmin = false;
  const decoded = req.adminUser;
  if (decoded && isSuperAdminEmail(decoded.email)) {
    req.isSuperAdmin = true;
    req.superAdmin = decoded;
    res.locals.isSuperAdmin = true;
  }
  next();
}

/**
 * Hard guard for /admin/super/* routes — requires admin JWT + superadmin email.
 */
export function requireSuperInAdmin(req, res, next) {
  if (!req.isSuperAdmin) return res.status(403).send('Superadmin access required');
  next();
}
