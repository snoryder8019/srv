import express from 'express';
import charactersRouter from './characters/index.js';
import zonesRouter from './zones/index.js';
import universeRouter from './universe/index.js';
import assetsRouter from './assets/index.js';
import ticketsRouter from './tickets/index.js';
import planetGenerationRouter from './routes/planet-generation.js';
import inventoryRouter from './inventory/index.js';
import shipRouter from './inventory/ship.js';
import spriteAtlasesRouter from './routes/sprite-atlases.js';
import stateManagerRouter from './routes/state-manager.js';
import activityRouter from './activity/index.js';
import shipsRouter from './ships/index.js';

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
      tickets: '/api/v1/tickets',
      planetGeneration: '/api/v1/planet-generation',
      stateManager: '/api/v1/state',
      activity: '/api/v1/activity',
      ships: '/api/v1/ships'
    }
  });
});

// Mount sub-routes
router.use('/characters', charactersRouter);
router.use('/zones', zonesRouter);
router.use('/universe', universeRouter);
router.use('/assets', assetsRouter);
router.use('/tickets', ticketsRouter);
router.use('/planet-generation', planetGenerationRouter);
router.use('/sprite-atlases', spriteAtlasesRouter);
router.use('/state', stateManagerRouter); // State manager for game state and physics
router.use('/activity', activityRouter); // Activity token management
router.use('/ships', shipsRouter); // Ship builder and custom ships
router.use('/', inventoryRouter); // Inventory routes handle their own /characters/:id/inventory paths
router.use('/', shipRouter); // Ship routes handle their own /characters/:id/ship paths

export default router;
