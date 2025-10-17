import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';
import galacticStateRouter from './galacticState.js';

const router = express.Router();

// Mount galactic state sub-routes
router.use('/', galacticStateRouter);

// Get galactic state view
router.get('/galactic-state', async (req, res) => {
  res.render('universe/galacticState', {
    title: 'Galactic State',
    user: req.user
  });
});

// Get species information
router.get('/species', async (req, res) => {
  try {
    const db = getDb();
    const species = await db.collection('species').find({}).toArray();

    res.render('universe/species', {
      title: 'Species',
      species,
      user: req.user
    });
  } catch (err) {
    console.error('Error fetching species:', err);
    res.status(500).json({ error: 'Failed to fetch species' });
  }
});
router.get('create')
// Planetary handoff system
router.get('/planetary-grid', (req, res) => {
  res.render('universe/planetary-grid', {
    title: 'Planetary Grid System',
    user: req.user
  });
});

export default router;
