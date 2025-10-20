 import express from 'express';
const router = express.Router();
import plugins from '../plugins/index.js'
import admin from "./admin/index.js"
import qrs from "./qrs/index.js"
import q from "./q/index.js"
import bikelite from "./bikelite/index.js"
import contest from "./contest/index.js"
import euker from "./euker/index.js"
import grafitti from "./grafitti/index.js"
import trader from "./trader/index.js"
import lbb from "./lbb/index.js"
import claudeTalk from "./claudeTalk/index.js"
import payments from "./payments/index.js"
import gpc from "./gpc/index.js"
import backOffice from "./backOffice/index.js"
/* GET home page. */

router.use('/admin', admin)
router.use('/qrs', qrs)
router.use('/q', q) // Short URL redirects for QR codes
router.use('/bikelite', bikelite)
router.use('/contest', contest)
router.use('/euker', euker)
router.use('/grafitti', grafitti)
router.use('/trader', trader)
router.use('/lbb', lbb)
router.use('/gpc', gpc)
router.use('/backOffice', backOffice)
router.use('/claudeTalk', claudeTalk)
router.use('/payments', payments)
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
