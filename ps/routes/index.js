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
import { requireAuth, requireCharacter } from '../middlewares/authGates.js';

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

// Feature routes - protected by character requirement
router.use('/zones', requireCharacter, zonesRouter);
router.use('/universe', requireCharacter, universeRouter);
router.use('/assets', requireCharacter, assetsRouter);
router.use('/profile', requireAuth, profileRouter);

// Characters route requires auth but not active character (needed for creation)
router.use('/characters', requireAuth, charactersRouter);

// Admin routes (keep existing protection)
router.use('/admin', adminRouter);

// Help pages
router.get('/help/asset-json-guide', function(req, res, next) {
  res.render('help/asset-json-guide', {
    title: 'Asset JSON Field Guide',
    user: req.user
  });
});

router.get('/help/developer-letter', function(req, res, next) {
  res.render('help/developer-letter', {
    title: 'Developer Letter - v0.4',
    user: req.user
  });
});

router.get('/help/patch-notes', function(req, res, next) {
  res.render('help/patch-notes', {
    title: 'Patch Notes - v0.4',
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
      characters = await Character.findByUserId(req.user._id);
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
router.get('/menu', requireCharacter, function(req, res, next) {
  res.render('menu-enhanced', {
    title: 'Main Menu',
    user: req.user,
    character: res.locals.character
  });
});

// Welcome page (first-time user onboarding)
router.get('/welcome', requireAuth, function(req, res, next) {
  // If already completed welcome, redirect to next step
  if (req.user.hasCompletedWelcome) {
    if (!req.user.hasCompletedIntro) {
      return res.redirect('/intro');
    }
    return res.redirect('/auth');
  }

  res.render('onboarding/welcome', {
    title: 'Welcome to Stringborn',
    user: req.user
  });
});

// Intro page (tutorial/intro after welcome)
router.get('/intro', requireAuth, function(req, res, next) {
  // Must complete welcome first
  if (!req.user.hasCompletedWelcome) {
    return res.redirect('/welcome');
  }

  // If already completed intro, redirect to character selection
  if (req.user.hasCompletedIntro) {
    return res.redirect('/auth');
  }

  res.render('onboarding/intro', {
    title: 'Introduction to Stringborn',
    user: req.user
  });
});

export default router;
