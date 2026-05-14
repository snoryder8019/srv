import express from 'express';

const router = express.Router();

// Google calendar push notifications land here. Configured via watch() — Phase 2.
router.post('/', (req, res) => {
  // headers: x-goog-channel-id, x-goog-resource-id, x-goog-resource-state
  console.log('[google webhook]', req.headers['x-goog-resource-state'], req.headers['x-goog-channel-id']);
  res.sendStatus(200);
});

export default router;
