 import express from 'express';
const router = express.Router();
import plugins from '../plugins/index.js'
import recipes from './recipes/index.js'
import admin from "./admin/index.js"
import qrs from "./qrs/index.js"
import contest from "./contest/index.js"
import euker from "./euker/index.js"
import grafitti from "./grafitti/index.js"
/* GET home page. */

router.use('/admin', admin)
router.use('/recipes', recipes)
router.use('/qrs', qrs)
router.use('/contest', contest)
router.use('/euker', euker)
router.use('/grafitti', grafitti)
router.use('/', plugins)

router.get('/', function(req, res, next) {
  const user = req.user;
  console.log(req.session.user)
  res.render('index', { title: 'Express', user:user });
});
router.get('/auth', function(req, res, next) {
  res.render('auth/index', { title: 'Auth' });
});
export default router
