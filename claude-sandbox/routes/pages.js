import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.render('index', { title: 'Claude Sandbox' });
});

export default router;
