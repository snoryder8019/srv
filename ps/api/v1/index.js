import express from 'express';
import charactersRouter from './characters/index.js';
import zonesRouter from './zones/index.js';
import universeRouter from './universe/index.js';
import assetsRouter from './assets/index.js';
import ticketsRouter from './tickets/index.js';

const router = express.Router();

// API v1 root
router.get('/', (req, res) => {
  res.json({
    message: 'Stringborn Universe API v1',
    endpoints: {
      characters: '/api/v1/characters',
      zones: '/api/v1/zones',
      universe: '/api/v1/universe',
      assets: '/api/v1/assets',
      tickets: '/api/v1/tickets'
    }
  });
});

// Mount sub-routes
router.use('/characters', charactersRouter);
router.use('/zones', zonesRouter);
router.use('/universe', universeRouter);
router.use('/assets', assetsRouter);
router.use('/tickets', ticketsRouter);

export default router;
