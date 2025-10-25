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

    res.render('auth/index-enhanced', {
      title: 'My Characters',
      characters,
      user: req.user
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

// Ship inventory page
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

    res.render('characters/ship', {
      title: `${character.name}'s Ship`,
      character,
      user: req.user
    });
  } catch (err) {
    console.error('Error loading ship inventory:', err);
    res.status(500).render('error', {
      message: 'Failed to load ship inventory',
      user: req.user
    });
  }
});

export default router;
