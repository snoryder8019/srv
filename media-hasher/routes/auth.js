import express from 'express';
import bcrypt from 'bcryptjs';
import passport from '../plugins/passport.js';
import { getDb } from '../plugins/mongo.js';
import { config } from '../config/config.js';

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('auth/login', {
    user: req.user || null,
    next: req.query.next || '/account',
    googleEnabled: !!(config.GGLCID && config.GGLSEC),
    error: req.query.error || null,
  });
});

router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect('/auth/login?error=invalid');
    req.logIn(user, (e) => {
      if (e) return next(e);
      res.redirect(req.body.next || '/account');
    });
  })(req, res, next);
});

router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password) return res.redirect('/auth/login?error=missing');
    const users = getDb().collection('users');
    const existing = await users.findOne({ email });
    if (existing) return res.redirect('/auth/login?error=exists');
    const hash = await bcrypt.hash(password, 10);
    const result = await users.insertOne({
      email,
      password: hash,
      displayName: displayName || email.split('@')[0],
      provider: 'local',
      isAdmin: false,
      createdAt: new Date(),
    });
    const user = await users.findOne({ _id: result.insertedId });
    req.logIn(user, (e) => {
      if (e) return next(e);
      res.redirect(req.body.next || '/account');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/google', (req, res, next) => {
  if (!(config.GGLCID && config.GGLSEC)) return res.redirect('/auth/login?error=google_disabled');
  if (req.query.next) req.session.authNext = req.query.next;
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/auth/login?error=google_failed' }),
  (req, res) => {
    const next = req.session.authNext || '/account';
    delete req.session.authNext;
    res.redirect(next);
  }
);

router.post('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

export default router;
