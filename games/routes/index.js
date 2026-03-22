const express = require('express');
const passport = require('passport');
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
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile('login.html', { root: __dirname + '/../public' });
});

// Login POST
router.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login?error=1',
}));

// Google OAuth
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=1' }),
  (req, res) => res.redirect('/')
);

// Logout
router.post('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

module.exports = router;
