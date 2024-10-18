const express = require('express');
const router = express.Router();
const passport = require('passport'); // Add this line

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'madLadsLab powered by threeJS' });
});
router.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login'
}));

router.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

module.exports = router;
