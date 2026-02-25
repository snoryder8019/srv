const express = require('express');
const passport = require('passport');
const router = express.Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/', failureFlash: true }),
  (req, res) => {
    req.flash('success', `Welcome, ${req.user.displayName}!`);
    res.redirect('/feed');
  }
);

router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.flash('success', 'You have been signed out.');
    res.redirect('/');
  });
});

module.exports = router;
