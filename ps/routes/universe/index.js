import express from 'express';
import { getDb } from '../../plugins/mongo/mongo.js';
import galacticStateRouter from './galacticState.js';

const router = express.Router();

// Mount galactic state sub-routes
router.use('/', galacticStateRouter);

// Get galactic state view (streaming version)
router.get('/galactic-state', async (req, res) => {
  res.render('universe/galacticState-stream', {
    title: 'Galactic State - Live',
    user: req.user
  });
});

// Get galactic map view (2D visualization)
router.get('/galactic-map', async (req, res) => {
  res.render('universe/galactic-map', {
    title: 'Galactic Territory Map',
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
