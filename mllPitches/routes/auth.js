import express from 'express';
import passport, { isOAuthConfigured } from '../plugins/auth.js';

const router = express.Router();

router.get('/google', (req, res, next) => {
  if (!isOAuthConfigured()) {
    return res.status(503).render('error', {
      title: 'OAuth not configured',
      message: 'Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in /srv/mllPitches/.env first.',
    });
  }
  return passport.authenticate('google', { scope: ['email', 'profile'] })(req, res, next);
});

router.get(
  '/google/callback',
  (req, res, next) => {
    if (!isOAuthConfigured()) return res.redirect('/auth/google');
    next();
  },
  passport.authenticate('google', { failureRedirect: '/auth/failed' }),
  (req, res) => res.redirect('/admin')
);

router.get('/failed', (req, res) => {
  res.status(403).render('error', {
    title: 'Not authorized',
    message: 'Only the admin Google account can access /admin.',
  });
});

router.post('/logout', (req, res, next) => req.logout((err) => (err ? next(err) : res.redirect('/'))));
router.get('/logout', (req, res, next) => req.logout((err) => (err ? next(err) : res.redirect('/'))));

export default router;
