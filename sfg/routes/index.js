 import express from 'express';
const router = express.Router();
import plugins from '../plugins/index.js'
import recipes from './recipes/index.js'
import forms from './forms/index.js'
import signups from "./signups/index.js"
import admin from "./admin/index.js"
/* GET home page. */

router.use('/signups', signups)
router.use('/admin', admin)
router.use('/recipes', recipes)
router.use('/', plugins)
router.use('/forms', forms)

router.get('/', function(req, res, next) {
  const user = req.user;
  console.log(req.session.user)
  res.render('index', { title: 'Express', user:user });
});

export default router
