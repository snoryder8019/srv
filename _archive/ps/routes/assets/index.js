/**
 * Asset Routes
 * View routes for asset builder and voting
 */
import express from 'express';
import { isAuthenticated } from '../../utilities/helpers.js';
import { getDb } from '../../plugins/mongo/mongo.js';

const router = express.Router();

/**
 * GET /assets
 * Asset builder page (authenticated users only)
 */
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const db = getDb();

    // Fetch all galaxies (both published and unpublished for linking)
    const galaxies = await db.collection('assets')
      .find({ assetType: 'galaxy' })
      .sort({ title: 1 })
      .toArray();

    // Fetch all stars (both published and unpublished for linking)
    const stars = await db.collection('assets')
      .find({ assetType: 'star' })
      .sort({ title: 1 })
      .toArray();

    res.render('assets/builder-enhanced', {
      title: 'Asset Builder',
      user: req.user,
      galaxies: galaxies || [],
      stars: stars || []
    });
  } catch (error) {
    console.error('Error loading asset builder:', error);
    res.render('assets/builder-enhanced', {
      title: 'Asset Builder',
      user: req.user,
      galaxies: [],
      stars: []
    });
  }
});

/**
 * GET /assets/builder
 * Basic asset/sprite builder page (authenticated users only)
 * Note: Currently redirects to builder-enhanced as builder.ejs doesn't exist
 */
router.get('/builder', isAuthenticated, (req, res) => {
  // Redirect to builder-enhanced for now
  res.redirect('/assets/builder-enhanced' + (req.originalUrl.includes('?') ? req.originalUrl.substring(req.originalUrl.indexOf('?')) : ''));
});

/**
 * GET /assets/builder-enhanced
 * Enhanced asset builder page (authenticated users only)
 */
router.get('/builder-enhanced', isAuthenticated, async (req, res) => {
  try {
    const db = getDb();

    // Fetch all galaxies (both published and unpublished for linking)
    const galaxies = await db.collection('assets')
      .find({ assetType: 'galaxy' })
      .sort({ title: 1 })
      .toArray();

    // Fetch all stars (both published and unpublished for linking)
    const stars = await db.collection('assets')
      .find({ assetType: 'star' })
      .sort({ title: 1 })
      .toArray();

    res.render('assets/builder-enhanced', {
      title: 'Asset Builder',
      user: req.user,
      galaxies: galaxies || [],
      stars: stars || []
    });
  } catch (error) {
    console.error('Error loading asset builder:', error);
    res.render('assets/builder-enhanced', {
      title: 'Asset Builder',
      user: req.user,
      galaxies: [],
      stars: []
    });
  }
});

/**
 * GET /assets/my-assets
 * User's asset management page
 */
router.get('/my-assets', isAuthenticated, (req, res) => {
  res.render('assets/my-assets', {
    title: 'My Assets',
    user: req.user,
    character: res.locals.character
  });
});

/**
 * GET /assets/voting
 * Community voting page (rebuilt for proper authentication)
 */
router.get('/voting', (req, res) => {
  console.log('Voting route - user:', req.user ? req.user.username : 'not logged in');

  res.render('assets/vote', {
    title: 'Community Voting',
    user: req.user,
    character: res.locals.character
  });
});

/**
 * GET /assets/builder-hub
 * Universal builder hub - central navigation for all asset builders
 */
router.get('/builder-hub', isAuthenticated, async (req, res) => {
  try {
    const db = getDb();

    // Fetch all assets with hierarchy info for tree view
    const assets = await db.collection('assets')
      .find({})
      .sort({ 'hierarchy.depth': 1, title: 1 })
      .toArray();

    // Get asset counts by type
    const assetCounts = await db.collection('assets')
      .aggregate([
        { $group: { _id: '$assetType', count: { $sum: 1 } } }
      ])
      .toArray();

    res.render('assets/builder-hub', {
      title: 'Universal Builder Hub',
      user: req.user,
      assets: assets || [],
      assetCounts: assetCounts || []
    });
  } catch (error) {
    console.error('Error loading builder hub:', error);
    res.render('assets/builder-hub', {
      title: 'Universal Builder Hub',
      user: req.user,
      assets: [],
      assetCounts: []
    });
  }
});

/**
 * GET /assets/interior-map-builder
 * Interior map builder for creating zone floormaps
 * Note: Template is in views/universe/ folder
 */
router.get('/interior-map-builder', isAuthenticated, (req, res) => {
  res.render('universe/interior-map-builder', {
    title: 'Interior Map Builder',
    user: req.user
  });
});

/**
 * GET /assets/sprite-creator
 * Sprite creator tool for importing/creating sprite assets
 */
router.get('/sprite-creator', isAuthenticated, async (req, res) => {
  try {
    const db = getDb();

    // Fetch zones for assignment (planets, orbitals, environments, zones)
    const zones = await db.collection('assets')
      .find({
        assetType: { $in: ['planet', 'orbital', 'environment', 'zone'] }
      })
      .sort({ title: 1 })
      .toArray();

    // Fetch existing sprite sheets for reference
    const spriteSheets = await db.collection('assets')
      .find({
        $or: [
          { assetType: 'sprite_sheet' },
          { 'spriteData.spriteSheet': { $exists: true } }
        ]
      })
      .sort({ title: 1 })
      .toArray();

    res.render('assets/sprite-creator', {
      title: 'Sprite Creator',
      user: req.user,
      zones: zones || [],
      spriteSheets: spriteSheets || []
    });
  } catch (error) {
    console.error('Error loading sprite creator:', error);
    res.render('assets/sprite-creator', {
      title: 'Sprite Creator',
      user: req.user,
      zones: [],
      spriteSheets: []
    });
  }
});

export default router;

// Test endpoint to check authentication
router.get('/auth-test', (req, res) => {
  res.json({
    authenticated: req.isAuthenticated ? req.isAuthenticated() : false,
    user: req.user || null,
    sessionID: req.sessionID || null,
    cookies: req.cookies || {}
  });
});
