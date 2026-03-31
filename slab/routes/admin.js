import express from 'express';
import bcrypt from 'bcrypt';
import { requireAdmin, issueAdminJWT } from '../middleware/jwtAuth.js';
import { checkSuperAdmin } from '../middleware/superadmin.js';
import { isSuperAdminEmail } from '../middleware/superadmin.js';
import { getDb } from '../plugins/mongo.js';
import { config } from '../config/config.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';
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
import docsRouter from './admin/docs.js';
import superRouter from './admin/super.js';
import huginnRouter from './admin/huginn.js';
import ticketsRouter from './admin/tickets.js';

const router = express.Router();

// Apply requireAdmin to all /admin routes except login + register
router.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/register') return next();
  requireAdmin(req, res, next);
});

// Lightweight superadmin detection — sets req.isSuperAdmin for sidebar + super routes
router.use(checkSuperAdmin);

// Inject integration status + brand design into all admin views via res.locals
router.use(async (req, res, next) => {
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

  // Load tenant design settings for admin panel branding
  try {
    const design = { ...DESIGN_DEFAULTS };
    if (req.db) {
      const rows = await req.db.collection('design').find({}).toArray();
      for (const r of rows) design[r.key] = r.value;
    }
    res.locals.brandDesign = enrichDesignContrast(design);
  } catch {
    res.locals.brandDesign = enrichDesignContrast({ ...DESIGN_DEFAULTS });
  }

  next();
});

// ── Password validation ──────────────────────────────────────────────────────
function validatePassword(pw) {
  if (!pw || pw.length < 12) return 'Password must be at least 12 characters.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character.';
  return null;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Login page ───────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  const error = req.query.error;
  let errorMsg = null;
  if (error === 'unauthorized') errorMsg = 'Your account does not have admin access.';
  if (error === 'oauth') errorMsg = 'Google sign-in failed. Please try again.';
  if (error === 'credentials') errorMsg = 'Invalid email or password.';
  res.render('admin/login', { errorMsg });
});

// ── Local login POST ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect('/admin/login?error=credentials');

    const db = req.db;
    const user = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.password) return res.redirect('/admin/login?error=credentials');

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect('/admin/login?error=credentials');

    if (!user.isAdmin) return res.redirect('/admin/login?error=unauthorized');

    issueAdminJWT(user, res, req.tenant?.db, req.hostname);
    res.redirect('/admin');
  } catch (err) {
    console.error('[admin] login error:', err);
    res.redirect('/admin/login?error=credentials');
  }
});

// ── Registration page ────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  res.render('admin/register', { errorMsg: null, formData: {} });
});

// ── Registration POST ────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, password_confirm, displayName } = req.body;
    const formData = { email, displayName };

    if (!email || !validateEmail(email)) {
      return res.render('admin/register', { errorMsg: 'Please enter a valid email address.', formData });
    }

    const pwErr = validatePassword(password);
    if (pwErr) return res.render('admin/register', { errorMsg: pwErr, formData });

    if (password !== password_confirm) {
      return res.render('admin/register', { errorMsg: 'Passwords do not match.', formData });
    }

    const db = req.db;
    const cleanEmail = email.toLowerCase().trim();
    const existing = await db.collection('users').findOne({ email: cleanEmail });
    const hash = await bcrypt.hash(password, 12);

    if (existing) {
      // User exists (e.g. from Google OAuth) — link local password
      if (existing.password && existing.password.length > 10) {
        return res.render('admin/register', { errorMsg: 'This email already has a password set. Use the login page.', formData });
      }
      const providers = [...(existing.providers || []), 'local'].filter((v, i, a) => a.indexOf(v) === i);
      await db.collection('users').updateOne({ _id: existing._id }, {
        $set: { password: hash, providers },
      });
      res.render('admin/login', { errorMsg: null, successMsg: 'Password added to your account. You can now sign in with email or Google.' });
    } else {
      await db.collection('users').insertOne({
        email: cleanEmail,
        displayName: (displayName || '').trim() || cleanEmail.split('@')[0],
        password: hash,
        providers: ['local'],
        isAdmin: false,
        tutorials: { seen: {}, dismissed: {}, autoPlay: true, lastReset: null },
        createdAt: new Date(),
      });
      // New registrations are NOT auto-admin — an existing admin must grant access
      res.render('admin/login', { errorMsg: null, successMsg: 'Account created. An administrator must grant you access before you can sign in.' });
    }
  } catch (err) {
    console.error('[admin] register error:', err);
    res.render('admin/register', { errorMsg: 'Something went wrong. Please try again.', formData: req.body });
  }
});

// AI health check — hits LB /health for GPU, SD, tunnel, and cold-start status
router.get('/ai-health', async (req, res) => {
  try {
    const base = config.OLLAMA_URL.replace(/\/v1\/chat\/completions$/, '');
    const r = await fetch(`${base}/health`, {
      headers: { 'Authorization': `Bearer ${config.OLLAMA_KEY}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return res.json({ ok: false, cold: false, gpus: [], sd: 'down' });
    const data = await r.json();

    const gpus = (data.gpus || []).map(g => ({
      gpu: g.gpu,
      status: g.status,
      cold: !!g.cold,
      active: g.activeRequests || 0,
    }));
    const gpusUp = gpus.filter(g => g.status === 'up');
    const cold = gpusUp.length > 0 && gpusUp.every(g => g.cold);

    res.json({
      ok: gpusUp.length > 0,
      cold,
      gpus,
      sd: data.sd?.status || 'down',
      tunnel: data.tunnel?.status || 'down',
    });
  } catch (err) {
    res.json({ ok: false, cold: false, gpus: [], sd: 'down', error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const [portfolioCount, clientCount, invoiceCount, blogCount, pageCount, openTicketCount, rawDesign] = await Promise.all([
      db.collection('portfolio').countDocuments(),
      db.collection('clients').countDocuments(),
      db.collection('invoices').countDocuments({ status: { $in: ['unpaid', 'sent', 'overdue'] } }),
      db.collection('blog').countDocuments(),
      db.collection('pages').countDocuments(),
      db.collection('tickets').countDocuments({ status: { $in: ['open', 'in-progress', 'escalated'] } }),
      db.collection('design').findOne({ key: 'agent_name' }),
    ]);
    const agentName = rawDesign?.value || 'Assistant';
    res.render('admin/dashboard', {
      user: req.adminUser,
      stats: { portfolioCount, clientCount, invoiceCount, blogCount, pageCount, openTicketCount },
      agentName,
    });
  } catch {
    res.render('admin/dashboard', {
      user: req.adminUser,
      stats: { portfolioCount: 0, clientCount: 0, invoiceCount: 0, blogCount: 0, pageCount: 0, openTicketCount: 0 },
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
router.use('/docs', docsRouter);
router.use('/tickets', ticketsRouter);
router.use('/huginn', huginnRouter);
router.use('/super', superRouter);

export default router;
