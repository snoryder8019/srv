const router = require('express').Router();

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/login');
}

router.get('/', (req, res) => {
  res.render('home');
});

router.get('/dashboard', ensureAuth, (req, res) => {
  res.render('dashboard');
});

module.exports = router;
