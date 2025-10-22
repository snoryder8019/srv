import express from 'express';
const router = express.Router();
import plugins from '../plugins/index.js';
import charactersRouter from './characters/index.js';
import zonesRouter from './zones/index.js';
import universeRouter from './universe/index.js';
import adminRouter from './admin/index.js';
import assetsRouter from './assets/index.js';
import profileRouter from './profile.js';
import { Character } from '../api/v1/models/Character.js';

// Plugin routes (auth, health checks, etc.)
router.use('/', plugins);

// API routes need to be registered here for profile analytics
router.get('/api/v1/profile/analytics', async function(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const { UserAnalytics } = await import('../api/v1/models/UserAnalytics.js');
    const analytics = await UserAnalytics.getUserAnalytics(req.user._id);

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Feature routes
router.use('/characters', charactersRouter);
router.use('/zones', zonesRouter);
router.use('/universe', universeRouter);
router.use('/admin', adminRouter);
router.use('/assets', assetsRouter);
router.use('/profile', profileRouter);

// Help pages
router.get('/help/asset-json-guide', function(req, res, next) {
  res.render('help/asset-json-guide', {
    title: 'Asset JSON Field Guide',
    user: req.user
  });
});

// Home page
router.get('/', function(req, res, next) {
  res.render('index-sales', {
    title: 'Stringborn Universe',
    user: req.user,
    character: res.locals.character
  });
});

// Auth page
router.get('/auth', async function(req, res, next) {
  try {
    let characters = [];

    // If user is logged in, fetch their characters
    if (req.user) {
      characters = await Character.find({ owner: req.user._id })
        .select('name level class race stats equipped')
        .lean();
    }

    res.render('auth/index-enhanced', {
      title: 'Authentication',
      user: req.user,
      characters: characters
    });
  } catch (error) {
    console.error('Error fetching characters:', error);
    res.render('auth/index-enhanced', {
      title: 'Authentication',
      user: req.user,
      characters: []
    });
  }
});

// Auth test page
router.get('/auth-test', function(req, res, next) {
  res.render('auth-test', {
    title: 'Auth Test',
    user: req.user,
    sessionID: req.sessionID
  });
});

// Logout route
router.post('/auth/logout', function(req, res, next) {
  req.logout(function(err) {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('activeCharacterId');
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Menu page
router.get('/menu', function(req, res, next) {
  res.render('menu-enhanced', {
    title: 'Main Menu',
    user: req.user,
    character: res.locals.character
  });
});

export default router;
