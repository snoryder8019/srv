import express from 'express';
import passport from '../plugins/passport.js';
import { GOOGLE_SCOPES } from '../plugins/passport.js';

const router = express.Router();

function googleConfigured(req, res, next) {
  if (!process.env.GGLCID || !process.env.GGLSEC) {
    return res.status(503).send('Google OAuth not configured. Set GGLCID and GGLSEC in .env, then restart.');
  }
  next();
}

router.get('/google', googleConfigured, (req, res, next) =>
  passport.authenticate('google', {
    scope: GOOGLE_SCOPES,
    accessType: 'offline',
    prompt: 'consent',
  })(req, res, next)
);

router.get('/google/callback', googleConfigured, (req, res, next) =>
  passport.authenticate('google', { failureRedirect: '/?err=auth' })(req, res, next),
  (req, res) => res.redirect('/calendar')
);

router.post('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/');
  });
});

export default router;
