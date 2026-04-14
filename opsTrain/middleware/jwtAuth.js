/**
 * jwtAuth.js — opsTrain
 * Reads slab_token JWT (issued by slab, signed with SLAB_JWT_SECRET).
 * Superadmin is derived from email — no separate role needed in the token.
 */

const jwt = require('jsonwebtoken');

const SLAB_JWT_SECRET = process.env.SLAB_JWT_SECRET;
const SUPERADMIN_EMAILS = ['snoryder8019@gmail.com', 'scott@madladslab.com'];

function isSuperAdminEmail(email) {
  return SUPERADMIN_EMAILS.includes((email || '').toLowerCase());
}

/**
 * Decode slab_token from cookie. Returns payload or null.
 */
function decodeSlabToken(req) {
  const token = req.cookies?.slab_token;
  if (!token || !SLAB_JWT_SECRET) return null;
  try {
    return jwt.verify(token, SLAB_JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * requireJWT — hard gate. Must have valid slab_token.
 * Sets req.adminUser. Superadmin flag set from email list.
 */
function requireJWT(req, res, next) {
  const payload = decodeSlabToken(req);
  if (!payload) return res.redirect('/auth/login');
  payload.isSuperAdmin = isSuperAdminEmail(payload.email);
  req.adminUser = payload;
  req.isSuperAdmin = payload.isSuperAdmin;
  res.locals.isSuperAdmin = payload.isSuperAdmin;
  res.locals.adminUser = payload;
  next();
}

/**
 * requireSuperAdminJWT — must be superadmin email.
 */
function requireSuperAdminJWT(req, res, next) {
  const payload = decodeSlabToken(req);
  if (!payload) return res.redirect('/auth/login');
  if (!isSuperAdminEmail(payload.email)) {
    return res.status(403).render('errors/error', {
      title: '403',
      message: 'Superadmin access required.',
    });
  }
  payload.isSuperAdmin = true;
  req.adminUser = payload;
  req.isSuperAdmin = true;
  res.locals.isSuperAdmin = true;
  res.locals.adminUser = payload;
  next();
}

/**
 * checkJWT — soft check. Sets req.adminUser if token valid, continues either way.
 */
function checkJWT(req, res, next) {
  const payload = decodeSlabToken(req);
  if (payload) {
    payload.isSuperAdmin = isSuperAdminEmail(payload.email);
    req.adminUser = payload;
    req.isSuperAdmin = payload.isSuperAdmin;
    res.locals.isSuperAdmin = payload.isSuperAdmin;
    res.locals.adminUser = payload;
  }
  next();
}

/**
 * SSO token receiver — called by slab after Google OAuth.
 * Verifies a short-lived token (games-style), sets slab_token cookie on this domain.
 */
function handleSSOCallback(req, res) {
  const { token } = req.query;
  if (!token) return res.redirect('/auth/login?error=1');
  try {
    const payload = jwt.verify(token, SLAB_JWT_SECRET);
    if (!payload.sso) throw new Error('Not an SSO token');

    // Issue a full-duration slab_token on this domain
    const sessionToken = jwt.sign(
      {
        id: payload.id || payload.email,
        email: payload.email,
        displayName: payload.displayName || payload.email,
        isAdmin: payload.isAdmin || isSuperAdminEmail(payload.email),
      },
      SLAB_JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.cookie('slab_token', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      domain: '.madladslab.com',
      maxAge: 8 * 60 * 60 * 1000,
    });

    const dest = req.session?.loginNext || '/admin';
    delete req.session?.loginNext;
    res.redirect(dest);
  } catch (e) {
    console.error('[jwtAuth] SSO error:', e.message);
    res.redirect('/auth/login?error=1');
  }
}

module.exports = {
  requireJWT,
  requireSuperAdminJWT,
  checkJWT,
  handleSSOCallback,
  isSuperAdminEmail,
  decodeSlabToken,
};
