import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';
import galacticStateRouter from './galacticState.js';

const router = express.Router();

// Mount galactic state sub-routes
router.use('/', galacticStateRouter);

// Get galactic state view (streaming version)
router.get('/galactic-state', async (req, res) => {
  res.render('universe/galacticState-stream', {
    title: 'Galactic State - Live',
    user: req.user
  });
});

// Get galactic map view (2D visualization)
router.get('/galactic-map', async (req, res) => {
  res.render('universe/galactic-map', {
    title: 'Galactic Territory Map',
    user: req.user
  });
});

// Get species information (legacy route - redirect to tome)
router.get('/species', async (req, res) => {
  res.redirect('/universe/tome');
});

// The Tome - Story, Characters, Monsters, Connections
router.get('/tome', async (req, res) => {
  try {
    const db = getDb();

    // Fetch all data for the tome
    const [species, characters, approvedAssets, users] = await Promise.all([
      db.collection('species').find({}).toArray(),
      req.user ? db.collection('characters').find({ userId: req.user._id }).toArray() : [],
      db.collection('assets').find({ status: 'approved' }).toArray(),
      db.collection('users').find({}).toArray()
    ]);

    // Categorize approved assets
    const categorizedAssets = {
      galaxies: approvedAssets.filter(a => a.assetType === 'galaxy'),
      planets: approvedAssets.filter(a => a.assetType === 'planet'),
      orbitals: approvedAssets.filter(a => a.assetType === 'orbital'),
      anomalies: approvedAssets.filter(a => a.assetType === 'anomaly'),
      characters: approvedAssets.filter(a => a.assetType === 'character'),
      items: approvedAssets.filter(a => a.assetType === 'item'),
      weapons: approvedAssets.filter(a => a.assetType === 'weapon'),
      environments: approvedAssets.filter(a => a.assetType === 'environment')
    };

    // Calculate featured creators (top 5 by approved asset count)
    const creatorStats = {};
    approvedAssets.forEach(asset => {
      const userId = asset.userId?.toString();
      if (userId) {
        if (!creatorStats[userId]) {
          creatorStats[userId] = {
            userId,
            assetCount: 0,
            votes: 0,
            assets: []
          };
        }
        creatorStats[userId].assetCount++;
        creatorStats[userId].votes += (asset.votes || 0);
        creatorStats[userId].assets.push(asset);
      }
    });

    // Add user details to creators
    const creators = Object.values(creatorStats).map(creator => {
      const user = users.find(u => u._id.toString() === creator.userId);
      return {
        ...creator,
        username: user?.username || 'Unknown',
        email: user?.email
      };
    });

    // Sort by asset count and get top 5
    const featuredCreators = creators
      .sort((a, b) => b.assetCount - a.assetCount)
      .slice(0, 5);

    res.render('universe/tome', {
      title: 'The Tome',
      species,
      characters,
      categorizedAssets,
      featuredCreators,
      user: req.user
    });
  } catch (err) {
    console.error('Error fetching tome data:', err);
    res.status(500).json({ error: 'Failed to fetch tome data' });
  }
});
router.get('create')
// Planetary handoff system
router.get('/planetary-grid', (req, res) => {
  res.render('universe/planetary-grid', {
    title: 'Planetary Grid System',
    user: req.user
  });
});

export default router;
