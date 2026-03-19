import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

export function requireAdmin(req, res, next) {
  const token = req.cookies?.cw_token;
  if (!token) return res.redirect('/admin/login');

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.adminUser = decoded;
    next();
  } catch {
    res.clearCookie('cw_token');
    res.redirect('/admin/login');
  }
}

export function issueAdminJWT(user, res) {
  const payload = {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    isCandaceAdmin: user.isCandaceAdmin,
  };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
  res.cookie('cw_token', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
}
