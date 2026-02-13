import { Router } from 'express';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Echo endpoint for testing
router.post('/echo', (req, res) => {
  res.json({ received: req.body });
});

// Sandbox data store (in-memory for quick prototyping)
const store = new Map();

router.get('/store/:key', (req, res) => {
  const value = store.get(req.params.key);
  if (value === undefined) {
    return res.status(404).json({ error: 'Key not found' });
  }
  res.json({ key: req.params.key, value });
});

router.put('/store/:key', (req, res) => {
  store.set(req.params.key, req.body.value);
  res.json({ key: req.params.key, value: req.body.value });
});

router.delete('/store/:key', (req, res) => {
  store.delete(req.params.key);
  res.json({ deleted: req.params.key });
});

export default router;
