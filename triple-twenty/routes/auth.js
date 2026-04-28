const router = require('express').Router();
const passport = require('passport');

// Google OAuth login — remember where the user was trying to go
router.get('/google', (req, res, next) => {
  // Store the return URL so we can redirect there after login
  const returnTo = req.query.returnTo || req.get('Referer') || '/dashboard';
  // Only allow same-origin return URLs
  const safeReturn = returnTo.startsWith('/') ? returnTo : '/dashboard';
  req.session.returnTo = safeReturn;
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // Redirect to where they were going, defaulting to dashboard
    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    req.session.save(() => res.redirect(returnTo));
  }
);

// Logout
router.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

module.exports = router;
