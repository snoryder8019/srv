import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';
import galacticStateRouter from './galacticState.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Get galactic map view (2D visualization) - Shows all galaxies
router.get('/galactic-map', async (req, res) => {
  try {
    const db = getDb();

    // Fetch all approved galaxies from assets
    const galaxies = await db.collection('assets')
      .find({
        assetType: 'galaxy',
        status: 'approved'
      })
      .toArray();

    res.render('universe/galactic-map', {
      title: 'Galactic Territory Map',
      user: req.user,
      galaxies: JSON.stringify(galaxies) // Pass as JSON for frontend
    });
  } catch (err) {
    console.error('Error loading galactic map:', err);
    res.render('universe/galactic-map', {
      title: 'Galactic Territory Map',
      user: req.user,
      galaxies: JSON.stringify([])
    });
  }
});

// Get galaxy view (2D visualization) - Shows stars in a specific galaxy
router.get('/galaxy/:id', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');

    // Get the galaxy
    const galaxy = await db.collection('assets').findOne({
      _id: new ObjectId(req.params.id),
      assetType: 'galaxy',
      status: 'approved'
    });

    if (!galaxy) {
      return res.status(404).render('errors/error', {
        title: 'Galaxy Not Found',
        user: req.user,
        error: { status: 404, message: 'Galaxy not found' }
      });
    }

    // Get all stars in this galaxy
    const stars = await db.collection('assets')
      .find({
        assetType: 'star',
        status: 'approved',
        parentGalaxy: new ObjectId(req.params.id)
      })
      .toArray();

    res.render('universe/galaxy-map', {
      title: `${galaxy.title} - Galaxy Map`,
      user: req.user,
      galaxy: JSON.stringify(galaxy),
      stars: JSON.stringify(stars)
    });
  } catch (err) {
    console.error('Error loading galaxy map:', err);
    res.status(500).render('errors/error', {
      title: 'Error',
      user: req.user,
      error: { status: 500, message: 'Failed to load galaxy map' }
    });
  }
});

// Get star system 3D view - Shows planets/orbitals in 3D with Three.js
router.get('/star-system/:id', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');

    // Get the star
    const star = await db.collection('assets').findOne({
      _id: new ObjectId(req.params.id),
      assetType: 'star',
      status: 'approved'
    });

    if (!star) {
      return res.status(404).render('errors/error', {
        title: 'Star Not Found',
        user: req.user,
        error: { status: 404, message: 'Star system not found' }
      });
    }

    // Get all planetary bodies in this star system
    const bodies = await db.collection('assets')
      .find({
        assetType: { $in: ['planet', 'orbital', 'anomaly'] },
        status: 'approved',
        parentStar: new ObjectId(req.params.id)
      })
      .sort({ 'orbital.radius': 1 })
      .toArray();

    // Get hierarchy (galaxy)
    let hierarchy = { galaxy: null };
    if (star.parentGalaxy) {
      const galaxy = await db.collection('assets').findOne({
        _id: star.parentGalaxy
      });
      hierarchy.galaxy = galaxy;
    }

    res.render('universe/star-system', {
      title: `${star.title} - Star System`,
      user: req.user,
      star: JSON.stringify(star),
      bodies: JSON.stringify(bodies),
      hierarchy: JSON.stringify(hierarchy)
    });
  } catch (err) {
    console.error('Error loading star system:', err);
    res.status(500).render('errors/error', {
      title: 'Error',
      user: req.user,
      error: { status: 500, message: 'Failed to load star system' }
    });
  }
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

    // Load lore arcs from JSON file
    let loreArcs = [];
    try {
      const loreArcsPath = join(__dirname, '../../data/lore-arcs.json');
      const loreArcsData = readFileSync(loreArcsPath, 'utf-8');
      loreArcs = JSON.parse(loreArcsData);
    } catch (err) {
      console.error('Error loading lore arcs:', err);
      loreArcs = [];
    }

    res.render('universe/tome-slim', {
      title: 'The Tome',
      species,
      characters,
      categorizedAssets,
      featuredCreators,
      loreArcs,
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
