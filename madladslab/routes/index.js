 import express from 'express';
const router = express.Router();
import plugins from '../plugins/index.js'

import admin from "./admin/index.js"
/* GET home page. */

router.use('/admin', admin)
router.use('/', plugins)

router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

export default router
