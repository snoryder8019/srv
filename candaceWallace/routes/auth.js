import express from 'express';
import passport from '../plugins/passport.js';
import { issueAdminJWT } from '../middleware/jwtAuth.js';

const router = express.Router();

// Initiate Google OAuth
router.get('/google', (req, res, next) => {
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
  })(req, res, next);
});

// Google OAuth callback
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: '/admin/login?error=oauth' }, (err, user) => {
    if (err || !user) return res.redirect('/admin/login?error=oauth');

    // Check candace admin permission
    if (!user.isCandaceAdmin) {
      return res.redirect('/admin/login?error=unauthorized');
    }

    // Issue JWT and redirect to admin
    issueAdminJWT(user, res);
    res.redirect('/admin');
  })(req, res, next);
});

// Logout
router.get('/logout', (req, res) => {
  res.clearCookie('cw_token');
  res.redirect('/admin/login');
});

export default router;
