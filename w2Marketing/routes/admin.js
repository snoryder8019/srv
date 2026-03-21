import express from 'express';
import { requireAdmin } from '../middleware/jwtAuth.js';
import { getDb } from '../plugins/mongo.js';
import portfolioRouter from './admin/portfolio.js';
import clientsRouter from './admin/clients.js';
import copyRouter from './admin/copy.js';
import designRouter from './admin/design.js';
import blogRouter from './admin/blog.js';
import pagesRouter from './admin/pages.js';
import sectionsRouter from './admin/sections.js';
import masterAgentRouter from './admin/masterAgent.js';

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
    const [portfolioCount, clientCount, invoiceCount, blogCount, pageCount, rawDesign] = await Promise.all([
      db.collection('w2_portfolio').countDocuments(),
      db.collection('w2_clients').countDocuments(),
      db.collection('w2_invoices').countDocuments({ status: 'unpaid' }),
      db.collection('w2_blog').countDocuments(),
      db.collection('w2_pages').countDocuments(),
      db.collection('w2_design').findOne({ key: 'agent_name' }),
    ]);
    const agentName = rawDesign?.value || 'W2 Assistant';
    res.render('admin/dashboard', {
      user: req.adminUser,
      stats: { portfolioCount, clientCount, invoiceCount, blogCount, pageCount },
      agentName,
    });
  } catch {
    res.render('admin/dashboard', {
      user: req.adminUser,
      stats: { portfolioCount: 0, clientCount: 0, invoiceCount: 0, blogCount: 0, pageCount: 0 },
      agentName: 'W2 Assistant',
    });
  }
});

router.use('/master-agent', masterAgentRouter);
router.use('/portfolio', portfolioRouter);
router.use('/clients', clientsRouter);
router.use('/copy', copyRouter);
router.use('/design', designRouter);
router.use('/blog', blogRouter);
router.use('/pages', pagesRouter);
router.use('/sections', sectionsRouter);

export default router;
