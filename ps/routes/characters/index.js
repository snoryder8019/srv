import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';
import { Character } from '../../api/v1/models/Character.js';
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
    const { ObjectId } = await import('mongodb');
    const characters = await db.collection('characters')
      .find({ userId: req.user._id.toString() })
      .toArray();

    // Populate location asset names for each character
    for (const character of characters) {
      if (character.location && character.location.assetId) {
        try {
          const asset = await db.collection('assets').findOne(
            { _id: new ObjectId(character.location.assetId) },
            { projection: { title: 1, assetType: 1 } }
          );

          if (asset) {
            character.locationAsset = {
              title: asset.title,
              type: asset.assetType
            };
          }
        } catch (err) {
          console.error('Error fetching location asset:', err);
        }
      }
    }

    // Check if session expired
    const expired = req.query.expired === 'true';
    const reason = req.query.reason;

    res.render('auth/index-enhanced', {
      title: 'My Characters',
      characters,
      user: req.user,
      expired,
      reason
    });
  } catch (err) {
    console.error('Error fetching characters:', err);
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

// Character creation page
router.get('/create', async (req, res) => {
  if (!req.user) {
    return res.redirect('/auth');
  }

  try {
    // Check character count
    const characters = await Character.findByUserId(req.user._id);
    if (characters.length >= MAX_CHARACTERS) {
      return res.render('auth/index-enhanced', {
        title: 'My Characters',
        characters,
        user: req.user,
        error: `You have reached the maximum of ${MAX_CHARACTERS} characters. Delete a character to create a new one.`
      });
    }

    res.render('characters/create', {
      title: 'Create Character',
      user: req.user,
      maxCharacters: MAX_CHARACTERS,
      currentCount: characters.length
    });
  } catch (err) {
    console.error('Error checking character count:', err);
    res.status(500).send('Failed to load character creation page');
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

    // Initialize equipped if it doesn't exist
    if (!character.equipped) {
      character.equipped = {
        head: null,
        chest: null,
        legs: null,
        feet: null,
        hands: null,
        weapon: null,
        offhand: null,
        trinket1: null,
        trinket2: null
      };
    }

    // Populate equipped items with full item details
    if (character.equipped) {
      for (const [slot, equipped] of Object.entries(character.equipped)) {
        if (equipped && equipped.itemId) {
          try {
            const item = await db.collection('items').findOne({
              _id: new ObjectId(equipped.itemId)
            });
            if (item) {
              character.equipped[slot].itemDetails = item;
            }
          } catch (err) {
            console.error(`Error fetching item for slot ${slot}:`, err);
          }
        }
      }
    }

    // Populate location asset if available
    if (character.location && character.location.assetId) {
      try {
        const asset = await db.collection('assets').findOne(
          { _id: new ObjectId(character.location.assetId) },
          { projection: { title: 1, assetType: 1 } }
        );
        if (asset) {
          character.locationAsset = {
            title: asset.title,
            type: asset.assetType
          };
        }
      } catch (err) {
        console.error('Error fetching location asset:', err);
      }
    }

    res.render('characters/detail-enhanced', {
      title: character.name,
      character,
      user: req.user
    });
  } catch (err) {
    console.error('Error fetching character:', err);
    res.status(500).json({ error: 'Failed to fetch character' });
  }
});

/**
 * Sync character to game state service
 */
async function syncCharacterToGameState(character) {
  try {
    const response = await fetch(`${GAME_STATE_URL}/api/characters/${character._id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        _id: character._id.toString(),
        userId: character.userId,
        name: character.name,
        species: character.species,
        level: character.level,
        location: character.location,
        navigation: character.navigation
      })
    });

    if (!response.ok) {
      console.error('Failed to sync character to game state:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error syncing character to game state:', error);
    return false;
  }
}

// Ship inventory page - DEPRECATED: Redirects to inventory modal
router.get('/:id/ship', async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect('/auth');
    }

    const character = await Character.findById(req.params.id);

    if (!character) {
      return res.status(404).render('error', {
        message: 'Character not found',
        user: req.user
      });
    }

    // Verify ownership
    if (character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).render('error', {
        message: 'You do not own this character',
        user: req.user
      });
    }

    // Redirect to character detail page with instruction to open ship inventory
    // The character detail page can detect the ?openInventory=ship query param
    res.redirect(`/characters/${req.params.id}?openInventory=ship`);
  } catch (err) {
    console.error('Error loading ship inventory:', err);
    res.status(500).render('error', {
      message: 'Failed to load ship inventory',
      user: req.user
    });
  }
});

/**
 * Zone-based multiplayer routes
 */

// Enter a zone
router.post('/:id/enter-zone', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const characterId = req.params.id;
    const { zoneId, spawnPoint } = req.body;

    if (!zoneId) {
      return res.status(400).json({ error: 'zoneId is required' });
    }

    // Verify character ownership
    const character = await Character.findById(characterId);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    if (character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You do not own this character' });
    }

    // Enter the zone
    const updatedCharacter = await Character.enterZone(characterId, zoneId, spawnPoint);

    console.log(`✅ Character ${character.name} entered zone ${zoneId}`);

    res.json({
      success: true,
      character: updatedCharacter,
      message: 'Entered zone successfully'
    });
  } catch (err) {
    console.error('❌ Error entering zone:', err);
    res.status(500).json({ error: err.message || 'Failed to enter zone' });
  }
});

// Exit a zone
router.post('/:id/exit-zone', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const characterId = req.params.id;
    const { galacticCoords } = req.body;

    // Verify character ownership
    const character = await Character.findById(characterId);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    if (character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You do not own this character' });
    }

    // Exit the zone
    const updatedCharacter = await Character.exitZone(characterId, galacticCoords);

    console.log(`✅ Character ${character.name} exited zone, returned to galactic`);

    res.json({
      success: true,
      character: updatedCharacter,
      message: 'Exited zone successfully'
    });
  } catch (err) {
    console.error('❌ Error exiting zone:', err);
    res.status(500).json({ error: err.message || 'Failed to exit zone' });
  }
});

// Update position within zone (fast, for real-time movement)
router.post('/:id/update-zone-position', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const characterId = req.params.id;
    const { position } = req.body;

    if (!position || position.x === undefined || position.y === undefined) {
      return res.status(400).json({ error: 'Valid position {x, y} is required' });
    }

    // Verify character ownership
    const character = await Character.findById(characterId);
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    if (character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You do not own this character' });
    }

    // Update position
    const success = await Character.updateZonePosition(characterId, position);

    if (!success) {
      return res.status(500).json({ error: 'Failed to update position' });
    }

    res.json({
      success: true,
      message: 'Position updated'
    });
  } catch (err) {
    console.error('❌ Error updating zone position:', err);
    res.status(500).json({ error: err.message || 'Failed to update position' });
  }
});

// Get all characters in a zone
router.get('/zone/:zoneId/characters', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { zoneId } = req.params;

    const characters = await Character.getCharactersInZone(zoneId);

    res.json({
      success: true,
      characters,
      count: characters.length
    });
  } catch (err) {
    console.error('❌ Error fetching zone characters:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch characters' });
  }
});

export default router;
