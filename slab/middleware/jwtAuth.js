import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

// ── Admin JWT ─────────────────────────────────────────────────────────────────

export function requireAdmin(req, res, next) {
  // One-time login token (from signup or magic link)
  const loginToken = req.query.token;
  if (loginToken) {
    try {
      const decoded = jwt.verify(loginToken, config.JWT_SECRET);
      if (decoded.oneTime && (decoded.isAdmin || decoded.isW2Admin)) {
        // Issue real session cookie and redirect to clean URL
        const payload = { ...decoded };
        delete payload.oneTime;
        delete payload.iat;
        delete payload.exp;
        const sessionToken = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
        res.cookie('slab_token', sessionToken, {
          httpOnly: true,
          secure: config.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 8 * 60 * 60 * 1000,
        });
        // Strip token from URL and redirect
        const cleanUrl = req.originalUrl.split('?')[0];
        return res.redirect(cleanUrl);
      }
    } catch {}
  }

  const token = req.cookies?.slab_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded.isW2Admin && !decoded.isAdmin) {
      res.clearCookie('slab_token');
      return res.redirect('/admin/login?error=unauthorized');
    }
    req.adminUser = decoded;
    next();
  } catch {
    res.clearCookie('slab_token');
    res.redirect('/admin/login');
  }
}

/** Generate a one-time login token (for signup redirects and email links) */
export function createLoginToken(user, expiresIn = '5m') {
  return jwt.sign({
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    isW2Admin: user.isW2Admin || false,
    isAdmin: user.isAdmin || false,
    oneTime: true,
  }, config.JWT_SECRET, { expiresIn });
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
  res.cookie('slab_token', token, {
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
  res.cookie('slab_portal', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
}

export function requirePortal(req, res, next) {
  const token = req.cookies?.slab_portal;
  if (!token) return res.redirect('/onboard?error=login');
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded.role) {
      res.clearCookie('slab_portal');
      return res.redirect('/onboard?error=login');
    }
    req.portalUser = decoded;
    next();
  } catch {
    res.clearCookie('slab_portal');
    res.redirect('/onboard?error=login');
  }
}
