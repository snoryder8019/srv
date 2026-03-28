import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

const COOKIE_DOMAIN = config.NODE_ENV === 'production' ? '.madladslab.com' : undefined;

// ── Admin JWT ─────────────────────────────────────────────────────────────────

export function requireAdmin(req, res, next) {
  // One-time login token (from signup or magic link)
  const loginToken = req.query.token;
  if (loginToken) {
    try {
      const decoded = jwt.verify(loginToken, config.JWT_SECRET);
      if (decoded.oneTime && decoded.isAdmin) {
        const payload = { ...decoded };
        delete payload.oneTime;
        delete payload.iat;
        delete payload.exp;
        const sessionToken = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
        // Set cookie on THIS domain (works for custom domains since we're responding from their host)
        const opts = {
          httpOnly: true,
          secure: config.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 8 * 60 * 60 * 1000,
        };
        // Only set .madladslab.com domain for subdomain hosts
        if (COOKIE_DOMAIN && req.hostname.endsWith('.madladslab.com')) {
          opts.domain = COOKIE_DOMAIN;
        }
    
        res.cookie('slab_token', sessionToken, opts);
        const cleanUrl = req.originalUrl.split('?')[0];
        return res.redirect(cleanUrl);
      }
    } catch (err) {

    }
  }

  const token = req.cookies?.slab_token;
  if (!token) {

    return res.redirect('/admin/login');
  }
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);

    if (!decoded.isAdmin) {
  
      res.clearCookie('slab_token');
      return res.redirect('/admin/login?error=unauthorized');
    }
    // Tenant isolation — JWT must match this tenant's database
    if (decoded.tenantDb && req.tenant?.db && decoded.tenantDb !== req.tenant.db) {
  
      res.clearCookie('slab_token');
      return res.redirect('/admin/login?error=unauthorized');
    }
    req.adminUser = decoded;
    next();
  } catch (err) {

    res.clearCookie('slab_token');
    res.redirect('/admin/login');
  }
}

/** Generate a one-time login token (for signup redirects and email links) */
export function createLoginToken(user, tenantDb, expiresIn = '5m') {
  return jwt.sign({
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin || false,
    tenantDb: tenantDb || null,
    oneTime: true,
  }, config.JWT_SECRET, { expiresIn });
}

export function issueAdminJWT(user, res, tenantDb, returnDomain) {
  const payload = {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin || false,
    tenantDb: tenantDb || null,
  };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });

  // Custom domains (not *.madladslab.com) need cookie on their own domain
  const isCustomDomain = returnDomain && !returnDomain.endsWith('.madladslab.com') && returnDomain !== 'localhost';
  const cookieDomain = isCustomDomain ? undefined : COOKIE_DOMAIN;

  const opts = {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  };
  if (cookieDomain) opts.domain = cookieDomain;


  res.cookie('slab_token', token, opts);
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
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
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
