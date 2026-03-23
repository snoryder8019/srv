const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// Dashboard
router.get('/', requireAuth, (req, res) => {
  res.sendFile('index.html', { root: __dirname + '/../public' });
});

// Login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    const next = req.session.loginNext;
    if (next) { delete req.session.loginNext; return res.redirect(next); }
    return res.redirect('/');
  }
  if (req.query.next) req.session.loginNext = req.query.next;
  res.sendFile('login.html', { root: __dirname + '/../public' });
});

// Login POST
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect('/login?error=1');
    req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      const dest = req.session.loginNext || '/';
      delete req.session.loginNext;
      res.redirect(dest);
    });
  })(req, res, next);
});

// Google OAuth
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=1' }),
  (req, res) => {
    const dest = req.session.loginNext || '/';
    delete req.session.loginNext;
    res.redirect(dest);
  }
);

// Logout
router.post('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// Auth bridge — issues a short-lived JWT for cross-site SSO (bih uses this)
router.get('/auth/bridge', (req, res) => {
  const redirect = req.query.redirect;
  if (!redirect) return res.status(400).send('redirect param required');
  if (!req.isAuthenticated()) {
    return res.redirect(`/login?next=${encodeURIComponent(`/auth/bridge?redirect=${redirect}`)}`);
  }
  const u = req.user;
  const token = jwt.sign(
    {
      id: u._id,
      email: u.email,
      displayName: u.displayName || u.firstName || u.email,
      isAdmin: u.isAdmin || false,
      permissions: u.permissions || {},
    },
    process.env.BRIDGE_SECRET,
    { expiresIn: '5m' }
  );
  res.redirect(`${redirect}?token=${encodeURIComponent(token)}`);
});

module.exports = router;
