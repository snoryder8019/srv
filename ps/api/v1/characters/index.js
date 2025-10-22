import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { Character } from '../models/Character.js';
import fetch from 'node-fetch';

const router = express.Router();
const MAX_CHARACTERS = 3;
const GAME_STATE_URL = process.env.GAME_STATE_URL || 'https://svc.madladslab.com';

// Get all characters for logged-in user
router.get('/', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const db = getDb();
    const characters = await db.collection('characters')
      .find({ userId: req.user._id.toString() })
      .toArray();

    res.json({ characters });
  } catch (err) {
    console.error('Error fetching characters:', err);
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

// Create new character
router.post('/', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check character count limit
    const existingCharacters = await Character.findByUserId(req.user._id);
    if (existingCharacters.length >= MAX_CHARACTERS) {
      return res.status(400).json({
        error: `Maximum of ${MAX_CHARACTERS} characters reached`,
        maxCharacters: MAX_CHARACTERS,
        currentCount: existingCharacters.length
      });
    }

    const {
      name,
      species,
      stringDomain,
      homeStar,
      homePlanet,
      traits,
      primaryClass
    } = req.body;

    // Create character with location tracking
    const characterData = {
      userId: req.user._id.toString(),
      name,
      species,
      stringDomain,
      homeStar,
      homePlanet,
      traits: traits || [],
      primaryClass,
      location: {
        type: 'galactic',
        x: Math.random() * 5000, // Random spawn in 5000x5000 grid
        y: Math.random() * 5000
      }
    };

    const newCharacter = await Character.create(characterData);

    // Sync to game state service
    try {
      await fetch(`${GAME_STATE_URL}/api/characters/${newCharacter._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _id: newCharacter._id.toString(),
          userId: newCharacter.userId,
          name: newCharacter.name,
          species: newCharacter.species,
          level: newCharacter.level,
          location: newCharacter.location,
          navigation: newCharacter.navigation
        })
      });
    } catch (syncError) {
      console.error('Failed to sync character to game state:', syncError);
      // Don't fail creation if sync fails
    }

    res.status(201).json({ character: newCharacter });
  } catch (err) {
    console.error('Error creating character:', err);
    res.status(500).json({ error: 'Failed to create character' });
  }
});

// Get single character
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ character });
  } catch (err) {
    console.error('Error fetching character:', err);
    res.status(500).json({ error: 'Failed to fetch character' });
  }
});

// Update character
router.put('/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const updateData = { ...req.body };
    delete updateData._id; // Remove _id from update data

    const result = await db.collection('characters').updateOne(
      {
        _id: new ObjectId(req.params.id),
        userId: req.user._id.toString()
      },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ success: true, message: 'Character updated' });
  } catch (err) {
    console.error('Error updating character:', err);
    res.status(500).json({ error: 'Failed to update character' });
  }
});

// Delete character
router.delete('/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const result = await db.collection('characters').deleteOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ success: true, message: 'Character deleted' });
  } catch (err) {
    console.error('Error deleting character:', err);
    res.status(500).json({ error: 'Failed to delete character' });
  }
});

// ===== LOCATION & NAVIGATION ENDPOINTS =====

// Get all characters in galactic view (for map display)
router.get('/galactic/all', async (req, res) => {
  try {
    const characters = await Character.getGalacticCharacters();
    res.json({ characters });
  } catch (err) {
    console.error('Error fetching galactic characters:', err);
    res.status(500).json({ error: 'Failed to fetch galactic characters' });
  }
});

// Update character location
router.post('/:id/location', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { x, y, vx, vy, type, zone, assetId } = req.body;

    // Verify ownership
    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Debug logging
    console.log('=== Location Update Authorization Check ===');
    console.log('Character userId:', character.userId, 'type:', typeof character.userId);
    console.log('Request user._id:', req.user._id, 'type:', typeof req.user._id);
    console.log('Request user._id.toString():', req.user._id.toString());
    console.log('Match result:', character.userId === req.user._id.toString());
    console.log('==========================================');

    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({
        error: 'Not authorized',
        debug: {
          characterUserId: character.userId,
          requestUserId: req.user._id.toString()
        }
      });
    }

    const success = await Character.updateLocation(req.params.id, {
      x, y, vx, vy, type, zone, assetId
    });

    if (!success) {
      return res.status(500).json({ error: 'Failed to update location' });
    }

    res.json({ success: true, message: 'Location updated' });
  } catch (err) {
    console.error('Error updating character location:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Set navigation destination
router.post('/:id/navigate', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { x, y, assetId } = req.body;

    // Verify ownership
    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }
    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const success = await Character.setDestination(req.params.id, { x, y, assetId });

    if (!success) {
      return res.status(500).json({ error: 'Failed to set destination' });
    }

    res.json({ success: true, message: 'Navigation set' });
  } catch (err) {
    console.error('Error setting navigation:', err);
    res.status(500).json({ error: 'Failed to set navigation' });
  }
});

// Cancel navigation
router.post('/:id/navigate/cancel', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify ownership
    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }
    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const success = await Character.cancelNavigation(req.params.id);

    if (!success) {
      return res.status(500).json({ error: 'Failed to cancel navigation' });
    }

    res.json({ success: true, message: 'Navigation cancelled' });
  } catch (err) {
    console.error('Error cancelling navigation:', err);
    res.status(500).json({ error: 'Failed to cancel navigation' });
  }
});

// Get nearby characters
router.get('/:id/nearby', async (req, res) => {
  try {
    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const radius = parseInt(req.query.radius) || 100;
    const nearby = await Character.getNearbyCharacters(
      character.location.x,
      character.location.y,
      radius
    );

    res.json({ characters: nearby });
  } catch (err) {
    console.error('Error fetching nearby characters:', err);
    res.status(500).json({ error: 'Failed to fetch nearby characters' });
  }
});

// ===== TALENT TREE ENDPOINTS =====

// Update character talents
router.put('/:id/talents', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { talents } = req.body;
    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ success: false, error: 'Character not found' });
    }

    // Update talents
    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          'talents.availablePoints': talents.availablePoints,
          'talents.spent': talents.spent,
          'talents.unlocked': talents.unlocked || [],
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ success: false, error: 'Failed to update talents' });
    }

    res.json({ success: true, message: 'Talents updated' });
  } catch (err) {
    console.error('Error updating talents:', err);
    res.status(500).json({ success: false, error: 'Failed to update talents' });
  }
});

// Reset character talents
router.post('/:id/talents/reset', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ success: false, error: 'Character not found' });
    }

    // Calculate total points spent
    const totalSpent = Object.values(character.talents?.spent || {}).reduce((sum, val) => sum + val, 0);
    const currentAvailable = character.talents?.availablePoints || 0;

    // Reset talents and refund points
    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          'talents.availablePoints': currentAvailable + totalSpent,
          'talents.spent': {},
          'talents.unlocked': [],
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ success: false, error: 'Failed to reset talents' });
    }

    res.json({ success: true, message: 'Talents reset', refundedPoints: totalSpent });
  } catch (err) {
    console.error('Error resetting talents:', err);
    res.status(500).json({ success: false, error: 'Failed to reset talents' });
  }
});

// ===== EQUIPMENT ENDPOINTS =====

// Equip item
router.post('/:id/equip', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { slot, itemId } = req.body;
    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ success: false, error: 'Character not found' });
    }

    // TODO: Verify item is in character's inventory and can be equipped in this slot
    // For now, just update the slot

    const validSlots = ['head', 'chest', 'legs', 'feet', 'hands', 'weapon', 'offhand', 'trinket1', 'trinket2'];
    if (!validSlots.includes(slot)) {
      return res.status(400).json({ success: false, error: 'Invalid equipment slot' });
    }

    const updateField = `equipped.${slot}`;
    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          [updateField]: itemId ? { id: itemId, name: req.body.itemName } : null,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ success: false, error: 'Failed to equip item' });
    }

    res.json({ success: true, message: 'Item equipped' });
  } catch (err) {
    console.error('Error equipping item:', err);
    res.status(500).json({ success: false, error: 'Failed to equip item' });
  }
});

// Unequip item
router.post('/:id/unequip', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { slot } = req.body;
    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ success: false, error: 'Character not found' });
    }

    const validSlots = ['head', 'chest', 'legs', 'feet', 'hands', 'weapon', 'offhand', 'trinket1', 'trinket2'];
    if (!validSlots.includes(slot)) {
      return res.status(400).json({ success: false, error: 'Invalid equipment slot' });
    }

    const updateField = `equipped.${slot}`;
    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          [updateField]: null,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ success: false, error: 'Failed to unequip item' });
    }

    res.json({ success: true, message: 'Item unequipped' });
  } catch (err) {
    console.error('Error unequipping item:', err);
    res.status(500).json({ success: false, error: 'Failed to unequip item' });
  }
});

// ===== SHIP INVENTORY ENDPOINTS =====

// Get ship inventory
router.get('/:id/ship', async (req, res) => {
  try {
    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ ship: character.ship || {} });
  } catch (err) {
    console.error('Error fetching ship inventory:', err);
    res.status(500).json({ error: 'Failed to fetch ship inventory' });
  }
});

// Update ship fitting (equip module to slot)
router.post('/:id/ship/fit', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { slotType, slotIndex, module } = req.body;
    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ error: 'Character not found or not authorized' });
    }

    // Validate slot type
    const validSlotTypes = ['highSlots', 'midSlots', 'lowSlots', 'rigSlots'];
    if (!validSlotTypes.includes(slotType)) {
      return res.status(400).json({ error: 'Invalid slot type' });
    }

    const updateField = `ship.fittings.${slotType}.${slotIndex}`;
    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          [updateField]: module,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to update fitting' });
    }

    res.json({ success: true, message: 'Module fitted successfully' });
  } catch (err) {
    console.error('Error updating ship fitting:', err);
    res.status(500).json({ error: 'Failed to update fitting' });
  }
});

// Add item to cargo hold
router.post('/:id/ship/cargo/add', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { item } = req.body;
    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ error: 'Character not found or not authorized' });
    }

    // Check cargo capacity
    const currentCargo = character.ship?.cargoHold?.items || [];
    const currentVolume = currentCargo.reduce((sum, i) => sum + (i.volume || 0) * (i.quantity || 1), 0);
    const itemVolume = (item.volume || 0) * (item.quantity || 1);
    const cargoCapacity = character.ship?.cargoHold?.capacity || 1000;

    if (currentVolume + itemVolume > cargoCapacity) {
      return res.status(400).json({ error: 'Insufficient cargo space' });
    }

    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $push: { 'ship.cargoHold.items': item },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to add item to cargo' });
    }

    res.json({ success: true, message: 'Item added to cargo hold' });
  } catch (err) {
    console.error('Error adding to cargo:', err);
    res.status(500).json({ error: 'Failed to add item to cargo' });
  }
});

// Remove item from cargo hold
router.post('/:id/ship/cargo/remove', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { itemId } = req.body;
    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ error: 'Character not found or not authorized' });
    }

    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $pull: { 'ship.cargoHold.items': { id: itemId } },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to remove item from cargo' });
    }

    res.json({ success: true, message: 'Item removed from cargo hold' });
  } catch (err) {
    console.error('Error removing from cargo:', err);
    res.status(500).json({ error: 'Failed to remove item from cargo' });
  }
});

// Update ship stats/name
router.put('/:id/ship', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { name, hull, capacitor } = req.body;
    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ error: 'Character not found or not authorized' });
    }

    const updateFields = {};
    if (name) updateFields['ship.name'] = name;
    if (hull) updateFields['ship.hull'] = hull;
    if (capacitor) updateFields['ship.capacitor'] = capacitor;
    updateFields.updatedAt = new Date();

    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateFields }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to update ship' });
    }

    res.json({ success: true, message: 'Ship updated successfully' });
  } catch (err) {
    console.error('Error updating ship:', err);
    res.status(500).json({ error: 'Failed to update ship' });
  }
});

// Toggle ship active/inactive status
router.post('/:id/ship/toggle-active', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { ObjectId } = await import('mongodb');
    const db = getDb();

    // Verify ownership
    const character = await db.collection('characters').findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.status(404).json({ error: 'Character not found or not authorized' });
    }

    // Toggle the activeInShip status
    const newStatus = !character.activeInShip;

    const result = await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          activeInShip: newStatus,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to toggle ship status' });
    }

    res.json({
      success: true,
      activeInShip: newStatus,
      message: newStatus ? 'Character is now piloting ship' : 'Character has left ship'
    });
  } catch (err) {
    console.error('Error toggling ship status:', err);
    res.status(500).json({ error: 'Failed to toggle ship status' });
  }
});

export default router;

// Set active character (cookie-based session)
router.post('/:id/set-active', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const character = await Character.findById(req.params.id);
    
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Verify character belongs to user
    if (character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Set cookie with 30-day expiration
    res.cookie('activeCharacterId', req.params.id, {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.json({ 
      success: true,
      message: 'Active character set',
      character: {
        _id: character._id,
        name: character.name,
        level: character.level
      }
    });
  } catch (err) {
    console.error('Error setting active character:', err);
    res.status(500).json({ error: 'Failed to set active character' });
  }
});
