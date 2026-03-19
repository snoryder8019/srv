import express from 'express';
import { requireAdmin } from '../middleware/jwtAuth.js';

const router = express.Router();

router.get('/login', (req, res) => {
  const error = req.query.error;
  let errorMsg = null;
  if (error === 'unauthorized') errorMsg = 'Your Google account does not have admin access.';
  if (error === 'oauth') errorMsg = 'Google sign-in failed. Please try again.';
  res.render('admin/login', { errorMsg });
});

router.get('/', requireAdmin, (req, res) => {
  res.render('admin/dashboard', { user: req.adminUser });
});

export default router;
