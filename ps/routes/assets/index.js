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
