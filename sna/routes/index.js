import express from 'express';
import plugins from '../plugins/index.js'
import api from '../api/index.js';
import admin from './admin/index.js';
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
  const user = req.user;
  res.render('index', { title: 'Express',user });
});
router.use('/api', api)
router.use('/admin', admin)
router.use('/',plugins)
export default router;
