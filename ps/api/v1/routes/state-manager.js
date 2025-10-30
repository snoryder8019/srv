import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { Physics3D, Vector3D } from '../physics/physics3d.js';

const router = express.Router();
const physics = new Physics3D();

/**
 * STATE MANAGER API
 *
 * Provides real-time universe state including:
 * - 3D coordinates for all assets (for 3D maps and physics)
 * - 2D projected coordinates (for legacy 2D maps)
 * - Velocity and physics data
 * - Hierarchy information
 */

/**
 * Get complete universe state
 * Returns all assets with 3D coords, 2D projection, velocity, and hierarchy
 */
router.get('/universe-state', async (req, res) => {
  try {
    const db = getDb();
    const assetsCollection = db.collection('assets');

    // Get all assets
    const assets = await assetsCollection.find({}).toArray();

    // Transform to state format with both 3D and 2D coords
    const state = assets.map(asset => ({
      id: asset._id.toString(),
      title: asset.title,
      type: asset.assetType,

      // 3D Coordinates (for 3D maps and physics)
      position3d: {
        x: asset.coordinates?.x || 0,
        y: asset.coordinates?.y || 0,
        z: asset.coordinates?.z || 0
      },

      // 2D Projected Coordinates (for 2D maps - using X,Y plane)
      position2d: {
        x: asset.coordinates?.x || 0,
        y: asset.coordinates?.y || 0
      },

      // Velocity (3D)
      velocity: {
        x: asset.velocity?.x || 0,
        y: asset.velocity?.y || 0,
        z: asset.velocity?.z || 0
      },

      // Physics properties
      mass: asset.mass || 0,
      radius: asset.radius || 10,

      // Hierarchy
      parentId: asset.parentId?.toString() || null,
      parentType: asset.parentType || null,
      orbitRadius: asset.orbitRadius || null,

      // Rendering data
      renderData: asset.renderData || {},

      // Type-specific data
      starData: asset.starData || null,
      planetData: asset.planetData || null,
      hubData: asset.hubData || null
    }));

    // Organize by type for easier consumption
    const stateByType = {
      anomalies: state.filter(s => s.type === 'anomaly'),
      galaxies: state.filter(s => s.type === 'galaxy'),
      stars: state.filter(s => s.type === 'star'),
      planets: state.filter(s => s.type === 'planet'),
      zones: state.filter(s => s.type === 'zone'),
      other: state.filter(s => !['anomaly', 'galaxy', 'star', 'planet', 'zone'].includes(s.type))
    };

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalAssets: assets.length,
      assets: state,
      byType: stateByType
    });
  } catch (err) {
    console.error('Error fetching universe state:', err);
    res.status(500).json({ error: 'Failed to fetch universe state' });
  }
});

/**
 * Get state for a specific galaxy and all its children
 */
router.get('/galaxy-state/:galaxyId', async (req, res) => {
  try {
    const db = getDb();
    const assetsCollection = db.collection('assets');
    const { galaxyId } = req.params;

    // Get galaxy
    const galaxy = await assetsCollection.findOne({ _id: new ObjectId(galaxyId) });
    if (!galaxy) {
      return res.status(404).json({ error: 'Galaxy not found' });
    }

    // Get all stars in galaxy
    const stars = await assetsCollection.find({
      parentId: new ObjectId(galaxyId),
      assetType: 'star'
    }).toArray();

    // Get all planets in those stars
    const starIds = stars.map(s => s._id);
    const planets = await assetsCollection.find({
      parentId: { $in: starIds },
      assetType: 'planet'
    }).toArray();

    // Transform to state format
    const transformAsset = (asset) => ({
      id: asset._id.toString(),
      title: asset.title,
      type: asset.assetType,
      position3d: {
        x: asset.coordinates?.x || 0,
        y: asset.coordinates?.y || 0,
        z: asset.coordinates?.z || 0
      },
      position2d: {
        x: asset.coordinates?.x || 0,
        y: asset.coordinates?.y || 0
      },
      velocity: {
        x: asset.velocity?.x || 0,
        y: asset.velocity?.y || 0,
        z: asset.velocity?.z || 0
      },
      mass: asset.mass || 0,
      radius: asset.radius || 10,
      parentId: asset.parentId?.toString() || null,
      parentType: asset.parentType || null,
      orbitRadius: asset.orbitRadius || null,
      renderData: asset.renderData || {},
      starData: asset.starData || null,
      planetData: asset.planetData || null
    });

    res.json({
      success: true,
      galaxy: transformAsset(galaxy),
      stars: stars.map(transformAsset),
      planets: planets.map(transformAsset),
      totalBodies: 1 + stars.length + planets.length
    });
  } catch (err) {
    console.error('Error fetching galaxy state:', err);
    res.status(500).json({ error: 'Failed to fetch galaxy state' });
  }
});

/**
 * Get state for a specific star system and its planets
 */
router.get('/system-state/:starId', async (req, res) => {
  try {
    const db = getDb();
    const assetsCollection = db.collection('assets');
    const { starId } = req.params;

    // Get star
    const star = await assetsCollection.findOne({ _id: new ObjectId(starId) });
    if (!star) {
      return res.status(404).json({ error: 'Star not found' });
    }

    // Get all planets in system
    const planets = await assetsCollection.find({
      parentId: new ObjectId(starId),
      assetType: 'planet'
    }).toArray();

    const transformAsset = (asset) => ({
      id: asset._id.toString(),
      title: asset.title,
      type: asset.assetType,
      position3d: {
        x: asset.coordinates?.x || 0,
        y: asset.coordinates?.y || 0,
        z: asset.coordinates?.z || 0
      },
      position2d: {
        x: asset.coordinates?.x || 0,
        y: asset.coordinates?.y || 0
      },
      velocity: {
        x: asset.velocity?.x || 0,
        y: asset.velocity?.y || 0,
        z: asset.velocity?.z || 0
      },
      mass: asset.mass || 0,
      radius: asset.radius || 10,
      parentId: asset.parentId?.toString() || null,
      parentType: asset.parentType || null,
      orbitRadius: asset.orbitRadius || null,
      renderData: asset.renderData || {},
      starData: asset.starData || null,
      planetData: asset.planetData || null
    });

    res.json({
      success: true,
      star: transformAsset(star),
      planets: planets.map(transformAsset),
      totalBodies: 1 + planets.length
    });
  } catch (err) {
    console.error('Error fetching system state:', err);
    res.status(500).json({ error: 'Failed to fetch system state' });
  }
});

/**
 * Physics tick - update all object positions based on physics
 * This would be called periodically (e.g., every second) to update orbital positions
 */
router.post('/physics-tick', async (req, res) => {
  try {
    const db = getDb();
    const assetsCollection = db.collection('assets');

    // Get all assets with physics
    const assets = await assetsCollection.find({
      mass: { $exists: true },
      velocity: { $exists: true }
    }).toArray();

    const updates = [];

    // Update each asset's position based on physics
    for (const asset of assets) {
      // Skip the central anomaly (it's stationary)
      if (asset.assetType === 'anomaly' && !asset.parentId) {
        continue;
      }

      // Get parent for gravitational calculations
      let forces = [];

      if (asset.parentId) {
        const parent = await assetsCollection.findOne({ _id: asset.parentId });
        if (parent) {
          // Calculate gravity from parent
          const gravityForce = physics.calculateGravity(
            {
              position: asset.coordinates,
              mass: asset.mass
            },
            {
              position: parent.coordinates,
              mass: parent.mass
            }
          );
          forces.push(gravityForce);
        }
      }

      // Update physics
      const newState = physics.update(
        {
          position: asset.coordinates,
          velocity: asset.velocity,
          mass: asset.mass
        },
        forces
      );

      // Queue update
      updates.push({
        updateOne: {
          filter: { _id: asset._id },
          update: {
            $set: {
              coordinates: newState.position,
              velocity: newState.velocity,
              updatedAt: new Date()
            }
          }
        }
      });
    }

    // Execute all updates
    if (updates.length > 0) {
      await assetsCollection.bulkWrite(updates);
    }

    res.json({
      success: true,
      updated: updates.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error during physics tick:', err);
    res.status(500).json({ error: 'Physics tick failed' });
  }
});

/**
 * Get minimal state for 2D map only
 * Returns just X,Y coordinates for performance
 */
router.get('/map-state-2d', async (req, res) => {
  try {
    const db = getDb();
    const assetsCollection = db.collection('assets');

    const assets = await assetsCollection.find({}).toArray();

    const mapState = assets.map(asset => ({
      id: asset._id.toString(),
      title: asset.title,
      type: asset.assetType,
      x: asset.coordinates?.x || 0,
      y: asset.coordinates?.y || 0,
      radius: asset.radius || 10,
      color: asset.renderData?.color || '#FFFFFF',
      parentId: asset.parentId?.toString() || null
    }));

    res.json({
      success: true,
      assets: mapState,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching 2D map state:', err);
    res.status(500).json({ error: 'Failed to fetch 2D map state' });
  }
});

/**
 * Get galactic state - galaxies and anomalies with physics
 * Optimized endpoint for real-time physics polling
 */
router.get('/galactic-state', async (req, res) => {
  try {
    const db = getDb();
    const assetsCollection = db.collection('assets');

    // Get all galaxies with their current positions and physics
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' })
      .project({ _id: 1, title: 1, coordinates: 1, physics: 1, assetType: 1 })
      .toArray();

    // Get all anomalies
    const anomalies = await assetsCollection.find({ assetType: 'anomaly' })
      .project({ _id: 1, title: 1, coordinates: 1, assetType: 1 })
      .toArray();

    res.json({
      success: true,
      galaxies,
      anomalies,
      count: {
        galaxies: galaxies.length,
        anomalies: anomalies.length
      },
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Error fetching galactic state:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * Get minimal state for 3D map only
 * Returns X,Y,Z coordinates with render data
 */
router.get('/map-state-3d', async (req, res) => {
  try {
    const db = getDb();
    const assetsCollection = db.collection('assets');

    const assets = await assetsCollection.find({}).toArray();

    const mapState = assets.map(asset => ({
      id: asset._id.toString(),
      title: asset.title,
      type: asset.assetType,
      x: asset.coordinates?.x || 0,
      y: asset.coordinates?.y || 0,
      z: asset.coordinates?.z || 0,
      radius: asset.radius || 10,
      renderData: asset.renderData || {},
      parentId: asset.parentId?.toString() || null,
      parentGalaxy: asset.parentGalaxy?.toString() || null,
      parentStar: asset.parentStar?.toString() || null,
      orbitRadius: asset.orbitRadius || null,
      orbitAngle: asset.orbitAngle || null,
      orbitInclination: asset.orbitInclination || null,
      orbitAscendingNode: asset.orbitAscendingNode || null,
      velocity: asset.velocity || null,
      localCoordinates: asset.localCoordinates || null,
      universalCoordinates: asset.universalCoordinates || null,
      coordinates3D: asset.coordinates3D || null
    }));

    res.json({
      success: true,
      assets: mapState,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching 3D map state:', err);
    res.status(500).json({ error: 'Failed to fetch 3D map state' });
  }
});

export default router;
