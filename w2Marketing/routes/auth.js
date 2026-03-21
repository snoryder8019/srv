import express from 'express';
import passport from '../plugins/passport.js';
import { issueAdminJWT } from '../middleware/jwtAuth.js';

const router = express.Router();

router.get('/google', (req, res, next) => {
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
  })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: '/admin/login?error=oauth' }, (err, user) => {
    if (err || !user) return res.redirect('/admin/login?error=oauth');

    if (!user.isW2Admin && !user.isAdmin) {
      return res.redirect('/admin/login?error=unauthorized');
    }

    issueAdminJWT(user, res);
    res.redirect('/admin');
  })(req, res, next);
});

router.get('/logout', (req, res) => {
  res.clearCookie('w2_token');
  res.redirect('/admin/login');
});

export default router;
