const router = require('express').Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Login page
router.get('/login', (req, res) => {
  res.render('login');
});

// Register page
router.get('/register', (req, res) => {
  res.render('register');
});

// Local login
router.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard',
  failureRedirect: '/auth/login'
}));

// Local register
router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.redirect('/auth/register');

    const user = await User.create({ email, password, displayName });
    req.login(user, (err) => {
      if (err) return res.redirect('/auth/login');
      res.redirect('/dashboard');
    });
  } catch (err) {
    console.error(err);
    res.redirect('/auth/register');
  }
});

// Google auth - initiate
router.get('/google/init', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Google auth - callback (matches GOOGLE_CALLBACK_URL in .env)
router.get('/google', passport.authenticate('google', {
  successRedirect: '/dashboard',
  failureRedirect: '/auth/login'
}));

// Logout
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

// --- Games SSO bridge ---

// Step 1: redirect to games.madladslab.com for auth
router.get('/games', (req, res) => {
  const callback = encodeURIComponent('https://bih.madladslab.com/auth/games/callback');
  res.redirect(`https://games.madladslab.com/auth/bridge?redirect=${callback}`);
});

// Step 2: receive signed JWT from games, create/sync local user
router.get('/games/callback', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/auth/login?error=bridge');
  try {
    const payload = jwt.verify(token, process.env.BRIDGE_SECRET);
    let user = await User.findOne({ email: payload.email });
    if (!user) {
      user = await User.create({
        email: payload.email,
        displayName: payload.displayName,
        isAdmin: payload.isAdmin || false,
        permissions: [],
      });
    } else if (payload.isAdmin && !user.isAdmin) {
      user.isAdmin = true;
      await user.save();
    }
    req.login(user, (err) => {
      if (err) return res.redirect('/auth/login?error=bridge');
      res.redirect('/dashboard');
    });
  } catch (e) {
    console.error('[bih] games bridge error:', e.message);
    res.redirect('/auth/login?error=bridge');
  }
});

module.exports = router;
