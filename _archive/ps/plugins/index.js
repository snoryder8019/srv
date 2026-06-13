import express from 'express';
import { authRouter } from './passport/auth.js';
import { router as passportRouter } from './passport/localStrat.js';

const router = express.Router();

// Auth routes
router.use('/', authRouter);
router.use(passportRouter);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

export default router;
