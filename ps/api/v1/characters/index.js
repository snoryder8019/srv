import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { Character } from '../models/Character.js';
import fetch from 'node-fetch';
import { createActivityToken } from '../../../utilities/activityTokens.js';

const router = express.Router();
const MAX_CHARACTERS = 3;
const GAME_STATE_URL = process.env.GAME_STATE_URL || 'https://svc.madladslab.com';

// Get all characters for logged-in user
// If ?map=true is provided, return ALL characters with galactic positions for map visualization
router.get('/', async (req, res) => {
  try {
    // Map visualization mode - return all characters with galactic positions
    if (req.query.map === 'true') {
      const db = getDb();
      const characters = await db.collection('characters')
        .find({
          'location.type': 'galactic',
          'location.x': { $exists: true }
        })
        .project({
          _id: 1,
          name: 1,
          location: 1,
          navigation: 1
        })
        .toArray();

      console.log(`🗺️ Map mode: Found ${characters.length} characters with galactic positions`);
      return res.json({ characters });
    }

    // User's own characters
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
    res.status(500).json({ error: 'Failed to fetch characters', details: err.message });
  }
});

// Get current active character
router.get('/current', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const activeCharacterId = req.cookies.activeCharacterId;

    if (!activeCharacterId) {
      return res.json({ success: false, message: 'No active character selected' });
    }

    const db = getDb();
    const { ObjectId } = await import('mongodb');

    const character = await db.collection('characters').findOne({
      _id: new ObjectId(activeCharacterId),
      userId: req.user._id.toString()
    });

    if (!character) {
      return res.json({ success: false, message: 'Character not found or unauthorized' });
    }

    res.json({ success: true, character });
  } catch (err) {
    console.error('Error fetching current character:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch current character' });
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

// Check character sync with game state service
// IMPORTANT: This must come BEFORE /:id route to avoid matching /check as an ID
router.get('/check', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const db = getDb();

    // Get user's characters
    const characters = await db.collection('characters')
      .find({ userId: req.user._id.toString() })
      .toArray();

    // Check game state service status
    let gameStateStatus = 'disconnected';
    let gameStateCharacters = [];

    try {
      // Check if game state service is reachable
      const healthResponse = await fetch(`${GAME_STATE_URL}/health`, {
        timeout: 2000
      });

      if (healthResponse.ok) {
        gameStateStatus = 'connected';

        // Try to get characters from game state
        try {
          const charsResponse = await fetch(`${GAME_STATE_URL}/api/characters`, {
            timeout: 2000
          });

          if (charsResponse.ok) {
            const responseData = await charsResponse.json();
            // Game state service returns {success, characters, timestamp}
            const allChars = responseData.characters || responseData;
            // Filter to current user's characters (only if it's an array)
            if (Array.isArray(allChars)) {
              gameStateCharacters = allChars.filter(c => c.userId === req.user._id.toString());
            }
          }
        } catch (err) {
          console.log('Could not fetch characters from game state:', err.message);
          // Service is connected but characters endpoint may not exist yet
        }
      } else {
        gameStateStatus = 'error';
      }
    } catch (error) {
      console.error('Game state service unreachable:', error.message);
      gameStateStatus = 'unreachable';
    }

    // Compare and identify sync issues
    const localCharacterIds = characters.map(c => c._id.toString());
    const gameStateCharacterIds = gameStateCharacters.map(c => c._id ? c._id.toString() : c._id);

    const missingInGameState = localCharacterIds.filter(id => !gameStateCharacterIds.includes(id));
    const extraInGameState = gameStateCharacterIds.filter(id => !localCharacterIds.includes(id));

    const syncStatus = {
      local: {
        count: characters.length,
        characters: characters.map(c => ({
          _id: c._id,
          name: c.name,
          level: c.level,
          activeInShip: c.activeInShip || false
        }))
      },
      gameState: {
        status: gameStateStatus,
        count: gameStateCharacters.length,
        characters: gameStateCharacters.map(c => ({
          _id: c._id,
          name: c.name,
          level: c.level || 1
        }))
      },
      sync: {
        inSync: missingInGameState.length === 0 && extraInGameState.length === 0,
        missingInGameState: missingInGameState.length,
        extraInGameState: extraInGameState.length,
        issues: [
          ...missingInGameState.map(id => ({
            type: 'missing_in_game_state',
            characterId: id,
            message: 'Character exists locally but not in game state service'
          })),
          ...extraInGameState.map(id => ({
            type: 'extra_in_game_state',
            characterId: id,
            message: 'Character exists in game state but not locally'
          }))
        ]
      }
    };

    res.json(syncStatus);
  } catch (err) {
    console.error('Error checking character sync:', err);
    res.status(500).json({ error: 'Failed to check sync status' });
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

// Update character location (for travel)
router.put('/:id/location', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { x, y, z, type, assetId, zone } = req.body;

    if (x === undefined || y === undefined) {
      return res.status(400).json({ success: false, error: 'X and Y coordinates required' });
    }

    const db = getDb();
    const { ObjectId } = await import('mongodb');

    // Build location object
    const location = {
      x: parseFloat(x),
      y: parseFloat(y),
      z: z !== undefined ? parseFloat(z) : 0,
      type: type || 'galactic'
    };

    if (assetId) location.assetId = assetId;
    if (zone) location.zone = zone;

    // Update character location
    const result = await db.collection('characters').updateOne(
      {
        _id: new ObjectId(req.params.id),
        userId: req.user._id.toString()
      },
      { $set: { location } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Character not found or unauthorized' });
    }

    console.log(`📍 Character ${req.params.id} moved to (${x}, ${y}, ${z})`);

    res.json({
      success: true,
      message: 'Location updated',
      location
    });
  } catch (err) {
    console.error('Error updating character location:', err);
    res.status(500).json({ success: false, error: 'Failed to update location' });
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
    // Check authentication
    if (!req.user) {
      console.error('[LOCATION] Authentication failed - no req.user');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { x, y, vx, vy, type, zone, assetId } = req.body;
    console.log('[LOCATION] Update request:', {
      characterId: req.params.id,
      userId: req.user._id?.toString(),
      position: { x, y }
    });

    // Verify ownership - with detailed error handling
    let character;
    try {
      character = await Character.findById(req.params.id);
    } catch (findError) {
      console.error('[LOCATION] Character.findById error:', findError);
      return res.status(500).json({
        error: 'Database error finding character',
        details: findError.message
      });
    }

    if (!character) {
      console.error('[LOCATION] Character not found:', req.params.id);
      return res.status(404).json({ error: 'Character not found' });
    }

    // Authorization check with safe string conversion
    let characterUserId, requestUserId;
    try {
      characterUserId = character.userId?.toString() || character.userId;
      requestUserId = req.user._id?.toString() || req.user._id;

      console.log('[LOCATION] Authorization check:', {
        characterUserId,
        requestUserId,
        match: characterUserId === requestUserId
      });
    } catch (authError) {
      console.error('[LOCATION] Authorization check error:', authError);
      return res.status(500).json({
        error: 'Authorization check failed',
        details: authError.message
      });
    }

    if (characterUserId !== requestUserId) {
      console.error('[LOCATION] Authorization failed:', { characterUserId, requestUserId });
      return res.status(403).json({
        error: 'Not authorized',
        debug: { characterUserId, requestUserId }
      });
    }

    // Update location with detailed error handling
    let success;
    try {
      success = await Character.updateLocation(req.params.id, {
        x, y, vx, vy, type, zone, assetId
      });
    } catch (updateError) {
      console.error('[LOCATION] Character.updateLocation error:', updateError);
      return res.status(500).json({
        error: 'Database error updating location',
        details: updateError.message
      });
    }

    if (!success) {
      console.error('[LOCATION] Update returned false');
      return res.status(500).json({ error: 'Failed to update location' });
    }

    console.log('[LOCATION] Update successful');
    res.json({ success: true, message: 'Location updated' });
  } catch (err) {
    console.error('[LOCATION] Unexpected error:', err);
    res.status(500).json({
      error: 'Failed to update location',
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
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

// ===== ASSET-BASED LOCATION ENDPOINTS =====

// Dock at an asset
router.post('/:id/dock', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { assetId } = req.body;
    if (!assetId) {
      return res.status(400).json({ error: 'assetId is required' });
    }

    // Verify ownership
    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }
    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await Character.dockAtAsset(req.params.id, assetId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error('Error docking at asset:', err);
    res.status(500).json({ error: 'Failed to dock at asset' });
  }
});

// Undock from current asset
router.post('/:id/undock', async (req, res) => {
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

    const success = await Character.undock(req.params.id);

    if (success) {
      res.json({ success: true, message: 'Undocked successfully' });
    } else {
      res.status(500).json({ error: 'Failed to undock' });
    }
  } catch (err) {
    console.error('Error undocking:', err);
    res.status(500).json({ error: 'Failed to undock' });
  }
});

// Navigate to asset
router.post('/:id/navigate-to-asset', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { assetId } = req.body;
    if (!assetId) {
      return res.status(400).json({ error: 'assetId is required' });
    }

    // Verify ownership
    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }
    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await Character.navigateToAsset(req.params.id, assetId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error('Error navigating to asset:', err);
    res.status(500).json({ error: 'Failed to navigate to asset' });
  }
});

// Get characters at specific asset
router.get('/at-asset/:assetId', async (req, res) => {
  try {
    const characters = await Character.getCharactersAtAsset(req.params.assetId);
    res.json({ characters });
  } catch (err) {
    console.error('Error fetching characters at asset:', err);
    res.status(500).json({ error: 'Failed to fetch characters at asset' });
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

    // Create activity token (this will invalidate any existing tokens for this character)
    const tokenResult = await createActivityToken(req.user._id, req.params.id);

    if (!tokenResult.success) {
      console.error('Failed to create activity token:', tokenResult.error);
      return res.status(500).json({ error: 'Failed to create activity session' });
    }

    // Set activity token cookie
    res.cookie('activityToken', tokenResult.token, {
      maxAge: 20 * 60 * 1000, // 20 minutes
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Set activeCharacterId cookie (match activity token duration)
    res.cookie('activeCharacterId', req.params.id, {
      maxAge: 20 * 60 * 1000, // 20 minutes
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.json({
      success: true,
      message: 'Active character set',
      expiresAt: tokenResult.expiresAt,
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

// Teleport character to predefined location (for testers/admins)
router.post('/:id/teleport', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { locationName, x, y } = req.body;

    // Verify ownership or admin/tester status
    const character = await Character.findById(req.params.id);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const isOwner = character.userId === req.user._id.toString();
    const isTesterOrAdmin = req.user.isTester === true || req.user.isAdmin === true;

    if (!isOwner && !isTesterOrAdmin) {
      return res.status(403).json({ error: 'Not authorized to teleport this character' });
    }

    // Get location from config or use custom coordinates
    let targetLocation;
    if (locationName) {
      const { getLocation } = await import('../../../config/starting-locations.js');
      const location = getLocation(locationName);
      if (!location) {
        return res.status(400).json({ error: 'Invalid location name' });
      }
      targetLocation = {
        type: location.type || 'galactic',
        x: location.x,
        y: location.y,
        vx: 0,
        vy: 0
      };
    } else if (x !== undefined && y !== undefined) {
      targetLocation = {
        type: 'galactic',
        x: parseFloat(x),
        y: parseFloat(y),
        vx: 0,
        vy: 0
      };
    } else {
      return res.status(400).json({ error: 'Either locationName or x,y coordinates required' });
    }

    // Update character location
    await Character.updateLocation(req.params.id, targetLocation);

    // Sync to game state service
    try {
      await fetch(`${GAME_STATE_URL}/api/characters/${req.params.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _id: character._id.toString(),
          userId: character.userId,
          name: character.name,
          level: character.level || 1,
          location: targetLocation,
          navigation: character.navigation || {}
        })
      });
    } catch (syncError) {
      console.error('Failed to sync teleport to game state:', syncError);
      // Don't fail teleport if sync fails
    }

    res.json({
      success: true,
      message: `Teleported to ${locationName || `(${x}, ${y})`}`,
      location: targetLocation
    });
  } catch (err) {
    console.error('Error teleporting character:', err);
    res.status(500).json({ error: 'Failed to teleport character' });
  }
});

// Get available teleport locations
router.get('/teleport/locations', async (req, res) => {
  try {
    const { STARTING_LOCATIONS } = await import('../../../config/starting-locations.js');

    const locations = Object.entries(STARTING_LOCATIONS).map(([name, loc]) => ({
      name,
      x: loc.x,
      y: loc.y,
      description: loc.description,
      faction: loc.faction,
      icon: loc.icon
    }));

    res.json({ success: true, locations });
  } catch (err) {
    console.error('Error getting teleport locations:', err);
    res.status(500).json({ error: 'Failed to get teleport locations' });
  }
});