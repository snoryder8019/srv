const router = require('express').Router();
const passport = require('passport');

// @route  GET /auth/google
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// @route  GET /auth/google/callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // Admin goes to dashboard, user goes home
    if (req.user.role === 'admin') {
      return res.redirect('/admin');
    }
    res.redirect('/');
  }
);

// @route  GET /auth/logout
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

module.exports = router;
