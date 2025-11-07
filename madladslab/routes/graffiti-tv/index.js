import express from 'express';
const router = express.Router();

/* GET graffiti-tv page */
router.get('/', function(req, res, next) {
  const user = req.user;
  res.render('graffiti-tv/index', { 
    title: 'Graffiti TV - Underground Broadcast Network', 
    user: user 
  });
});

export default router;