import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

// ── Admin JWT ─────────────────────────────────────────────────────────────────

export function requireAdmin(req, res, next) {
  const token = req.cookies?.w2_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded.isW2Admin && !decoded.isAdmin) {
      res.clearCookie('w2_token');
      return res.redirect('/admin/login?error=unauthorized');
    }
    req.adminUser = decoded;
    next();
  } catch {
    res.clearCookie('w2_token');
    res.redirect('/admin/login');
  }
}

export function issueAdminJWT(user, res) {
  const payload = {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    isW2Admin: user.isW2Admin,
    isAdmin: user.isAdmin,
  };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
  res.cookie('w2_token', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

// ── Portal JWT (clients / collaborators) ──────────────────────────────────────

export function issuePortalJWT(user, res) {
  const payload = {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    role: user.role || 'client',
    clientId: user.clientId || null,
  };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '24h' });
  res.cookie('w2_portal', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
}

export function requirePortal(req, res, next) {
  const token = req.cookies?.w2_portal;
  if (!token) return res.redirect('/onboard?error=login');
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded.role) {
      res.clearCookie('w2_portal');
      return res.redirect('/onboard?error=login');
    }
    req.portalUser = decoded;
    next();
  } catch {
    res.clearCookie('w2_portal');
    res.redirect('/onboard?error=login');
  }
}
