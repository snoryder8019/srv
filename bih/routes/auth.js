const router = require('express').Router();
const passport = require('passport');
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

module.exports = router;
