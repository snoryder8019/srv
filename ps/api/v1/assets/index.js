/**
 * Asset API Routes
 * Handles asset creation, updates, submissions, voting
 */
import express from 'express';
import { Asset } from '../models/Asset.js';
import { assetUploadFields } from '../../../plugins/multer/config.js';
import { isAuthenticated } from '../../../utilities/helpers.js';
import {
  trackAssetCreated,
  trackAssetSubmitted,
  trackVote,
  trackSuggestion
} from '../../../middlewares/analyticsTracker.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Helper function to add type-specific fields to asset data
 */
function addTypeSpecificFields(assetData, body) {
  // Environment-specific fields
  if (body.environmentType) assetData.environmentType = body.environmentType;
  if (body.climate) assetData.climate = body.climate;
  if (body.atmosphere) assetData.atmosphere = body.atmosphere;
  if (body.gravity) assetData.gravity = body.gravity;
  if (body.resources) {
    assetData.resources = typeof body.resources === 'string'
      ? JSON.parse(body.resources)
      : body.resources;
  }

  // Object-specific fields
  if (body.objectType) assetData.objectType = body.objectType;
  if (body.isInteractive !== undefined) {
    assetData.isInteractive = body.isInteractive === 'true' || body.isInteractive === true;
  }
  if (body.interactionType) assetData.interactionType = body.interactionType;

  // Item-specific fields
  if (body.rarity) assetData.rarity = body.rarity;
  if (body.stackable !== undefined) {
    assetData.stackable = body.stackable === 'true' || body.stackable === true;
  }
  if (body.maxStack) assetData.maxStack = parseInt(body.maxStack);
  if (body.tradeable !== undefined) {
    assetData.tradeable = body.tradeable === 'true' || body.tradeable === true;
  }

  // Stats, buffs, effects (for multiple types)
  if (body.stats) {
    assetData.stats = typeof body.stats === 'string'
      ? JSON.parse(body.stats)
      : body.stats;
  }
  if (body.buffs) {
    assetData.buffs = typeof body.buffs === 'string'
      ? JSON.parse(body.buffs)
      : body.buffs;
  }
  if (body.effects) {
    assetData.effects = typeof body.effects === 'string'
      ? JSON.parse(body.effects)
      : body.effects;
  }

  // Lore fields
  if (body.backstory) assetData.backstory = body.backstory;
  if (body.lore) assetData.lore = body.lore;
}

/**
 * GET /api/v1/assets
 * Get all assets for current user
 */
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const assets = await Asset.findByUserId(req.user._id);
    res.json({ success: true, assets });
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/assets/community
 * Get all submitted assets for community voting
 */
router.get('/community', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const assets = await Asset.findCommunity(limit);

    res.json({ success: true, assets });
  } catch (error) {
    console.error('Error fetching community assets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/assets/approved/list
 * Get all approved assets for voting
 */
router.get('/approved/list', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const assets = await Asset.findApproved(limit);

    res.json({ success: true, assets });
  } catch (error) {
    console.error('Error fetching approved assets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/assets/:id
 * Get specific asset by ID
 */
router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    // Users can only view their own assets unless they're approved
    if (asset.userId.toString() !== req.user._id.toString() && asset.status !== 'approved') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    res.json({ success: true, asset });
  } catch (error) {
    console.error('Error fetching asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets
 * Create new asset
 */
router.post('/', isAuthenticated, assetUploadFields, async (req, res) => {
  try {
    const { title, description, assetType, pixelData } = req.body;

    if (!title || !assetType) {
      return res.status(400).json({
        success: false,
        error: 'Title and asset type are required'
      });
    }

    // Process uploaded files
    const images = {};
    if (req.files) {
      if (req.files.pixelArt) {
        images.pixelArt = `/uploads/assets/${req.files.pixelArt[0].filename}`;
      }
      if (req.files.fullscreen) {
        images.fullscreen = `/uploads/assets/${req.files.fullscreen[0].filename}`;
      }
      if (req.files.indexCard) {
        images.indexCard = `/uploads/assets/${req.files.indexCard[0].filename}`;
      }
    }

    const assetData = {
      userId: req.user._id,
      title,
      description,
      assetType,
      images,
      pixelData: pixelData ? JSON.parse(pixelData) : null
    };

    // Add type-specific fields
    addTypeSpecificFields(assetData, req.body);

    const asset = await Asset.create(assetData);

    // Track asset creation
    trackAssetCreated(req.user._id, asset._id, assetType).catch(err => {
      console.error('Error tracking asset creation:', err);
    });

    res.status(201).json({ success: true, asset });
  } catch (error) {
    console.error('Error creating asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/v1/assets/:id
 * Update asset
 */
router.put('/:id', isAuthenticated, assetUploadFields, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    if (asset.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Can only edit drafts or rejected assets
    if (asset.status !== 'draft' && asset.status !== 'rejected') {
      return res.status(400).json({
        success: false,
        error: 'Can only edit draft or rejected assets'
      });
    }

    const { title, description, assetType, pixelData } = req.body;

    const updateData = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (assetType) updateData.assetType = assetType;
    if (pixelData) updateData.pixelData = JSON.parse(pixelData);

    // Add type-specific fields
    addTypeSpecificFields(updateData, req.body);

    // Process uploaded files
    const images = { ...asset.images };
    if (req.files) {
      if (req.files.pixelArt) {
        // Delete old file if exists
        if (images.pixelArt) {
          const oldPath = path.join(__dirname, '../../../public', images.pixelArt);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }
        images.pixelArt = `/uploads/assets/${req.files.pixelArt[0].filename}`;
      }
      if (req.files.fullscreen) {
        if (images.fullscreen) {
          const oldPath = path.join(__dirname, '../../../public', images.fullscreen);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }
        images.fullscreen = `/uploads/assets/${req.files.fullscreen[0].filename}`;
      }
      if (req.files.indexCard) {
        if (images.indexCard) {
          const oldPath = path.join(__dirname, '../../../public', images.indexCard);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }
        images.indexCard = `/uploads/assets/${req.files.indexCard[0].filename}`;
      }
    }

    if (Object.keys(images).length > 0) {
      updateData.images = images;
    }

    await Asset.update(req.params.id, updateData);

    const updatedAsset = await Asset.findById(req.params.id);

    res.json({ success: true, asset: updatedAsset });
  } catch (error) {
    console.error('Error updating asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets/:id/approve
 * Approve asset (admin only)
 */
router.post('/:id/approve', isAuthenticated, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    await Asset.update(req.params.id, {
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: req.user._id
    });

    res.json({ success: true, message: 'Asset approved' });
  } catch (error) {
    console.error('Error approving asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets/:id/submit
 * Submit asset for approval
 */
router.post('/:id/submit', isAuthenticated, async (req, res) => {
  try {
    await Asset.submitForApproval(req.params.id, req.user._id);

    const asset = await Asset.findById(req.params.id);

    // Track asset submission
    trackAssetSubmitted(req.user._id, req.params.id, asset.assetType).catch(err => {
      console.error('Error tracking asset submission:', err);
    });

    res.json({
      success: true,
      message: 'Asset submitted for approval',
      asset
    });
  } catch (error) {
    console.error('Error submitting asset:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/v1/assets/:id
 * Delete asset
 */
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    // Delete associated files
    const uploadsDir = path.join(__dirname, '../../../uploads/assets');
    if (asset.images.pixelArt) {
      const pixelPath = path.join(uploadsDir, path.basename(asset.images.pixelArt));
      if (fs.existsSync(pixelPath)) {
        fs.unlinkSync(pixelPath);
      }
    }
    if (asset.images.fullscreen) {
      const fullscreenPath = path.join(uploadsDir, path.basename(asset.images.fullscreen));
      if (fs.existsSync(fullscreenPath)) {
        fs.unlinkSync(fullscreenPath);
      }
    }
    if (asset.images.indexCard) {
      const indexCardPath = path.join(uploadsDir, path.basename(asset.images.indexCard));
      if (fs.existsSync(indexCardPath)) {
        fs.unlinkSync(indexCardPath);
      }
    }

    await Asset.delete(req.params.id, req.user._id);

    res.json({ success: true, message: 'Asset deleted' });
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets/:id/vote
 * Vote for an asset (upvote or downvote)
 * Body: { voteType: 1 (upvote) or -1 (downvote) }
 */
router.post('/:id/vote', isAuthenticated, async (req, res) => {
  try {
    const voteType = req.body.voteType === -1 ? -1 : 1; // Default to upvote
    await Asset.addVote(req.params.id, req.user._id, voteType);

    const asset = await Asset.findById(req.params.id);

    // Track vote
    trackVote(req.user._id, req.params.id, voteType === 1 ? 'upvote' : 'downvote').catch(err => {
      console.error('Error tracking vote:', err);
    });

    res.json({
      success: true,
      message: voteType === 1 ? 'Upvoted' : 'Downvoted',
      votes: asset.votes,
      upvotes: asset.upvotes || 0,
      downvotes: asset.downvotes || 0
    });
  } catch (error) {
    console.error('Error adding vote:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/v1/assets/:id/vote
 * Remove vote from asset
 */
router.delete('/:id/vote', isAuthenticated, async (req, res) => {
  try {
    await Asset.removeVote(req.params.id, req.user._id);

    const asset = await Asset.findById(req.params.id);

    // Track vote removal
    trackVote(req.user._id, req.params.id, 'remove').catch(err => {
      console.error('Error tracking vote removal:', err);
    });

    res.json({
      success: true,
      message: 'Vote removed',
      votes: asset.votes
    });
  } catch (error) {
    console.error('Error removing vote:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/assets/:id/suggestions
 * Get all suggestions for an asset
 */
router.get('/:id/suggestions', async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    const suggestions = asset.suggestions || [];

    res.json({
      success: true,
      suggestions: suggestions.map(s => ({
        ...s,
        upvotes: s.upvotes || [],
        upvoteCount: (s.upvotes || []).length
      }))
    });
  } catch (error) {
    console.error('Error fetching suggestions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets/:id/suggestions
 * Add a suggestion to an asset (with field changes and images)
 */
router.post('/:id/suggestions', isAuthenticated, assetUploadFields, async (req, res) => {
  try {
    const { text, fieldChanges } = req.body;

    const suggestionData = {
      text: text || '',
      fieldChanges: fieldChanges ? JSON.parse(fieldChanges) : {},
      images: {}
    };

    // Handle uploaded images
    if (req.files) {
      if (req.files.pixelArt) {
        suggestionData.images.pixelArt = `/uploads/assets/${req.files.pixelArt[0].filename}`;
      }
      if (req.files.fullscreen) {
        suggestionData.images.fullscreen = `/uploads/assets/${req.files.fullscreen[0].filename}`;
      }
      if (req.files.indexCard) {
        suggestionData.images.indexCard = `/uploads/assets/${req.files.indexCard[0].filename}`;
      }
    }

    const suggestion = await Asset.addSuggestion(
      req.params.id,
      req.user._id,
      req.user.username,
      suggestionData
    );

    // Track suggestion
    trackSuggestion(req.user._id, req.params.id, suggestion._id).catch(err => {
      console.error('Error tracking suggestion:', err);
    });

    res.json({
      success: true,
      message: 'Suggestion added',
      suggestion
    });
  } catch (error) {
    console.error('Error adding suggestion:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets/:assetId/suggestions/:suggestionId/approve
 * Approve a suggestion and apply changes (creator only)
 */
router.post('/:assetId/suggestions/:suggestionId/approve', isAuthenticated, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.assetId);

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    if (asset.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Only asset creator can approve suggestions' });
    }

    await Asset.approveSuggestion(req.params.assetId, req.params.suggestionId);

    res.json({
      success: true,
      message: 'Suggestion approved and applied'
    });
  } catch (error) {
    console.error('Error approving suggestion:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets/:assetId/suggestions/:suggestionId/reject
 * Reject a suggestion (creator only)
 */
router.post('/:assetId/suggestions/:suggestionId/reject', isAuthenticated, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.assetId);

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    if (asset.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Only asset creator can reject suggestions' });
    }

    await Asset.rejectSuggestion(req.params.assetId, req.params.suggestionId, req.body.reason);

    res.json({
      success: true,
      message: 'Suggestion rejected'
    });
  } catch (error) {
    console.error('Error rejecting suggestion:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets/:assetId/suggestions/:suggestionId/upvote
 * Upvote a suggestion
 */
router.post('/:assetId/suggestions/:suggestionId/upvote', isAuthenticated, async (req, res) => {
  try {
    await Asset.upvoteSuggestion(req.params.assetId, req.params.suggestionId, req.user._id);

    res.json({
      success: true,
      message: 'Suggestion upvoted'
    });
  } catch (error) {
    console.error('Error upvoting suggestion:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/assets/:id/collaborators
 * Add a collaborator to an asset
 */
router.post('/:id/collaborators', isAuthenticated, async (req, res) => {
  try {
    const { collaboratorId, collaboratorName } = req.body;

    if (!collaboratorId || !collaboratorName) {
      return res.status(400).json({
        success: false,
        error: 'Collaborator ID and name are required'
      });
    }

    await Asset.addCollaborator(
      req.params.id,
      req.user._id,
      collaboratorId,
      collaboratorName
    );

    res.json({
      success: true,
      message: 'Collaborator added'
    });
  } catch (error) {
    console.error('Error adding collaborator:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
