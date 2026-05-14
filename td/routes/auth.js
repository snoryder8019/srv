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
import passport from '../services/auth/passport.js';
import { isOAuthEnabled } from '../services/auth/passport.js';

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

export default router;
