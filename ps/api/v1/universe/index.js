import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import Asset from '../models/Asset.js';

const router = express.Router();

// Get galactic state
router.get('/galactic-state', async (req, res) => {
  try {
    const db = getDb();
    const galacticState = await db.collection('galacticState').findOne({});

    if (!galacticState) {
      return res.status(404).json({ error: 'Galactic state not found' });
    }

    res.json({ galacticState });
  } catch (err) {
    console.error('Error fetching galactic state:', err);
    res.status(500).json({ error: 'Failed to fetch galactic state' });
  }
});

// Get all species
router.get('/species', async (req, res) => {
  try {
    const db = getDb();
    const species = await db.collection('species').find({}).toArray();
    res.json({ species });
  } catch (err) {
    console.error('Error fetching species:', err);
    res.status(500).json({ error: 'Failed to fetch species' });
  }
});

// Get talent trees
router.get('/talent-trees', async (req, res) => {
  try {
    const db = getDb();
    const talentTrees = await db.collection('talentTrees').findOne({});

    if (!talentTrees) {
      return res.status(404).json({ error: 'Talent trees not found' });
    }

    res.json({ talentTrees });
  } catch (err) {
    console.error('Error fetching talent trees:', err);
    res.status(500).json({ error: 'Failed to fetch talent trees' });
  }
});

// Get planetary state
router.get('/planetary-state', async (req, res) => {
  try {
    const db = getDb();
    const planetaryState = await db.collection('planetaryState').findOne({});

    if (!planetaryState) {
      return res.status(404).json({ error: 'Planetary state not found' });
    }

    res.json({ planetaryState });
  } catch (err) {
    console.error('Error fetching planetary state:', err);
    res.status(500).json({ error: 'Failed to fetch planetary state' });
  }
});

// Get active events
router.get('/events', async (req, res) => {
  try {
    const db = getDb();
    const galacticState = await db.collection('galacticState').findOne({});

    if (!galacticState || !galacticState.activeEvents) {
      return res.json({ events: [] });
    }

    res.json({ events: galacticState.activeEvents });
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ============ HIERARCHY NAVIGATION ENDPOINTS ============

// Get all galaxies
router.get('/galaxies', async (req, res) => {
  try {
    const galaxies = await Asset.getGalaxies();

    // Enrich with star counts
    const enrichedGalaxies = await Promise.all(
      galaxies.map(async (galaxy) => {
        const starCount = await Asset.getChildrenCount(galaxy._id, 'galaxy');
        return {
          ...galaxy,
          starCount
        };
      })
    );

    res.json({ galaxies: enrichedGalaxies });
  } catch (err) {
    console.error('Error fetching galaxies:', err);
    res.status(500).json({ error: 'Failed to fetch galaxies' });
  }
});

// Get specific galaxy details
router.get('/galaxies/:id', async (req, res) => {
  try {
    const galaxy = await Asset.findById(req.params.id);

    if (!galaxy) {
      return res.status(404).json({ error: 'Galaxy not found' });
    }

    if (galaxy.assetType !== 'galaxy') {
      return res.status(400).json({ error: 'Asset is not a galaxy' });
    }

    const starCount = await Asset.getChildrenCount(galaxy._id, 'galaxy');

    res.json({
      galaxy: {
        ...galaxy,
        starCount
      }
    });
  } catch (err) {
    console.error('Error fetching galaxy:', err);
    res.status(500).json({ error: 'Failed to fetch galaxy' });
  }
});

// Get all stars in a galaxy
router.get('/galaxies/:id/stars', async (req, res) => {
  try {
    const stars = await Asset.getStarsInGalaxy(req.params.id);

    // Enrich with planet counts
    const enrichedStars = await Promise.all(
      stars.map(async (star) => {
        const planetCount = await Asset.getChildrenCount(star._id, 'star');
        return {
          ...star,
          planetCount
        };
      })
    );

    res.json({ success: true, stars: enrichedStars });
  } catch (err) {
    console.error('Error fetching stars:', err);
    res.status(500).json({ error: 'Failed to fetch stars' });
  }
});

// Get specific star system details
router.get('/stars/:id', async (req, res) => {
  try {
    const star = await Asset.findById(req.params.id);

    if (!star) {
      return res.status(404).json({ error: 'Star not found' });
    }

    if (star.assetType !== 'star') {
      return res.status(400).json({ error: 'Asset is not a star' });
    }

    const planetCount = await Asset.getChildrenCount(star._id, 'star');
    const hierarchyPath = await Asset.getHierarchyPath(star._id);

    res.json({
      star: {
        ...star,
        planetCount
      },
      hierarchy: hierarchyPath
    });
  } catch (err) {
    console.error('Error fetching star:', err);
    res.status(500).json({ error: 'Failed to fetch star' });
  }
});

// Get all planetary bodies in a star system
router.get('/stars/:id/bodies', async (req, res) => {
  try {
    const bodies = await Asset.getBodiesInStarSystem(req.params.id);

    res.json({ bodies });
  } catch (err) {
    console.error('Error fetching planetary bodies:', err);
    res.status(500).json({ error: 'Failed to fetch planetary bodies' });
  }
});

// Get hierarchy path for any asset
router.get('/assets/:id/hierarchy', async (req, res) => {
  try {
    const path = await Asset.getHierarchyPath(req.params.id);
    res.json({ hierarchy: path });
  } catch (err) {
    console.error('Error fetching hierarchy:', err);
    res.status(500).json({ error: 'Failed to fetch hierarchy path' });
  }
});

// Get universe assets for TOME (new unified endpoint)
router.get('/assets', async (req, res) => {
  try {
    const db = getDb();

    // Fetch approved universe assets
    const approvedAssets = await db.collection('assets')
      .find({ status: 'approved' })
      .toArray();

    // Categorize by type
    const galaxies = approvedAssets.filter(a => a.assetType === 'galaxy');
    const stars = approvedAssets.filter(a => a.assetType === 'star');
    const planets = approvedAssets.filter(a => a.assetType === 'planet');
    const moons = approvedAssets.filter(a => a.assetType === 'moon');
    const anomalies = approvedAssets.filter(a => a.assetType === 'anomaly');

    res.json({
      success: true,
      assets: {
        galaxies,
        stars,
        planets,
        moons,
        anomalies
      },
      counts: {
        galaxies: galaxies.length,
        stars: stars.length,
        planets: planets.length,
        moons: moons.length,
        anomalies: anomalies.length,
        total: approvedAssets.filter(a =>
          ['galaxy', 'star', 'planet', 'moon', 'anomaly'].includes(a.assetType)
        ).length
      }
    });
  } catch (err) {
    console.error('Error fetching universe assets:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch universe assets'
    });
  }
});

// Get Tome data (for in-game overlay)
router.get('/tome-data', async (req, res) => {
  try {
    const db = getDb();

    // Fetch data for the tome
    const [species, approvedAssets] = await Promise.all([
      db.collection('species').find({}).toArray(),
      db.collection('assets').find({ status: 'approved' }).toArray()
    ]);

    // Categorize approved assets
    const categorizedAssets = {
      galaxies: approvedAssets.filter(a => a.assetType === 'galaxy'),
      stars: approvedAssets.filter(a => a.assetType === 'star'),
      planets: approvedAssets.filter(a => a.assetType === 'planet'),
      moons: approvedAssets.filter(a => a.assetType === 'moon'),
      anomalies: approvedAssets.filter(a => a.assetType === 'anomaly'),
      ships: approvedAssets.filter(a => a.assetType === 'ship'),
      items: approvedAssets.filter(a => a.assetType === 'item'),
      weapons: approvedAssets.filter(a => a.assetType === 'weapon')
    };

    res.json({
      success: true,
      species,
      assets: categorizedAssets,
      totalAssets: approvedAssets.length
    });
  } catch (err) {
    console.error('Error fetching tome data:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tome data'
    });
  }
});

export default router;
