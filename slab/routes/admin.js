import express from 'express';
import { requireAdmin } from '../middleware/jwtAuth.js';
import { getDb } from '../plugins/mongo.js';
import { config } from '../config/config.js';
import portfolioRouter from './admin/portfolio.js';
import clientsRouter from './admin/clients.js';
import copyRouter from './admin/copy.js';
import designRouter from './admin/design.js';
import blogRouter from './admin/blog.js';
import pagesRouter from './admin/pages.js';
import sectionsRouter from './admin/sections.js';
import masterAgentRouter from './admin/masterAgent.js';
import ttsRouter from './admin/tts.js';
import assetsRouter from './admin/assets.js';
import meetingsRouter from './admin/meetings.js';
import bookkeepingRouter from './admin/bookkeeping.js';
import emailMarketingRouter from './admin/emailMarketing.js';
import usersRouter from './admin/users.js';
import tutorialsRouter from './admin/tutorials.js';
import profileRouter from './admin/profile.js';
import settingsRouter from './admin/settings.js';

const router = express.Router();

// Apply requireAdmin to all /admin routes except login
router.use((req, res, next) => {
  if (req.path === '/login') return next();
  requireAdmin(req, res, next);
});

// Inject integration status into all admin views via res.locals
router.use((req, res, next) => {
  const t = req.tenant || {};
  res.locals.integrations = {
    zoho:    !!(t.public?.zohoUser || t.secrets?.zohoUser) && !!t.secrets?.zohoPass,
    stripe:  !!t.secrets?.stripeSecret,
    paypal:  !!t.public?.paypalClientId && !!t.secrets?.paypalSecret,
    google:  !!t.public?.googlePlacesKey,
    oauth:   !!t.public?.googleOAuthClientId && !!t.secrets?.googleOAuthSecret,
    ai:      !!config.OLLAMA_URL && !!config.OLLAMA_KEY,
    s3:      !!config.LINODE_KEY && !!config.LINODE_SECRET,
  };
  next();
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
    const db = req.db;
    const [portfolioCount, clientCount, invoiceCount, blogCount, pageCount, rawDesign] = await Promise.all([
      db.collection('portfolio').countDocuments(),
      db.collection('clients').countDocuments(),
      db.collection('invoices').countDocuments({ status: { $in: ['unpaid', 'sent', 'overdue'] } }),
      db.collection('blog').countDocuments(),
      db.collection('pages').countDocuments(),
      db.collection('design').findOne({ key: 'agent_name' }),
    ]);
    const agentName = rawDesign?.value || 'Assistant';
    res.render('admin/dashboard', {
      user: req.adminUser,
      stats: { portfolioCount, clientCount, invoiceCount, blogCount, pageCount },
      agentName,
    });
  } catch {
    res.render('admin/dashboard', {
      user: req.adminUser,
      stats: { portfolioCount: 0, clientCount: 0, invoiceCount: 0, blogCount: 0, pageCount: 0 },
      agentName: 'Assistant',
    });
  }
});

router.use('/master-agent', masterAgentRouter);
router.use('/tts', ttsRouter);
router.use('/portfolio', portfolioRouter);
router.use('/clients', clientsRouter);
router.use('/copy', copyRouter);
router.use('/design', designRouter);
router.use('/blog', blogRouter);
router.use('/pages', pagesRouter);
router.use('/sections', sectionsRouter);
router.use('/assets', assetsRouter);
router.use('/meetings', meetingsRouter);
router.use('/bookkeeping', bookkeepingRouter);
router.use('/email-marketing', emailMarketingRouter);
router.use('/users', usersRouter);
router.use('/tutorials', tutorialsRouter);
router.use('/profile', profileRouter);
router.use('/settings', settingsRouter);

export default router;
