const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Version endpoint — reads fresh from disk so cron bumps are reflected without restart
router.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    res.json({ version: pkg.version });
  } catch (e) {
    res.json({ version: 'unknown' });
  }
});

// Patch notes endpoint — returns recent version history with TLDR summaries
router.get('/api/patch-notes', (req, res) => {
  try {
    const notesFile = path.join(__dirname, '..', 'patch-notes.json');
    if (!fs.existsSync(notesFile)) return res.json({ notes: [] });
    const notes = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    res.json({ notes: notes.slice(-limit).reverse() });
  } catch (e) {
    res.json({ notes: [] });
  }
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// Validate redirect targets — only allow relative paths or trusted domains
const TRUSTED_ORIGINS = [
  'https://games.madladslab.com',
  'https://madladslab.com',
  'https://bih.madladslab.com',
  'https://www.madladslab.com',
];

function isSafeRedirect(url) {
  // Allow relative paths starting with /
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  // Allow trusted origins
  try {
    const parsed = new URL(url);
    return TRUSTED_ORIGINS.includes(parsed.origin);
  } catch (e) {
    return false;
  }
}

// Public landing page — live broadcasts (no auth)
router.get('/', (req, res) => {
  res.sendFile('landing.html', { root: __dirname + '/../public' });
});

// Authenticated dashboard — server management
router.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile('index.html', { root: __dirname + '/../public' });
});

// Login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    const next = req.session.loginNext;
    if (next) { delete req.session.loginNext; return res.redirect(next); }
    return res.redirect('/dashboard');
  }
  if (req.query.next && isSafeRedirect(req.query.next)) req.session.loginNext = req.query.next;
  res.sendFile('login.html', { root: __dirname + '/../public' });
});

// Login POST
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect('/login?error=1');
    req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      const dest = req.session.loginNext || '/dashboard';
      delete req.session.loginNext;
      res.redirect(dest);
    });
  })(req, res, next);
});

// Google OAuth
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));
router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=1' }),
  (req, res) => {
    const dest = req.session.loginNext || '/dashboard';
    delete req.session.loginNext;
    req.session.save(() => res.redirect(dest));
  }
);

// Logout — destroy session + clear cookie so Google account picker works on next login
router.post('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.redirect('/');
    });
  });
});

// Auth bridge — issues a short-lived JWT for cross-site SSO (bih uses this)
router.get('/auth/bridge', (req, res) => {
  const redirect = req.query.redirect;
  if (!redirect) return res.status(400).send('redirect param required');
  if (!isSafeRedirect(redirect)) return res.status(400).send('Invalid redirect target');
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
