const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('start', {
    title: res.locals.lang === 'es' ? 'Empezar' : 'Get Started'
  });
});

module.exports = router;
