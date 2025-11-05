/**
 * Asset Hierarchy API
 * Manages hierarchical relationships between assets
 */
import express from 'express';
import { Asset } from '../models/Asset.js';

const router = express.Router();

/**
 * POST /api/v1/hierarchy/link
 * Link child asset to parent asset
 */
router.post('/link', async (req, res) => {
  try {
    const { childId, parentId, parentType } = req.body;

    if (!childId || !parentId || !parentType) {
      return res.json({
        success: false,
        error: 'Missing required fields: childId, parentId, parentType'
      });
    }

    await Asset.linkToParent(childId, parentId, parentType);

    res.json({
      success: true,
      message: `Asset ${childId} linked to parent ${parentId}`
    });

  } catch (error) {
    console.error('❌ Hierarchy link error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/hierarchy/tree/:assetId
 * Get full hierarchy tree starting from asset
 */
router.get('/tree/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;
    const maxDepth = parseInt(req.query.maxDepth) || 5;

    const tree = await Asset.getHierarchyTree(assetId, maxDepth);

    res.json({
      success: true,
      tree: tree
    });

  } catch (error) {
    console.error('❌ Get hierarchy tree error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/hierarchy/ancestors/:assetId
 * Get all ancestors of an asset (path to root)
 */
router.get('/ancestors/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;

    const ancestors = await Asset.getAncestors(assetId);

    res.json({
      success: true,
      ancestors: ancestors
    });

  } catch (error) {
    console.error('❌ Get ancestors error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/hierarchy/descendants/:assetId
 * Get all descendants of an asset
 */
router.get('/descendants/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;
    const maxDepth = parseInt(req.query.maxDepth) || 10;

    const descendants = await Asset.getDescendants(assetId, maxDepth);

    res.json({
      success: true,
      descendants: descendants,
      count: descendants.length
    });

  } catch (error) {
    console.error('❌ Get descendants error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/hierarchy/siblings/:assetId
 * Get siblings of an asset (same parent)
 */
router.get('/siblings/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;

    const siblings = await Asset.getSiblings(assetId);

    res.json({
      success: true,
      siblings: siblings,
      count: siblings.length
    });

  } catch (error) {
    console.error('❌ Get siblings error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/hierarchy/unlink
 * Unlink asset from parent
 */
router.post('/unlink', async (req, res) => {
  try {
    const { childId } = req.body;

    if (!childId) {
      return res.json({
        success: false,
        error: 'Missing required field: childId'
      });
    }

    const result = await Asset.unlinkFromParent(childId);

    res.json({
      success: result,
      message: result ? `Asset ${childId} unlinked from parent` : 'Asset has no parent or not found'
    });

  } catch (error) {
    console.error('❌ Hierarchy unlink error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/hierarchy/move
 * Move asset to new parent
 */
router.post('/move', async (req, res) => {
  try {
    const { childId, newParentId, newParentType } = req.body;

    if (!childId || !newParentId || !newParentType) {
      return res.json({
        success: false,
        error: 'Missing required fields: childId, newParentId, newParentType'
      });
    }

    await Asset.moveToNewParent(childId, newParentId, newParentType);

    res.json({
      success: true,
      message: `Asset ${childId} moved to new parent ${newParentId}`
    });

  } catch (error) {
    console.error('❌ Hierarchy move error:', error);
    res.json({ success: false, error: error.message });
  }
});

export default router;
