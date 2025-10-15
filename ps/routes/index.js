import express from 'express';
const router = express.Router();
import plugins from '../plugins/index.js';
import charactersRouter from './characters/index.js';
import zonesRouter from './zones/index.js';
import universeRouter from './universe/index.js';
import adminRouter from './admin/index.js';

// Plugin routes (auth, health checks, etc.)
router.use('/', plugins);

// Feature routes
router.use('/characters', charactersRouter);
router.use('/zones', zonesRouter);
router.use('/universe', universeRouter);
router.use('/admin', adminRouter);

// Home page
router.get('/', function(req, res, next) {
  const user = req.user;
  res.render('index', {
    title: 'Stringborn Universe',
    user: user
  });
});

// Auth page
router.get('/auth', function(req, res, next) {
  res.render('auth/index', { title: 'Authentication' });
});

export default router;
