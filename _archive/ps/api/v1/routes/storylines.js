/**
 * Storyline API Routes
 * Endpoints for fetching storyline assets for TOME display
 */
import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

/**
 * GET /api/v1/storylines/arcs
 * Get all approved storyline arcs
 */
router.get('/arcs', async (req, res) => {
  try {
    const db = getDb();
    const arcs = await db.collection(collections.assets)
      .find({
        assetType: 'storyline_arc',
        status: 'approved'
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      count: arcs.length,
      arcs: arcs
    });
  } catch (error) {
    console.error('Error fetching storyline arcs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch storyline arcs'
    });
  }
});

/**
 * GET /api/v1/storylines/arc/:arcId
 * Get a specific arc with all related assets
 */
router.get('/arc/:arcId', async (req, res) => {
  try {
    const db = getDb();
    const { arcId } = req.params;

    // Get the arc
    const arc = await db.collection(collections.assets).findOne({
      _id: new ObjectId(arcId),
      assetType: 'storyline_arc'
    });

    if (!arc) {
      return res.status(404).json({
        success: false,
        error: 'Storyline arc not found'
      });
    }

    // Get related NPCs
    const npcs = await db.collection(collections.assets)
      .find({
        assetType: 'storyline_npc',
        npc_arc_id: arcId,
        status: 'approved'
      })
      .toArray();

    // Get related quests
    const quests = await db.collection(collections.assets)
      .find({
        assetType: 'storyline_quest',
        quest_arc_id: arcId,
        status: 'approved'
      })
      .toArray();

    // Get related locations
    const locations = await db.collection(collections.assets)
      .find({
        assetType: 'storyline_location',
        location_arc_id: arcId,
        status: 'approved'
      })
      .toArray();

    // Get related scripts
    const scripts = await db.collection(collections.assets)
      .find({
        assetType: 'storyline_script',
        script_arc_id: arcId,
        status: 'approved'
      })
      .toArray();

    res.json({
      success: true,
      arc: arc,
      npcs: npcs,
      quests: quests,
      locations: locations,
      scripts: scripts
    });
  } catch (error) {
    console.error('Error fetching arc details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch arc details'
    });
  }
});

/**
 * GET /api/v1/storylines/all
 * Get all storyline assets organized by type
 */
router.get('/all', async (req, res) => {
  try {
    const db = getDb();

    const arcs = await db.collection(collections.assets)
      .find({ assetType: 'storyline_arc', status: 'approved' })
      .toArray();

    const npcs = await db.collection(collections.assets)
      .find({ assetType: 'storyline_npc', status: 'approved' })
      .toArray();

    const quests = await db.collection(collections.assets)
      .find({ assetType: 'storyline_quest', status: 'approved' })
      .toArray();

    const locations = await db.collection(collections.assets)
      .find({ assetType: 'storyline_location', status: 'approved' })
      .toArray();

    const scripts = await db.collection(collections.assets)
      .find({ assetType: 'storyline_script', status: 'approved' })
      .toArray();

    res.json({
      success: true,
      data: {
        arcs: arcs,
        npcs: npcs,
        quests: quests,
        locations: locations,
        scripts: scripts
      },
      counts: {
        arcs: arcs.length,
        npcs: npcs.length,
        quests: quests.length,
        locations: locations.length,
        scripts: scripts.length,
        total: arcs.length + npcs.length + quests.length + locations.length + scripts.length
      }
    });
  } catch (error) {
    console.error('Error fetching all storylines:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch storylines'
    });
  }
});

export default router;
