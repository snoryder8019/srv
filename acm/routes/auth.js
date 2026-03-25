const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/User');

/* GET /login */
router.get('/login', function (req, res) {
  res.render('login', { title: 'Login' });
});

/* POST /login */
router.post('/login', passport.authenticate('local', {
  successRedirect: '/admin/dashboard',
  failureRedirect: '/login'
}));

/* GET /register */
router.get('/register', function (req, res) {
  res.render('register', { title: 'Register' });
});

/* POST /register */
router.post('/register', async function (req, res, next) {
  try {
    const { email, password, firstName, lastName, displayName } = req.body;

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.redirect('/register');
    }

    const user = await User.create({
      email: email,
      password: password,
      firstName: firstName,
      lastName: lastName,
      displayName: displayName || firstName
    });

    req.login(user, function (err) {
      if (err) return next(err);
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

/* GET /auth/google — initiate Google OAuth */
router.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

/* GET /auth/google/callback — Google OAuth callback */
router.get('/auth/google/callback', function (req, res, next) {
  passport.authenticate('google', function (err, user, info) {
    if (err) {
      console.error('Google OAuth error:', err);
      return res.redirect('/login');
    }
    if (!user) {
      console.error('Google OAuth no user:', info);
      return res.redirect('/login');
    }
    req.login(user, function (loginErr) {
      if (loginErr) {
        console.error('Google login error:', loginErr);
        return res.redirect('/login');
      }
      if (user.role === 'admin') return res.redirect('/admin/dashboard');
      return res.redirect('/');
    });
  })(req, res, next);
});

/* GET /logout */
router.get('/logout', function (req, res, next) {
  req.logout(function (err) {
    if (err) return next(err);
    res.redirect('/');
  });
});

module.exports = router;
