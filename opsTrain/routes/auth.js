const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Login', error: req.query.error || null });
});

// Local email/password login
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      return res.render('auth/login', {
        title: 'Login',
        error: info?.message || 'Invalid credentials',
      });
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
      const returnTo = req.session.returnTo || '/admin';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  })(req, res, next);
});

// Register page
router.get('/register', (req, res) => {
  res.render('auth/register', { title: 'Register', error: null });
});

// Register POST
router.post('/register', async (req, res) => {
  try {
    const { email, password, passwordConfirm, displayName } = req.body;
    if (!email || !password) {
      return res.render('auth/register', { title: 'Register', error: 'Email and password are required.' });
    }
    if (password.length < 8) {
      return res.render('auth/register', { title: 'Register', error: 'Password must be at least 8 characters.' });
    }
    if (password !== passwordConfirm) {
      return res.render('auth/register', { title: 'Register', error: 'Passwords do not match.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });

    if (existing) {
      if (existing.password) {
        return res.render('auth/register', { title: 'Register', error: 'An account with this email already exists. Sign in instead.' });
      }
      // Existing user (from Google) — link password
      existing.password = await bcrypt.hash(password, 12);
      if (!existing.provider || existing.provider === 'google') existing.provider = 'google+local';
      await existing.save();

      req.logIn(existing, (err) => {
        if (err) return res.render('auth/register', { title: 'Register', error: 'Login failed after registration.' });
        res.redirect('/admin');
      });
      return;
    }

    // New user — user role until an admin promotes them
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: cleanEmail,
      displayName: (displayName || '').trim() || cleanEmail.split('@')[0],
      password: hashed,
      provider: 'local',
      role: 'user',
    });

    return res.render('auth/login', {
      title: 'Login',
      error: null,
      success: 'Account created. An administrator must grant you access before you can sign in.',
    });
  } catch (err) {
    console.error('[auth] register error:', err);
    res.render('auth/register', { title: 'Register', error: 'Something went wrong. Please try again.' });
  }
});

// Google OAuth
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/login?error=auth_failed' }),
  (req, res) => {
    const returnTo = req.session.returnTo || '/admin';
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);

// POS Pin login (for shift workers scanning QR)
router.post('/pin', (req, res, next) => {
  passport.authenticate('pos-pin', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ success: false, message: info?.message || 'Invalid PIN' });
    }
    // Store shift user in session (no full passport login needed)
    req.session.shiftUser = {
      _id: user._id,
      displayName: user.displayName,
      posPin: user.posPin,
      brand: user.brand,
      role: user.role
    };
    return res.json({ success: true, redirect: `/shift/tasks?brandId=${user.brand}` });
  })(req, res, next);
});

// Not me — clear shift session, go back to PIN prompt
router.get('/not-me', (req, res) => {
  delete req.session.shiftUser;
  const back = req.query.back || '/';
  res.redirect(back);
});

// Logout
router.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

module.exports = router;
