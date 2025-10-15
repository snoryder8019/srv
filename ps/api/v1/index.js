import express from 'express';
import charactersRouter from './characters/index.js';
import zonesRouter from './zones/index.js';
import universeRouter from './universe/index.js';

const router = express.Router();

// API v1 root
router.get('/', (req, res) => {
  res.json({
    message: 'Stringborn Universe API v1',
    endpoints: {
      characters: '/api/v1/characters',
      zones: '/api/v1/zones',
      universe: '/api/v1/universe'
    }
  });
});

// Mount sub-routes
router.use('/characters', charactersRouter);
router.use('/zones', zonesRouter);
router.use('/universe', universeRouter);

export default router;
