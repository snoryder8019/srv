 import express from 'express';
const router = express.Router();
import admin from "./admin/index.js"
/* GET home page. */

router.use('/admin', admin)

router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

export default router
