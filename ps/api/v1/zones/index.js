import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';

const router = express.Router();

// Get all zones
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const zones = await db.collection('zones').find({}).toArray();
    res.json({ zones });
  } catch (err) {
    console.error('Error fetching zones:', err);
    res.status(500).json({ error: 'Failed to fetch zones' });
  }
});

// Get zone by name
router.get('/:zoneName', async (req, res) => {
  try {
    const db = getDb();
    const zone = await db.collection('zones')
      .findOne({ zoneName: req.params.zoneName });

    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    res.json({ zone });
  } catch (err) {
    console.error('Error fetching zone:', err);
    res.status(500).json({ error: 'Failed to fetch zone' });
  }
});

// Get planetary grid handoff information
router.post('/handoff', async (req, res) => {
  try {
    const { currentGrid, direction } = req.body;

    const db = getDb();
    const planetaryState = await db.collection('planetaryState').findOne({});

    if (!planetaryState || !planetaryState.handoffZones[direction]) {
      return res.status(404).json({ error: 'Handoff zone not found' });
    }

    const handoffData = planetaryState.handoffZones[direction];

    res.json({
      success: true,
      handoff: handoffData
    });
  } catch (err) {
    console.error('Error processing handoff:', err);
    res.status(500).json({ error: 'Failed to process handoff' });
  }
});

export default router;
