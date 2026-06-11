// mllAuth — madladslab single-sign-on for Left Field.
//
// Flow: user clicks "Sign in with MadLadsLab" -> slab.madladslab.com/auth/pitch
// runs Google OAuth -> slab mints a 5-min one-time JWT and redirects to
// pitch.madladslab.com/auth/sso?token=...  -> we verify it with the SHARED
// JWT_SECRET, upsert the user, and set our own long-lived `mll_session` cookie.
//
// The one-time token and our session cookie are both HS256-signed with the same
// JWT_SECRET slab uses, so no network call back to slab is needed to verify.
import jwt from 'jsonwebtoken';
import { upsertUserFromSSO, getUser } from '../lib/store.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const SESSION_TTL = parseInt(process.env.MLL_SESSION_TTL || '2592000', 10); // 30d
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_DOMAIN = IS_PROD ? '.madladslab.com' : undefined;
export const SLAB_AUTH_URL = process.env.SLAB_AUTH_URL || 'https://slab.madladslab.com/auth/pitch';

const COOKIE = 'mll_session';

export function isAuthConfigured() {
  return JWT_SECRET && JWT_SECRET !== 'dev_secret_change_me';
}

/** Verify the one-time token slab issued. Returns the profile or throws. */
export function consumeSsoToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (!decoded.pitch) throw new Error('not a pitch SSO token');
  return {
    email: decoded.email,
    displayName: decoded.displayName || decoded.name,
    googleId: decoded.googleId || null,
    isSuperadmin: !!decoded.isSuperadmin,
  };
}

/** Persist the user and drop our session cookie. Returns the user record. */
export function establishSession(res, profile) {
  const user = upsertUserFromSSO(profile);
  const token = jwt.sign(
    { id: user.id, email: user.email, displayName: user.displayName, isSuperadmin: !!user.isSuperadmin },
    JWT_SECRET,
    { expiresIn: SESSION_TTL }
  );
  const opts = {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: SESSION_TTL * 1000,
  };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  res.cookie(COOKIE, token, opts);
  return user;
}

export function clearSession(res) {
  const opts = { httpOnly: true, secure: IS_PROD, sameSite: 'lax' };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  res.clearCookie(COOKIE, opts);
}

/**
 * Populate req.mllUser / res.locals.mllUser from the session cookie when present.
 * Never blocks the request — pages decide whether auth is required.
 */
export function attachUser(req, res, next) {
  res.locals.mllUser = null;
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      // Re-read the live record so settings/superadmin changes take effect.
      const fresh = getUser(decoded.id);
      const user = fresh || decoded;
      req.mllUser = user;
      res.locals.mllUser = user;
    } catch {
      clearSession(res);
    }
  }
  next();
}

/** Gate a route on a signed-in madladslab user. */
export function requireUser(req, res, next) {
  if (req.mllUser) return next();
  const returnTo = encodeURIComponent(req.originalUrl);
  return res.redirect(`/auth/login?returnTo=${returnTo}`);
}
