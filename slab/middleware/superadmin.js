import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

const SUPERADMIN_EMAILS = ['snoryder8019@gmail.com'];

export function requireSuperAdmin(req, res, next) {
  const token = req.cookies?.slab_super;
  if (!token) return res.redirect('/superadmin/login');
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded.isSuperAdmin) {
      res.clearCookie('slab_super');
      return res.redirect('/superadmin/login?error=unauthorized');
    }
    req.superAdmin = decoded;
    next();
  } catch {
    res.clearCookie('slab_super');
    res.redirect('/superadmin/login');
  }
}

export function issueSuperAdminJWT(user, res) {
  const payload = {
    id: user._id?.toString() || user.id,
    email: user.email,
    displayName: user.displayName,
    isSuperAdmin: true,
  };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '12h' });
  res.cookie('slab_super', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function isSuperAdminEmail(email) {
  return SUPERADMIN_EMAILS.includes(email?.toLowerCase());
}
