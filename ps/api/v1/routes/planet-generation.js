/**
 * Planet Generation API Routes
 * Handles procedural planet generation, chunking, and seeding
 */
import express from 'express';
import { PlanetGeneration } from '../models/PlanetGeneration.js';

const router = express.Router();

/**
 * GET /api/v1/planet-generation/:planetId/status
 * Get planet generation status
 */
router.get('/:planetId/status', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { planetId } = req.params;

    const status = await PlanetGeneration.getStatus(planetId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting planet status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/planet-generation/:planetId/initialize
 * Initialize planet generation (first visit)
 */
router.post('/:planetId/initialize', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { planetId } = req.params;
    const userId = req.user._id;

    const generationData = await PlanetGeneration.initializePlanet(planetId, userId);

    res.json({
      success: true,
      data: generationData,
      message: 'Congratulations! You are the pioneer of this planet!'
    });
  } catch (error) {
    console.error('Error initializing planet:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/planet-generation/:planetId/chunks
 * Get chunks around a position
 */
router.get('/:planetId/chunks', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { planetId } = req.params;
    const { chunkX, chunkY, radius } = req.query;

    const centerX = parseInt(chunkX) || 0;
    const centerY = parseInt(chunkY) || 0;
    const loadRadius = parseInt(radius) || 2;

    const chunks = await PlanetGeneration.getChunksAround(
      planetId,
      centerX,
      centerY,
      loadRadius
    );

    // Record visitor
    await PlanetGeneration.recordVisitor(planetId, req.user._id);

    res.json({
      success: true,
      data: {
        chunks,
        center: { x: centerX, y: centerY },
        radius: loadRadius
      }
    });
  } catch (error) {
    console.error('Error loading chunks:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/planet-generation/:planetId/chunks/:chunkX/:chunkY
 * Generate a specific chunk
 */
router.post('/:planetId/chunks/:chunkX/:chunkY', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { planetId, chunkX, chunkY } = req.params;

    const chunk = await PlanetGeneration.generateChunk(
      planetId,
      parseInt(chunkX),
      parseInt(chunkY)
    );

    res.json({
      success: true,
      data: chunk
    });
  } catch (error) {
    console.error('Error generating chunk:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/planet-generation/:planetId/seed
 * Background seeding endpoint (generates initial chunks)
 */
router.post('/:planetId/seed', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { planetId } = req.params;
    const { chunksToGenerate } = req.body; // Number of chunks to generate this batch

    const batchSize = chunksToGenerate || 25;

    // Generate chunks more efficiently - just generate a batch without worrying about spiral
    // The chunks will be loaded on-demand when players explore
    const generatedChunks = await PlanetGeneration.generateBatchChunks(planetId, batchSize);

    // Check if seeding complete
    const updatedStatus = await PlanetGeneration.getStatus(planetId);
    if (updatedStatus.percentage >= 90 && updatedStatus.status !== 'ready') {
      await PlanetGeneration.markReady(planetId);
    }

    res.json({
      success: true,
      data: {
        generated: generatedChunks.length,
        progress: updatedStatus.progress,
        total: updatedStatus.total,
        percentage: updatedStatus.percentage,
        status: updatedStatus.status
      }
    });
  } catch (error) {
    console.error('Error seeding planet:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
