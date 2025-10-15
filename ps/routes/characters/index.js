import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';

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

    res.render('characters/list', {
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
router.get('/create', (req, res) => {
  if (!req.user) {
    return res.redirect('/auth');
  }
  res.render('characters/create', {
    title: 'Create Character',
    user: req.user
  });
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

    res.render('characters/detail', {
      title: character.name,
      character,
      user: req.user
    });
  } catch (err) {
    console.error('Error fetching character:', err);
    res.status(500).json({ error: 'Failed to fetch character' });
  }
});

export default router;
