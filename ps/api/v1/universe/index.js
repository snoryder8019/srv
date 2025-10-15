import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';

const router = express.Router();

// Get galactic state
router.get('/galactic-state', async (req, res) => {
  try {
    const db = getDb();
    const galacticState = await db.collection('galacticState').findOne({});

    if (!galacticState) {
      return res.status(404).json({ error: 'Galactic state not found' });
    }

    res.json({ galacticState });
  } catch (err) {
    console.error('Error fetching galactic state:', err);
    res.status(500).json({ error: 'Failed to fetch galactic state' });
  }
});

// Get all species
router.get('/species', async (req, res) => {
  try {
    const db = getDb();
    const species = await db.collection('species').find({}).toArray();
    res.json({ species });
  } catch (err) {
    console.error('Error fetching species:', err);
    res.status(500).json({ error: 'Failed to fetch species' });
  }
});

// Get talent trees
router.get('/talent-trees', async (req, res) => {
  try {
    const db = getDb();
    const talentTrees = await db.collection('talentTrees').findOne({});

    if (!talentTrees) {
      return res.status(404).json({ error: 'Talent trees not found' });
    }

    res.json({ talentTrees });
  } catch (err) {
    console.error('Error fetching talent trees:', err);
    res.status(500).json({ error: 'Failed to fetch talent trees' });
  }
});

// Get planetary state
router.get('/planetary-state', async (req, res) => {
  try {
    const db = getDb();
    const planetaryState = await db.collection('planetaryState').findOne({});

    if (!planetaryState) {
      return res.status(404).json({ error: 'Planetary state not found' });
    }

    res.json({ planetaryState });
  } catch (err) {
    console.error('Error fetching planetary state:', err);
    res.status(500).json({ error: 'Failed to fetch planetary state' });
  }
});

// Get active events
router.get('/events', async (req, res) => {
  try {
    const db = getDb();
    const galacticState = await db.collection('galacticState').findOne({});

    if (!galacticState || !galacticState.activeEvents) {
      return res.json({ events: [] });
    }

    res.json({ events: galacticState.activeEvents });
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

export default router;
