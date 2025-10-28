/**
 * Sprite Atlas Routes
 * API endpoints for managing sprite atlases
 */

import express from 'express';
import multer from 'multer';
import SpriteAtlas from '../models/SpriteAtlas.js';
import linodeStorage from '../../../utilities/linodeStorage.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024, // 50KB max (should be plenty for 80x80 PNG)
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG files are allowed'), false);
    }
  },
});

/**
 * GET /api/v1/sprite-atlases
 * Get all approved sprite atlases
 */
router.get('/', async (req, res) => {
  try {
    const { packType, limit = 100 } = req.query;

    const atlases = await SpriteAtlas.getApprovedAtlases(
      packType || null,
      parseInt(limit)
    );

    res.json({
      success: true,
      atlases,
      count: atlases.length,
    });
  } catch (error) {
    console.error('Error fetching atlases:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/sprite-atlases/pending
 * Get pending atlases for approval (admin/tester only)
 */
router.get('/pending', async (req, res) => {
  try {
    // Check if user is admin or tester
    if (!req.session.user?.isAdmin && req.session.user?.userRole !== 'tester') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    const { limit = 50 } = req.query;
    const atlases = await SpriteAtlas.getPendingAtlases(parseInt(limit));

    res.json({
      success: true,
      atlases,
      count: atlases.length,
    });
  } catch (error) {
    console.error('Error fetching pending atlases:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/sprite-atlases/my-atlases
 * Get user's uploaded atlases
 */
router.get('/my-atlases', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        error: 'Not logged in',
      });
    }

    const atlases = await SpriteAtlas.getUserAtlases(
      req.session.user._id,
      100
    );

    res.json({
      success: true,
      atlases,
      count: atlases.length,
    });
  } catch (error) {
    console.error('Error fetching user atlases:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/sprite-atlases/:id
 * Get atlas by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const atlas = await SpriteAtlas.getAtlasById(req.params.id);

    if (!atlas) {
      return res.status(404).json({
        success: false,
        error: 'Atlas not found',
      });
    }

    res.json({
      success: true,
      atlas,
    });
  } catch (error) {
    console.error('Error fetching atlas:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/v1/sprite-atlases
 * Upload a new sprite atlas
 */
router.post('/', upload.single('atlasImage'), async (req, res) => {
  try {
    // Check authentication
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        error: 'Not logged in',
      });
    }

    // Validate file uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    // Parse manifest from request body
    const manifest = JSON.parse(req.body.manifest || '{}');

    // Validate image dimensions (must be 80x80)
    // We'll trust the client for now, but could use sharp/jimp to verify

    // Generate atlas key
    const timestamp = Date.now();
    const atlasKey = `${manifest.name.toLowerCase().replace(/\s+/g, '-')}-${timestamp}`;
    const filename = `${atlasKey}.png`;

    // Upload to Linode Object Storage
    const uploadResult = await linodeStorage.uploadSpriteAtlas(
      filename,
      req.file.buffer,
      manifest.packType || 'terrain',
      {
        uploadedBy: req.session.user._id.toString(),
        name: manifest.name,
      }
    );

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to upload to storage',
        details: uploadResult.error,
      });
    }

    // Create atlas document
    const atlasData = {
      name: manifest.name,
      atlasKey,
      atlasUrl: uploadResult.url,
      packType: manifest.packType || 'terrain',
      gridSize: {
        cols: 5,
        rows: 5,
        tileWidth: 16,
        tileHeight: 16,
      },
      tileManifest: manifest.tiles || [],
      uploadedBy: new ObjectId(req.session.user._id),
    };

    const atlas = await SpriteAtlas.createAtlas(atlasData);

    res.json({
      success: true,
      message: 'Sprite atlas uploaded successfully',
      atlas,
    });
  } catch (error) {
    console.error('Error uploading atlas:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/v1/sprite-atlases/:id/vote
 * Vote on an atlas
 */
router.post('/:id/vote', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        error: 'Not logged in',
      });
    }

    const { voteType } = req.body; // 'upvote' or 'downvote'

    if (!['upvote', 'downvote'].includes(voteType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid vote type',
      });
    }

    const atlas = await SpriteAtlas.voteAtlas(
      req.params.id,
      req.session.user._id,
      voteType
    );

    res.json({
      success: true,
      message: `${voteType === 'upvote' ? 'Upvoted' : 'Downvoted'} successfully`,
      atlas,
    });
  } catch (error) {
    console.error('Error voting on atlas:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/v1/sprite-atlases/:id/approve
 * Approve an atlas (admin only)
 */
router.post('/:id/approve', async (req, res) => {
  try {
    if (!req.session.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
    }

    await SpriteAtlas.approveAtlas(req.params.id, req.session.user._id);

    const atlas = await SpriteAtlas.getAtlasById(req.params.id);

    res.json({
      success: true,
      message: 'Atlas approved',
      atlas,
    });
  } catch (error) {
    console.error('Error approving atlas:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/v1/sprite-atlases/:id/reject
 * Reject an atlas (admin only)
 */
router.post('/:id/reject', async (req, res) => {
  try {
    if (!req.session.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
    }

    const { reason } = req.body;

    await SpriteAtlas.rejectAtlas(
      req.params.id,
      req.session.user._id,
      reason || ''
    );

    const atlas = await SpriteAtlas.getAtlasById(req.params.id);

    res.json({
      success: true,
      message: 'Atlas rejected',
      atlas,
    });
  } catch (error) {
    console.error('Error rejecting atlas:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/v1/sprite-atlases/:id
 * Delete an atlas (owner or admin only)
 */
router.delete('/:id', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        error: 'Not logged in',
      });
    }

    const atlas = await SpriteAtlas.getAtlasById(req.params.id);

    if (!atlas) {
      return res.status(404).json({
        success: false,
        error: 'Atlas not found',
      });
    }

    // Check ownership or admin
    const isOwner = atlas.uploadedBy.toString() === req.session.user._id.toString();
    const isAdmin = req.session.user.isAdmin;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    // Delete from database
    await SpriteAtlas.deleteAtlas(req.params.id);

    // TODO: Also delete from Linode Object Storage

    res.json({
      success: true,
      message: 'Atlas deleted',
    });
  } catch (error) {
    console.error('Error deleting atlas:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/sprite-atlases/stats
 * Get atlas statistics
 */
router.get('/stats/overview', async (req, res) => {
  try {
    const stats = await SpriteAtlas.getAtlasStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching atlas stats:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
