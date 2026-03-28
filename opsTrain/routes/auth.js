const express = require('express');
const passport = require('passport');
const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Login', error: req.query.error || null });
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
