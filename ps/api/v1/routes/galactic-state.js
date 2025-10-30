import express from 'express';
import { Asset } from '../models/Asset.js';

const router = express.Router();

/**
 * GET /api/v1/state/galactic-state
 * Returns current positions and physics data for all galaxies and anomalies
 */
router.get('/', async (req, res) => {
  try {
    // Get all galaxies with their current positions and physics
    const galaxies = await Asset.find({ assetType: 'galaxy' })
      .select('_id title coordinates physics assetType')
      .lean();

    // Get all anomalies
    const anomalies = await Asset.find({ assetType: 'anomaly' })
      .select('_id title coordinates assetType')
      .lean();

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
  } catch (error) {
    console.error('Error fetching galactic state:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
