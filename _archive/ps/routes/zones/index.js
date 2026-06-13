import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';

const router = express.Router();

// Planetary exploration game (must come before /:zoneName to avoid being caught)
router.get('/explore/planetary', async (req, res) => {
  const planetId = req.query.asset;

  // Get planet data if planetId provided
  let planet = null;
  if (planetId) {
    try {
      const db = getDb();
      const { ObjectId } = await import('mongodb');
      planet = await db.collection('assets').findOne({
        _id: new ObjectId(planetId)
      });
    } catch (err) {
      console.error('Error fetching planet:', err);
    }
  }

  res.render('zones/index', {
    title: planet ? `Exploring ${planet.title}` : 'Planetary Exploration',
    user: req.user,
    planet: planet,
    planetId: planetId
  });
});

// Get all zones
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const zones = await db.collection('zones').find({}).toArray();

    res.render('zones/list', {
      title: 'Planetary Zones',
      zones,
      user: req.user
    });
  } catch (err) {
    console.error('Error fetching zones:', err);
    res.status(500).json({ error: 'Failed to fetch zones' });
  }
});

// 3D spatial zone viewer (specific routes before generic ones)
router.get('/:zoneName/spatial', (req, res) => {
  res.render('zones/spatial', {
    title: 'Spatial Zone - ' + req.params.zoneName,
    zoneName: req.params.zoneName,
    user: req.user
  });
});

// Get zone detail (generic param route comes last)
// Redirects to planetary explorer with zone context
router.get('/:zoneName', async (req, res) => {
  try {
    const db = getDb();
    const zone = await db.collection('zones')
      .findOne({ zoneName: req.params.zoneName });

    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    // Redirect to planetary explorer with zone parameter
    res.redirect(`/zones/explore/planetary?zone=${req.params.zoneName}`);
  } catch (err) {
    console.error('Error fetching zone:', err);
    res.status(500).json({ error: 'Failed to fetch zone' });
  }
});

export default router;
