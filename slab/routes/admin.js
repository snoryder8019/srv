import express from 'express';
import bcrypt from 'bcrypt';
import { ObjectId } from 'mongodb';
import rateLimit from 'express-rate-limit';
import { requireAdmin, issueAdminJWT } from '../middleware/jwtAuth.js';
import { checkSuperAdmin } from '../middleware/superadmin.js';
import { isSuperAdminEmail } from '../middleware/superadmin.js';
import { getDb, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { config } from '../config/config.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';
import { getUsageBytes, getQuotaBytes, formatBytes, usagePercent, getQuotaLabel } from '../plugins/storage.js';
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
import onboardingRouter from './admin/onboarding.js';
import brandBuilderRouter from './admin/brandBuilder.js';
import scannerRouter from './admin/scanner.js';
import templatesRouter from './admin/templates.js';
import templateStoreRouter from './admin/templateStore.js';
import qrcodesRouter from './admin/qrcodes.js';

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

  // Notification center — open tickets + scan issues + platform announcements
  try {
    const adminEmail = req.adminUser?.email || '';
    const tenantStatus = req.tenant?.status || 'active';

    // Fetch tenant-local counts + platform announcements in parallel
    const slab = getSlabDb();
    const localPromises = req.db ? [
      req.db.collection('tickets').countDocuments({ status: { $in: ['open', 'in-progress', 'escalated'] } }),
      req.db.collection('scan_results').find({}).sort({ 'summary.scannedAt': -1 }).limit(1).toArray(),
    ] : [Promise.resolve(0), Promise.resolve([])];

    const [openTickets, latestScan, platformNotifs] = await Promise.all([
      ...localPromises,
      slab.collection('platform_notifications').find({
        status: 'published',
        $or: [{ audience: 'all' }, { audience: tenantStatus }],
      }).sort({ createdAt: -1 }).limit(20).toArray(),
    ]);

    const scanIssues = Array.isArray(latestScan) ? (latestScan[0]?.summary?.counts || {}) : {};
    const scanTotal = (scanIssues.critical || 0) + (scanIssues.high || 0);

    // Filter out dismissed announcements for this admin
    const activeNotifs = platformNotifs.filter(n => !(n.dismissedBy || []).includes(adminEmail));

    res.locals.notifications = {
      tickets: typeof openTickets === 'number' ? openTickets : 0,
      scanIssues: scanTotal,
      announcements: activeNotifs,
      total: (typeof openTickets === 'number' ? openTickets : 0) + scanTotal + activeNotifs.length,
    };
  } catch {
    res.locals.notifications = { tickets: 0, scanIssues: 0, announcements: [], total: 0 };
  }

  next();
});

// ── Dismiss platform announcement ───────────────────────────────────────────
router.post('/notifications/:id/dismiss', async (req, res) => {
  try {
    const slab = getSlabDb();
    const email = req.adminUser?.email || '';
    if (email) {
      await slab.collection('platform_notifications').updateOne(
        { _id: new ObjectId(req.params.id) },
        { $addToSet: { dismissedBy: email } },
      );
    }
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
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
  // Central auth URL — tenant login pages redirect Google auth to slab.madladslab.com
  const centralAuthUrl = config.DOMAIN + '/auth/login';
  res.render('admin/login', { errorMsg, platformGoogleCid: config.GGLCID || '', centralAuthUrl });
});

// ── Rate limiters ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again in 15 minutes.',
});

// ── Local login POST ─────────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
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
router.post('/register', authLimiter, async (req, res) => {
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
      res.render('admin/login', { errorMsg: null, successMsg: 'Password added to your account. You can now sign in with email or Google.', platformGoogleCid: config.GGLCID || '', centralAuthUrl: config.DOMAIN + '/auth/login' });
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
      res.render('admin/login', { errorMsg: null, successMsg: 'Account created. An administrator must grant you access before you can sign in.', platformGoogleCid: config.GGLCID || '', centralAuthUrl: config.DOMAIN + '/auth/login' });
    }
  } catch (err) {
    console.error('[admin] register error:', err);
    res.render('admin/register', { errorMsg: 'Something went wrong. Please try again.', formData: req.body });
  }
});

// ── Password recovery ─────────────────────────────────────────────────────────
router.post('/recover', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ ok: false, error: 'Email required' });
  try {
    const db = req.db;
    if (!db) return res.json({ ok: false, error: 'Service unavailable' });
    const user = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
    // Always return success to prevent email enumeration
    if (!user) return res.json({ ok: true });

    const { createLoginToken } = await import('../middleware/jwtAuth.js');
    const resetToken = createLoginToken(user, req.tenant?.db, '1h');
    const domain = req.hostname;

    // Send recovery email
    const zohoUser = req.tenant?.public?.zohoUser || process.env.ZOHO_USER;
    const zohoPass = req.tenant?.secrets?.zohoPass || process.env.ZOHO_PASS;
    if (zohoUser && zohoPass) {
      const nodemailer = (await import('nodemailer')).default;
      const transporter = nodemailer.createTransport({
        host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
        auth: { user: zohoUser, pass: zohoPass },
      });
      const resetUrl = `https://${domain}/admin/login?token=${resetToken}`;
      const brandName = req.tenant?.brand?.name || 'Admin';
      await transporter.sendMail({
        from: `"${brandName}" <${zohoUser}>`,
        to: email.trim(),
        subject: `Password recovery — ${brandName}`,
        html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
  <h2 style="font-size:18px;margin-bottom:12px;">Password Recovery</h2>
  <p style="font-size:14px;color:#555;line-height:1.7;margin-bottom:20px;">Click the button below to access your admin panel. Once logged in, you can set a new password from your profile.</p>
  <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#1C2B4A;color:#fff;text-decoration:none;border-radius:4px;font-size:14px;font-weight:600;">Access Admin Panel</a>
  <p style="font-size:12px;color:#999;margin-top:20px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
</div>`,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin] recover error:', err);
    res.json({ ok: false, error: 'Error sending recovery email' });
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

    // Safe JSON parse — /health may return non-JSON on cold start or proxy error
    let data = {};
    try {
      data = await r.json();
    } catch (parseErr) {
      const raw = await r.text().catch(() => '(unreadable)');
      console.error('[ai-health] bad JSON from /health:', parseErr.message, '| body:', raw.slice(0, 200));
      return res.json({ ok: false, cold: true, gpus: [], sd: 'down', error: 'bad_json', detail: raw.slice(0, 200) });
    }

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
    console.error('[ai-health] fetch error:', err.message);
    res.json({ ok: false, cold: false, gpus: [], sd: 'down', error: err.message });
  }
});

router.get('/', async (req, res) => {
  // Redirect to brand builder if setup is incomplete (skip for superadmins, ?setup=complete, or returning from wizard)
  if (req.tenant && !req.tenant.brandSetupComplete && !req.isSuperAdmin && !req.query.setup && !req.query.activated) {
    return res.redirect('/admin/brand-builder');
  }

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

    // Storage usage
    const storageUsed = await getUsageBytes(db);
    const storageQuota = getQuotaBytes(req.tenant);
    const storagePct = usagePercent(storageUsed, req.tenant);

    // What's New TLDR (latest AI-generated summary)
    let whatsNewTldr = null;
    try {
      const slab = getSlabDb();
      whatsNewTldr = await slab.collection('changelog')
        .findOne({ type: 'tldr' }, { sort: { updatedAt: -1 } });
    } catch { /* ignore */ }

    res.render('admin/dashboard', {
      user: req.adminUser,
      stats: { portfolioCount, clientCount, invoiceCount, blogCount, pageCount, openTicketCount },
      agentName,
      whatsNewTldr,
      storage: {
        used: formatBytes(storageUsed),
        quota: getQuotaLabel(req.tenant),
        pct: storagePct,
        plan: req.tenant?.meta?.plan || 'free',
      },
    });
  } catch {
    res.render('admin/dashboard', {
      user: req.adminUser,
      stats: { portfolioCount: 0, clientCount: 0, invoiceCount: 0, blogCount: 0, pageCount: 0, openTicketCount: 0 },
      agentName: 'Assistant',
      whatsNewTldr: null,
      storage: { used: '0 B', quota: '1 GB', pct: 0, plan: 'free' },
    });
  }
});

// ── My Slabs API — returns all slabs this admin email belongs to ─────────────
router.get('/api/my-slabs', async (req, res) => {
  try {
    const email = req.adminUser.email?.toLowerCase();
    if (!email) return res.json({ slabs: [] });

    const slab = getSlabDb();
    const tenants = await slab.collection('tenants').find({
      status: { $in: ['active', 'preview'] },
    }).toArray();

    const slabs = [];
    for (const t of tenants) {
      try {
        const db = getTenantDb(t.db);
        const user = await db.collection('users').findOne({ email });
        if (user && (user.isAdmin || user.isOwner)) {
          slabs.push({
            tenantDb: t.db,
            domain: t.domain,
            brandName: t.brand?.name || t.domain,
            isOwner: user.isOwner || false,
            isAdmin: user.isAdmin || false,
            plan: t.meta?.plan || 'free',
            isPreview: t.status === 'preview',
            isCurrent: t.db === req.tenant?.db,
          });
        }
      } catch { /* skip */ }
    }

    // Sort: current first, then by name
    slabs.sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || a.brandName.localeCompare(b.brandName));

    res.json({ slabs, currentDb: req.tenant?.db || null });
  } catch (err) {
    console.error('[admin] my-slabs error:', err);
    res.json({ slabs: [] });
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
router.use('/onboarding', onboardingRouter);
router.use('/brand-builder', brandBuilderRouter);
router.use('/scanner', scannerRouter);
router.use('/templates', templatesRouter);
router.use('/template-store', templateStoreRouter);
router.use('/qr-codes', qrcodesRouter);

export default router;
