/**
 * Zone View Routes
 * Handles interior zone rendering (starship colonies, stations, etc.)
 */
import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

/**
 * GET /universe/zone/:zoneId
 * View zone interior
 */
router.get('/:zoneId', async (req, res) => {
  try {
    const { zoneId } = req.params;
    const db = getDb();

    // Fetch zone asset
    const zone = await db.collection('assets').findOne({
      _id: new ObjectId(zoneId)
    });

    if (!zone) {
      return res.status(404).render('error', {
        message: 'Zone not found',
        error: { status: 404 }
      });
    }

    // Fetch active character from session
    let character = null;
    if (req.session?.activeCharacterId) {
      character = await db.collection('characters').findOne({
        _id: new ObjectId(req.session.activeCharacterId)
      });
    }

    // If no active character, try to find user's first character
    if (!character && req.user) {
      character = await db.collection('characters').findOne({
        userId: req.user._id.toString()
      });

      // Set as active if found
      if (character) {
        req.session.activeCharacterId = character._id.toString();
      }
    }

    // Fetch parent anomaly if it exists
    let parentAnomaly = null;
    if (zone.hierarchy?.parent) {
      parentAnomaly = await db.collection('assets').findOne({
        _id: new ObjectId(zone.hierarchy.parent)
      });
    }

    // Fetch sprites for this zone
    const sprites = await db.collection('assets').find({
      assetType: 'sprite',
      'hierarchy.parent': new ObjectId(zoneId)
    }).toArray();

    console.log(`🏛️ Zone loaded: ${zone.title}, Character: ${character?.name || 'None'}`);

    res.render('universe/zone', {
      title: zone.title || 'Zone Interior',
      zone,
      character,
      parentAnomaly,
      sprites,
      user: req.user
    });

  } catch (error) {
    console.error('Error loading zone:', error);
    res.status(500).render('error', {
      message: 'Failed to load zone',
      error: { status: 500, stack: error.stack }
    });
  }
});

export default router;
