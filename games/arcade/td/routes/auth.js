/**
 * Auth routes - Google OAuth flow + session management.
 *
 * Mounted at /auth (NOT under /api/v1) because OAuth callbacks are
 * full-page redirects, not API calls.
 *
 *   GET  /auth/google           -> redirect to Google
 *   GET  /auth/google/callback  -> Google posts back here
 *   GET  /auth/me               -> JSON profile of current user (or null)
 *   POST /auth/logout           -> destroy session
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import passport from '../services/auth/passport.js';
import { isOAuthEnabled } from '../services/auth/passport.js';
import config from '../config/index.js';
import User from '../api/v1/models/User.js';

const router = express.Router();

router.get('/google', (req, res, next) => {
  if (!isOAuthEnabled()) return res.status(503).send('OAuth not configured');
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback',
  (req, res, next) => {
    if (!isOAuthEnabled()) return res.status(503).send('OAuth not configured');
    passport.authenticate('google', {
      failureRedirect: '/?auth=failed',
      failureMessage: true,
    })(req, res, next);
  },
  (req, res) => {
    res.redirect('/?auth=ok');
  }
);

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = req.user;
  res.json({
    user: {
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      avatarUrl: u.avatarUrl,
      roles: u.roles,
      stats: u.stats || {},
    },
  });
});

router.post('/logout', (req, res) => {
  req.logout(() => {
    req.session?.destroy(() => {
      res.json({ success: true });
    });
  });
});

// ---- Platform SSO (games.madladslab.com is the identity provider) ----
// Kickoff: bounce to the platform bridge, which 302s back to our callback
// with a 5-min JWT. See games WEBGAMES_PROTOCOL.md.
router.get('/platform', (req, res) => {
  // Remember where to land after SSO (e.g. a /play?siege=<token> launch). Only
  // same-origin paths are honored, so this can't be used as an open redirect.
  const next = typeof req.query.next === 'string' ? req.query.next : '';
  if (req.session && next.startsWith('/') && !next.startsWith('//')) req.session.afterLogin = next;
  const cb = config.publicUrl + '/auth/platform/callback';
  res.redirect(config.platform.url + '/auth/bridge?redirect=' + encodeURIComponent(cb));
});

router.get('/platform/callback', async (req, res) => {
  const token = req.query.token;
  if (!token || !config.platform.bridgeSecret) return res.redirect('/?auth=failed');
  let payload;
  try {
    payload = jwt.verify(token, config.platform.bridgeSecret);
  } catch (e) {
    console.warn('[platform-sso] token verify failed:', e.message);
    return res.redirect('/?auth=failed');
  }
  try {
    const slug = config.platform.slug;
    const perms = payload.permissions || {};
    const isAdmin = payload.isAdmin === true || perms.games === 'admin' || perms[slug] === 'admin';

    // Match by platformId, else link an existing local profile by email.
    let user = await User.findOne({ platformId: String(payload.id) });
    if (!user && payload.email) user = await User.findOne({ email: payload.email });

    if (!user) {
      user = await User.create({
        platformId: String(payload.id),
        platformEmail: payload.email,
        email: payload.email,
        displayName: payload.displayName || (payload.email || 'Player').split('@')[0],
        isPlatformAdmin: isAdmin,
        permissions: perms,
        roles: isAdmin ? ['user', 'admin'] : ['user'],
        lastLoginAt: new Date(),
        loginCount: 1,
      });
    } else {
      user.platformId = String(payload.id);
      user.platformEmail = payload.email;
      user.isPlatformAdmin = isAdmin;
      user.permissions = perms;
      if (isAdmin && !user.roles.includes('admin')) user.roles.push('admin');
      if (!user.displayName) user.displayName = payload.displayName || 'Player';
      user.lastLoginAt = new Date();
      user.loginCount = (user.loginCount || 0) + 1;
      await user.save();
    }

    req.login(user, (err) => {
      if (err) { console.error('[platform-sso] login error:', err.message); return res.redirect('/?auth=failed'); }
      // Resume an intended destination (e.g. a siege launch); else the equip
      // lobby (loadout/cache) — not straight into a match.
      const next = req.session && req.session.afterLogin;
      if (req.session) req.session.afterLogin = null;
      res.redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/lobby');
    });
  } catch (e) {
    console.error('[platform-sso] callback error:', e.message);
    res.redirect('/?auth=failed');
  }
});

export default router;
