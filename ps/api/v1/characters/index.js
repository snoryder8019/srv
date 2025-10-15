import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';

const router = express.Router();

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

    const {
      name,
      species,
      stringDomain,
      homeStar,
      homePlanet,
      traits,
      primaryClass
    } = req.body;

    const db = getDb();
    const newCharacter = {
      userId: req.user._id.toString(),
      name,
      species,
      stringDomain,
      homeStar,
      homePlanet,
      traits,
      primaryClass,
      level: 1,
      stats: {
        strength: 0,
        intelligence: 0,
        agility: 0,
        faith: 0,
        tech: 0
      },
      traitBuffs: {
        passive: [],
        triggered: []
      },
      backpack: {
        items: []
      },
      equipped: {
        weapon: null,
        armor: null,
        trinket: null
      },
      enchantments: [],
      createdAt: new Date()
    };

    const result = await db.collection('characters').insertOne(newCharacter);
    newCharacter._id = result.insertedId;

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

export default router;
