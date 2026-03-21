import express from 'express';
import { requireAdmin } from '../middleware/jwtAuth.js';
import { getDb } from '../plugins/mongo.js';
import portfolioRouter from './admin/portfolio.js';
import clientsRouter from './admin/clients.js';
import copyRouter from './admin/copy.js';

const router = express.Router();

// Apply requireAdmin to all /admin routes except login
router.use((req, res, next) => {
  if (req.path === '/login') return next();
  requireAdmin(req, res, next);
});

router.get('/login', (req, res) => {
  const error = req.query.error;
  let errorMsg = null;
  if (error === 'unauthorized') errorMsg = 'Your Google account does not have admin access.';
  if (error === 'oauth') errorMsg = 'Google sign-in failed. Please try again.';
  res.render('admin/login', { errorMsg });
});

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const [portfolioCount, clientCount, invoiceCount] = await Promise.all([
      db.collection('w2_portfolio').countDocuments(),
      db.collection('w2_clients').countDocuments(),
      db.collection('w2_invoices').countDocuments({ status: 'unpaid' }),
    ]);
    res.render('admin/dashboard', { user: req.adminUser, stats: { portfolioCount, clientCount, invoiceCount } });
  } catch {
    res.render('admin/dashboard', { user: req.adminUser, stats: { portfolioCount: 0, clientCount: 0, invoiceCount: 0 } });
  }
});

router.use('/portfolio', portfolioRouter);
router.use('/clients', clientsRouter);
router.use('/copy', copyRouter);

export default router;
