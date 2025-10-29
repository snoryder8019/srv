import express from 'express';

const router = express.Router();

/**
 * Ship Builder API Routes
 * Handles saving, loading, and managing custom ship designs
 */

// Get all ships for a user
router.get('/', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = req.app.locals.db;
    const shipsCollection = db.collection('customShips');

    const ships = await shipsCollection
      .find({ userId: req.user._id })
      .sort({ timestamp: -1 })
      .toArray();

    res.json({
      success: true,
      ships: ships
    });
  } catch (error) {
    console.error('Error fetching ships:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ships'
    });
  }
});

// Get a specific ship by ID
router.get('/:shipId', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const shipsCollection = db.collection('customShips');
    const { ObjectId } = require('mongodb');

    const ship = await shipsCollection.findOne({
      _id: new ObjectId(req.params.shipId)
    });

    if (!ship) {
      return res.status(404).json({
        success: false,
        error: 'Ship not found'
      });
    }

    // Check if user owns this ship
    if (req.user && ship.userId !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.json({
      success: true,
      ship: ship
    });
  } catch (error) {
    console.error('Error fetching ship:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ship'
    });
  }
});

// Save a new ship design
router.post('/save', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const shipData = req.body;

    // Validate ship data
    if (!shipData.name || !shipData.hull || !shipData.engine) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ship data: name, hull, and engine are required'
      });
    }

    // Validate power consumption
    if (shipData.stats && shipData.stats.powerUsed > shipData.stats.power) {
      console.warn(`⚠️ Ship "${shipData.name}" has power deficit: ${shipData.stats.powerUsed}/${shipData.stats.power}`);
    }

    const db = req.app.locals.db;
    const shipsCollection = db.collection('customShips');

    // Prepare ship document
    const shipDocument = {
      userId: req.user._id.toString(),
      username: req.user.username,
      name: shipData.name,
      class: shipData.class || 'custom',
      description: shipData.description || '',
      hull: shipData.hull,
      engine: shipData.engine,
      weapons: shipData.weapons || [],
      customization: shipData.customization || {},
      stats: shipData.stats || {},
      pixelData: shipData.pixelData || null,
      timestamp: new Date(),
      version: '1.0'
    };

    // Insert into database
    const result = await shipsCollection.insertOne(shipDocument);

    console.log(`✅ Ship "${shipData.name}" saved for user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Ship saved successfully',
      shipId: result.insertedId,
      ship: shipDocument
    });
  } catch (error) {
    console.error('Error saving ship:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save ship'
    });
  }
});

// Update an existing ship design
router.put('/:shipId', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = req.app.locals.db;
    const shipsCollection = db.collection('customShips');
    const { ObjectId } = require('mongodb');

    const shipId = req.params.shipId;
    const shipData = req.body;

    // Check if ship exists and user owns it
    const existingShip = await shipsCollection.findOne({
      _id: new ObjectId(shipId),
      userId: req.user._id.toString()
    });

    if (!existingShip) {
      return res.status(404).json({
        success: false,
        error: 'Ship not found or access denied'
      });
    }

    // Update ship document
    const updateData = {
      name: shipData.name || existingShip.name,
      class: shipData.class || existingShip.class,
      description: shipData.description || existingShip.description,
      hull: shipData.hull || existingShip.hull,
      engine: shipData.engine || existingShip.engine,
      weapons: shipData.weapons || existingShip.weapons,
      customization: shipData.customization || existingShip.customization,
      stats: shipData.stats || existingShip.stats,
      pixelData: shipData.pixelData || existingShip.pixelData,
      updatedAt: new Date()
    };

    await shipsCollection.updateOne(
      { _id: new ObjectId(shipId) },
      { $set: updateData }
    );

    console.log(`✅ Ship "${updateData.name}" updated for user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Ship updated successfully',
      ship: { ...existingShip, ...updateData }
    });
  } catch (error) {
    console.error('Error updating ship:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update ship'
    });
  }
});

// Delete a ship design
router.delete('/:shipId', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = req.app.locals.db;
    const shipsCollection = db.collection('customShips');
    const { ObjectId } = require('mongodb');

    const result = await shipsCollection.deleteOne({
      _id: new ObjectId(req.params.shipId),
      userId: req.user._id.toString()
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ship not found or access denied'
      });
    }

    console.log(`🗑️ Ship deleted for user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Ship deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting ship:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete ship'
    });
  }
});

// Get ship component manifest
router.get('/manifest/components', async (req, res) => {
  try {
    // This could be loaded from the file system or database
    // For now, we'll return a reference to the static file
    res.json({
      success: true,
      manifestUrl: '/models/ships/component-manifest.json',
      message: 'Fetch the manifest from the provided URL'
    });
  } catch (error) {
    console.error('Error fetching manifest:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch component manifest'
    });
  }
});

export default router;
