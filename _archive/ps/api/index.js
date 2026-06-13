import express from 'express';
import v1 from './v1/index.js';

const router = express.Router();

// API root
router.get('/', (req, res) => {
  res.json({
    message: 'Stringborn Universe API',
    version: '0.1.0',
    endpoints: {
      v1: '/api/v1'
    }
  });
});

// Mount v1 routes
router.use('/v1', v1);

export default router;
