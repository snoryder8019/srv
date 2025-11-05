import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';
import galacticStateRouter from './galacticState.js';
import zoneRouter from './zone.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Mount sub-routes
router.use('/', galacticStateRouter);
router.use('/zone', zoneRouter);

// Get galactic state view (streaming version)
router.get('/galactic-state', async (req, res) => {
  res.render('universe/galacticState-stream', {
    title: 'Galactic State - Live',
    user: req.user
  });
});

// Redirect 2D galactic map to 3D (2D removed)
router.get('/galactic-map', async (req, res) => {
  res.redirect('/universe/galactic-map-3d');
});

// Get 3D galactic map view (Three.js visualization) - Shows all assets in 3D space
router.get('/galactic-map-3d', async (req, res) => {
  try {
    res.render('universe/galactic-map-3d', {
      title: 'Galactic Territory Map',
      user: req.user
    });
  } catch (err) {
    console.error('Error loading 3D galactic map:', err);
    res.status(500).render('errors/error', {
      title: 'Error',
      user: req.user,
      error: { status: 500, message: 'Failed to load 3D galactic map' }
    });
  }
});

// System map 3D view - Shows ALL orbital bodies with 3D coordinates
router.get('/system-map-3d', async (req, res) => {
  try {
    res.render('universe/system-map-3d', {
      title: 'System Map - All Orbital Bodies',
      user: req.user
    });
  } catch (err) {
    console.error('Error loading 3D system map:', err);
    res.status(500).render('errors/error', {
      title: 'Error',
      user: req.user,
      error: { status: 500, message: 'Failed to load 3D system map' }
    });
  }
});

// System map 3D view for specific star - Auto-seeds planets if needed
router.get('/system-map-3d/:starId', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const starId = req.params.starId;

    // Get the star
    const star = await db.collection('assets').findOne({
      _id: new ObjectId(starId)
    });

    if (!star) {
      return res.status(404).render('errors/error', {
        title: 'Star Not Found',
        user: req.user,
        error: { status: 404, message: 'Star system not found' }
      });
    }

    // Check if this star has planets
    const planets = await db.collection('assets').find({
      parentId: new ObjectId(starId),
      assetType: 'planet'
    }).toArray();

    // If no planets exist, seed them
    if (planets.length === 0) {
      console.log(`⚠️ Star ${star.title} has no planets. Seeding planets...`);

      // Import physics for orbital calculations
      const { Physics3D } = await import('../../api/v1/physics/physics3d.js');
      const physics = new Physics3D();

      const planetTypes = [
        { suffix: 'I', type: 'rocky', color: '#AA6644', size: 20, mass: 20 },
        { suffix: 'II', type: 'gas giant', color: '#6688FF', size: 40, mass: 50 }
      ];

      const newPlanets = [];
      for (let i = 0; i < 2; i++) {
        const planetType = planetTypes[i];
        const orbitRadius = 80 + (i * 60); // 80, 140

        // Calculate orbital position relative to star
        const orbitData = physics.setCircularOrbit(
          { position: { x: 0, y: 0, z: 0 }, mass: planetType.mass },
          { position: star.coordinates, mass: star.mass || 500 },
          orbitRadius,
          Math.random() * 0.3 // Random inclination
        );

        const planet = {
          title: `${star.title} ${planetType.suffix}`,
          assetType: 'planet',
          description: `A ${planetType.type} orbiting ${star.title}`,
          coordinates: orbitData.position,
          velocity: orbitData.velocity,
          mass: planetType.mass,
          radius: planetType.size,
          parentId: new ObjectId(starId),
          parentType: 'star',
          orbitRadius: orbitRadius,
          planetData: {
            type: planetType.type,
            atmosphere: planetType.type === 'gas giant',
            landable: planetType.type === 'rocky'
          },
          renderData: {
            color: planetType.color,
            size: planetType.size,
            type: planetType.type
          },
          status: 'approved',
          userId: req.user?._id || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await db.collection('assets').insertOne(planet);
        newPlanets.push({ ...planet, _id: result.insertedId });
        console.log(`  ✓ Created planet: ${planet.title}`);
      }

      console.log(`✅ Seeded ${newPlanets.length} planets for ${star.title}`);
    }

    // Render the system map with the star ID in the query string
    res.render('universe/system-map-3d', {
      title: `${star.title} - System Map`,
      user: req.user,
      starId: starId
    });
  } catch (err) {
    console.error('Error loading 3D system map:', err);
    res.status(500).render('errors/error', {
      title: 'Error',
      user: req.user,
      error: { status: 500, message: 'Failed to load 3D system map' }
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

// The Tome - Storylines, Characters, Lore
router.get('/tome', async (req, res) => {
  res.render('storylines/tome', {
    title: 'THE TOME - Chronicles of the Stringborn Universe',
    user: req.user,
    character: res.locals.character
  });
});
// Sprite Atlas Creator
router.get('/sprite-creator', (req, res) => {
  res.render('universe/sprite-creator', {
    title: 'Sprite Atlas Creator',
    user: req.user,
    character: res.locals.character
  });
});

// Ship builder
router.get('/ship-builder', (req, res) => {
  res.render('universe/ship-builder', {
    title: 'Universal Ship Builder',
    user: req.user,
    character: res.locals.character
  });
});

// Interior Map Builder
router.get('/interior-map-builder', (req, res) => {
  res.render('universe/interior-map-builder', {
    title: 'Interior Map Builder',
    user: req.user,
    character: res.locals.character
  });
});

// Planetary handoff system
router.get('/planetary-grid', (req, res) => {
  res.render('universe/planetary-grid', {
    title: 'Planetary Grid System',
    user: req.user
  });
});

export default router;
