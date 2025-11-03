import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { physicsService } from '../../../services/physics-service.js';

const router = express.Router();

/**
 * GET /api/v1/state/galactic-state
 * Returns current positions and physics data for all galaxies and anomalies
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();

    // Get all galaxies with their current positions and physics
    const galaxies = await db.collection(collections.assets)
      .find({ assetType: 'galaxy' })
      .project({ _id: 1, title: 1, coordinates: 1, physics: 1, assetType: 1, parentId: 1 })
      .toArray();

    // Get all anomalies
    const anomalies = await db.collection(collections.assets)
      .find({ assetType: 'anomaly' })
      .project({ _id: 1, title: 1, coordinates: 1, assetType: 1 })
      .toArray();

    // Get current connections from physics service
    const connections = physicsService.getConnections ? physicsService.getConnections() : [];

    res.json({
      success: true,
      galaxies,
      anomalies,
      connections,
      count: {
        galaxies: galaxies.length,
        anomalies: anomalies.length,
        connections: connections.length
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching galactic state:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/state/simulation-speed
 * Returns current simulation speed
 */
router.get('/simulation-speed', (req, res) => {
  try {
    const status = physicsService.getStatus();
    res.json({
      success: true,
      simulationSpeed: status.simulationSpeed,
      ...status
    });
  } catch (error) {
    console.error('Error getting simulation speed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/state/simulation-speed
 * Set simulation speed multiplier
 * Body: { speed: number } (0.1 to 10.0)
 */
router.post('/simulation-speed', (req, res) => {
  try {
    const { speed } = req.body;

    if (typeof speed !== 'number' || speed < 0.1 || speed > 10) {
      return res.status(400).json({
        success: false,
        error: 'Speed must be a number between 0.1 and 10.0'
      });
    }

    const newSpeed = physicsService.setSimulationSpeed(speed);

    res.json({
      success: true,
      simulationSpeed: newSpeed,
      message: `Simulation speed set to ${newSpeed.toFixed(1)}x`
    });
  } catch (error) {
    console.error('Error setting simulation speed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
