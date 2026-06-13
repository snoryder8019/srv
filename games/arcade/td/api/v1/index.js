/**
 * API v1 root router. Mount everything here so app.js stays thin.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import towersRouter from './routes/towers.js';
import mapsRouter from './routes/maps.js';
import levelsRouter from './routes/levels.js';
import runsRouter from './routes/runs.js';
import uploadsRouter from './routes/uploads.js';
import npcRouter from './routes/npc.js';
import loadoutRouter from './routes/loadout.js';
import adminRouter from './routes/admin.js';
import storiesRouter from './routes/stories.js';
import economyRouter from './routes/economy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'td',
    version: pkg.version,
    time: new Date().toISOString(),
  });
});

router.use('/towers', towersRouter);
router.use('/maps', mapsRouter);
router.use('/levels', levelsRouter);
router.use('/runs', runsRouter);
router.use('/uploads', uploadsRouter);
router.use('/npc', npcRouter);
router.use('/loadout', loadoutRouter);
router.use('/admin', adminRouter);
router.use('/stories', storiesRouter);
router.use('/economy', economyRouter);

export default router;
