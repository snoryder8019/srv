/**
 * Slab — Superadmin Panel
 * /superadmin                → dashboard (all tenants, revenue, signups)
 * /superadmin/login          → Google OAuth login
 * /superadmin/tenants        → tenant list + management
 * /superadmin/tenants/:id    → tenant detail + actions
 * /superadmin/promos         → promo offer management
 * /superadmin/promos/send    → send promo email
 * /superadmin/signups        → marketing signup data
 */

import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../middleware/superadmin.js';
import { bustTenantCache } from '../middleware/tenant.js';
import { createLoginToken } from '../middleware/jwtAuth.js';
import { config } from '../config/config.js';
import nodemailer from 'nodemailer';
import { logActivity, getActivityLogs } from '../plugins/activityLog.js';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getServices, getServicesByCategory, getService, PRODUCTS } from '../plugins/serviceRegistry.js';
import scottsGatewayRouter, { redeemTvPair, tvOrSuper, missionControlHandler, publicPairRequest, publicPairPoll } from './superadmin/scottsGateway.js';

const router = express.Router();

// ── Tenant tag definitions ─────────────────────────────────────────────────
const TENANT_TAGS = {
  vip:              { label: 'VIP',              color: '#c9a848', bg: '#2a2410' },
  'hot-lead':       { label: 'Hot Lead',         color: '#f97316', bg: '#431407' },
  'needs-onboarding': { label: 'Needs Onboarding', color: '#38bdf8', bg: '#0c2d48' },
  'needs-design':   { label: 'Needs Design',     color: '#a78bfa', bg: '#1e1540' },
  'needs-content':  { label: 'Needs Content',    color: '#34d399', bg: '#052e1c' },
  'at-risk':        { label: 'At Risk',          color: '#f87171', bg: '#451a1a' },
  enterprise:       { label: 'Enterprise',       color: '#e2e8f0', bg: '#1e293b' },
  'power-user':     { label: 'Power User',       color: '#facc15', bg: '#362f05' },
};

// ── Subscription-change courtesy email ──────────────────────────────────────
const PLAN_LABELS = {
  free: 'Free',
  monthly: 'Monthly',
  '30day': '30-Day',
  '120day': '120-Day',
  annual: 'Annual',
  lifetime: 'Lifetime',
};

async function sendSubscriptionEmail(tenant, action, plan) {
  const to = tenant.meta?.ownerEmail;
  if (!to) return;
  const zohoUser = process.env.ZOHO_USER;
  const zohoPass = process.env.ZOHO_PASS;
  if (!zohoUser || !zohoPass) return;

  const brandName = tenant.brand?.name || tenant.domain || 'your site';
  const planLabel = PLAN_LABELS[plan] || plan;

  let subject, body;
  if (action === 'activated') {
    subject = `Your sLab subscription is now active — ${planLabel} plan`;
    body = `<p>Hi there,</p>
<p>Great news! Your site <strong>${brandName}</strong> has been activated on the <strong>${planLabel}</strong> plan.</p>
<p>You now have full access to all features included in your plan. Log in to your admin panel to get started.</p>
<p>If you have any questions, just reply to this email.</p>
<p>— The sLab Team</p>`;
  } else if (action === 'plan-changed') {
    subject = `Your sLab plan has been updated to ${planLabel}`;
    body = `<p>Hi there,</p>
<p>This is a courtesy notice that the subscription plan for <strong>${brandName}</strong> has been changed to <strong>${planLabel}</strong>.</p>
${plan === 'free' ? '<p>Your site has been moved to preview mode. Upgrade anytime from your admin panel.</p>' : '<p>Your new plan is effective immediately.</p>'}
<p>If you have questions or believe this was a mistake, just reply to this email.</p>
<p>— The sLab Team</p>`;
  } else if (action === 'suspended') {
    subject = 'Your sLab subscription has been suspended';
    body = `<p>Hi there,</p>
<p>This is to let you know that your site <strong>${brandName}</strong> has been suspended.</p>
<p>If you believe this is an error or would like to reactivate your account, please reply to this email and we'll get it sorted out.</p>
<p>— The sLab Team</p>`;
  } else {
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
      auth: { user: zohoUser, pass: zohoPass },
    });
    await transporter.sendMail({
      from: `"sLab Platform" <${zohoUser}>`,
      to,
      subject,
      html: body,
    });
    console.log(`[superadmin] Subscription email sent to ${to} (${action})`);
  } catch (err) {
    console.error(`[superadmin] Subscription email failed for ${to}:`, err.message);
  }
}

// ── Login ───────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.render('superadmin/login', { error: req.query.error || null });
});

// Redirect to shared OAuth flow
router.get('/auth/google', (req, res) => {
  res.redirect('/auth/google/superadmin');
});

router.get('/logout', (req, res) => {
  const domain = config.NODE_ENV === 'production' ? '.madladslab.com' : undefined;
  if (domain) res.clearCookie('slab_token', { domain });
  res.clearCookie('slab_token');
  res.redirect('/superadmin/login');
});

// ── Public subscriber capture (no auth) ───────────────────────────────────
router.get('/subscribe', (req, res) => {
  res.render('superadmin/subscribe', { success: req.query.success || null });
});

router.post('/subscribe', async (req, res) => {
  const { email, name, interest, source } = req.body;
  if (!email?.trim()) return res.redirect('/superadmin/subscribe');
  const slab = getSlabDb();
  await slab.collection('subscribers').updateOne(
    { email: email.toLowerCase().trim() },
    {
      $set: { email: email.toLowerCase().trim(), name: name?.trim() || '', interest: interest || 'general', source: source || 'direct', updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date(), status: 'active' },
    },
    { upsert: true },
  );
  res.redirect('/superadmin/subscribe?success=1');
});

// ── All routes below require superadmin ─────────────────────────────────────
// ── scottsGateway: public TV-pair endpoints + mission-control bypass requireSuperAdmin.
// TV is unauthenticated until it pairs; phone is authenticated for the redeem.
// no-cache on every Gateway response so design changes don't need a hard-refresh.
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
}
router.post('/scottsGateway/api/pair/request', noStore, publicPairRequest);
router.get('/scottsGateway/api/pair/poll/:code', noStore, publicPairPoll);
router.get('/scottsGateway/tv/:code', noStore, redeemTvPair);
router.get('/scottsGateway/mission-control', noStore, tvOrSuper, missionControlHandler);
// Read-only API endpoints the mission-control page polls — TV cookie acceptable.
router.get('/scottsGateway/api/stream',        tvOrSuper, (req, res, next) => { req.url = '/api/stream';        scottsGatewayRouter.handle(req, res, next); });
router.get('/scottsGateway/api/aggregate',     tvOrSuper, (req, res, next) => { req.url = '/api/aggregate';     scottsGatewayRouter.handle(req, res, next); });
router.get('/scottsGateway/api/local-events',  tvOrSuper, (req, res, next) => { req.url = '/api/local-events';  scottsGatewayRouter.handle(req, res, next); });
router.get('/scottsGateway/api/tasks',          tvOrSuper, (req, res, next) => { req.url = '/api/tasks';          scottsGatewayRouter.handle(req, res, next); });
router.get('/scottsGateway/api/feeds',          tvOrSuper, (req, res, next) => { req.url = '/api/feeds';          scottsGatewayRouter.handle(req, res, next); });
router.get('/scottsGateway/api/assets/mission-control', tvOrSuper, (req, res, next) => { req.url = '/api/assets/mission-control'; scottsGatewayRouter.handle(req, res, next); });
router.get('/scottsGateway/api/finance/history', tvOrSuper, (req, res, next) => { req.url = '/api/finance/history'; scottsGatewayRouter.handle(req, res, next); });
router.get('/scottsGateway/api/interests',        tvOrSuper, (req, res, next) => { req.url = '/api/interests';        scottsGatewayRouter.handle(req, res, next); });
router.get('/scottsGateway/api/review/pending',   tvOrSuper, (req, res, next) => { req.url = '/api/review/pending';   scottsGatewayRouter.handle(req, res, next); });

router.use(requireSuperAdmin);

// Private family-ops cockpit — only Scott + spouse (additional allowlist inside).
router.use('/scottsGateway', scottsGatewayRouter);

// ── Dashboard (unified panel — services, tenants, tools, agents, activity) ──
router.get('/', async (req, res) => {
  const slab = getSlabDb();
  const [tenants, recentSignups, activityLogs] = await Promise.all([
    slab.collection('tenants').find().sort({ 'meta.lastSeenAt': -1, createdAt: -1 }).toArray(),
    slab.collection('signups').find().sort({ createdAt: -1 }).limit(10).toArray(),
    getActivityLogs({ limit: 30 }),
  ]);

  const active = tenants.filter(t => t.status === 'active').length;
  const preview = tenants.filter(t => t.status === 'preview' || !t.status).length;
  const suspended = tenants.filter(t => t.status === 'suspended').length;

  const services = getServices();
  const servicesByCategory = getServicesByCategory();
  const aliveCount = services.filter(s => s.alive === true).length;
  const deadCount = services.filter(s => s.alive === false).length;

  // ── Fetch OpsTrain data ──
  let opsData = { brands: [], users: [], stats: {} };
  try {
    const opsDb = getTenantDb('opsTrain');
    const [opsBrands, opsUsers, opsTasks, opsQr] = await Promise.all([
      opsDb.collection('brands').find().sort({ name: 1 }).toArray(),
      opsDb.collection('users').find().toArray(),
      opsDb.collection('tasks').find({ active: true }).toArray(),
      opsDb.collection('qrcodes').find({ active: true }).toArray(),
    ]);
    opsData.brands = opsBrands.map(b => ({
      ...b,
      userCount: opsUsers.filter(u => u.brand?.toString() === b._id.toString()).length,
      taskCount: opsTasks.filter(t => t.brand?.toString() === b._id.toString()).length,
      qrCount: opsQr.filter(q => q.brand?.toString() === b._id.toString()).length,
    }));
    opsData.users = opsUsers;
    opsData.stats = {
      totalBrands: opsBrands.length,
      activeBrands: opsBrands.filter(b => b.active !== false).length,
      totalUsers: opsUsers.length,
      admins: opsUsers.filter(u => u.role === 'admin' || u.role === 'superadmin').length,
      managers: opsUsers.filter(u => u.role === 'manager').length,
    };
  } catch (err) { console.error('[superadmin] OpsTrain fetch error:', err.message); }

  // ── Fetch Games data (games.madladslab.com — DB: test) ──
  let gamesData = { users: [], stats: {} };
  try {
    const gamesDb = getTenantDb('test');
    const gamesUsers = await gamesDb.collection('users').find().toArray();
    gamesData.users = gamesUsers;
    gamesData.stats = {
      totalUsers: gamesUsers.length,
      admins: gamesUsers.filter(u => u.isAdmin).length,
      broadcasters: gamesUsers.filter(u => u.isBroadcaster).length,
      gameAdmins: gamesUsers.filter(u => u.permissions?.games === 'admin').length,
    };
  } catch (err) { console.error('[superadmin] Games fetch error:', err.message); }

  // ── Fetch Stringborn data (ps.madladslab.com — DB: projectStringborne) ──
  let stringbornData = { users: [], stats: {} };
  try {
    const psDb = getTenantDb('projectStringborne');
    const psUsers = await psDb.collection('users').find().toArray();
    const psChars = await psDb.collection('characters').find().toArray();
    stringbornData.users = psUsers;
    stringbornData.stats = {
      totalUsers: psUsers.length,
      admins: psUsers.filter(u => u.isAdmin).length,
      testers: psUsers.filter(u => u.userRole === 'tester').length,
      characters: psChars.length,
    };
  } catch (err) { console.error('[superadmin] Stringborn fetch error:', err.message); }

  res.render('superadmin/dashboard', {
    user: req.superAdmin,
    services,
    servicesByCategory,
    totalServices: services.length,
    aliveCount,
    deadCount,
    tenants,
    stats: {
      total: tenants.length, active, preview, suspended,
      promo: tenants.filter(t => t.meta?.isPromo).length,
      mrr: tenants.filter(t => t.status === 'active' && !t.meta?.isPromo).length * 50,
    },
    recentSignups,
    tagDefs: TENANT_TAGS,
    activityLogs,
    selectedService: req.query.service || 'all',
    opsData,
    gamesData,
    stringbornData,
  });
});

// ── Tenant detail ───────────────────────────────────────────────────────────
router.get('/tenants/:id', async (req, res) => {
  const slab = getSlabDb();
  let tenant;
  try {
    tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  } catch { return res.redirect('/superadmin'); }
  if (!tenant) return res.redirect('/superadmin');

  // Get tenant DB stats + activity logs in parallel
  const tenantDb = getTenantDb(tenant.db);
  const [blogCount, clientCount, pageCount, invoiceCount, activityLogs] = await Promise.all([
    tenantDb.collection('blog').countDocuments().catch(() => 0),
    tenantDb.collection('clients').countDocuments().catch(() => 0),
    tenantDb.collection('pages').countDocuments().catch(() => 0),
    tenantDb.collection('invoices').countDocuments().catch(() => 0),
    getActivityLogs({ tenantDomain: tenant.domain, limit: 30 }),
  ]);

  res.render('superadmin/tenant-detail', {
    user: req.superAdmin,
    tenant,
    dbStats: { blogCount, clientCount, pageCount, invoiceCount },
    tagDefs: TENANT_TAGS,
    activityLogs,
  });
});

// ── Tenant actions ──────────────────────────────────────────────────────────
router.post('/tenants/:id/activate', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/superadmin');

  const plan = req.body.plan || 'monthly';
  let expiresAt = null;
  const now = new Date();
  if (plan === 'monthly') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  else if (plan === '30day') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  else if (plan === '120day') expiresAt = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  else if (plan === 'annual') expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  // lifetime = null (no expiry)

  await slab.collection('tenants').updateOne(
    { _id: tenant._id },
    {
      $set: {
        status: 'active',
        'meta.plan': plan,
        'meta.activatedAt': now,
        'meta.expiresAt': expiresAt,
        updatedAt: now,
      },
    }
  );
  bustTenantCache(tenant.domain);
  sendSubscriptionEmail(tenant, 'activated', plan).catch(() => {});
  logActivity({
    category: 'admin_action', action: 'activated',
    tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { plan, expiresAt, previousStatus: tenant.status },
  });
  res.redirect(`/superadmin/tenants/${req.params.id}`);
});

router.post('/tenants/:id/change-plan', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/superadmin');

  const plan = req.body.plan || 'monthly';
  let expiresAt = null;
  const now = new Date();
  if (plan === 'monthly') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  else if (plan === '30day') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  else if (plan === '120day') expiresAt = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  else if (plan === 'annual') expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  // lifetime = null (no expiry), free = null + deactivate

  const update = {
    'meta.plan': plan,
    'meta.expiresAt': expiresAt,
    updatedAt: now,
  };

  // Downgrading to free → set status back to preview
  if (plan === 'free') {
    update.status = 'preview';
    update['meta.plan'] = 'free';
    update['meta.expiresAt'] = null;
  }

  await slab.collection('tenants').updateOne(
    { _id: tenant._id },
    { $set: update }
  );
  bustTenantCache(tenant.domain);
  sendSubscriptionEmail(tenant, 'plan-changed', plan).catch(() => {});
  logActivity({
    category: 'admin_action', action: 'plan_changed',
    tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { newPlan: plan, previousPlan: tenant.meta?.plan },
  });
  res.redirect(`/superadmin/tenants/${req.params.id}`);
});

router.post('/tenants/:id/suspend', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/superadmin');
  await slab.collection('tenants').updateOne(
    { _id: tenant._id },
    { $set: { status: 'suspended', updatedAt: new Date() } }
  );
  bustTenantCache(tenant.domain);
  sendSubscriptionEmail(tenant, 'suspended', null).catch(() => {});
  logActivity({
    category: 'admin_action', action: 'suspended',
    tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { previousStatus: tenant.status, previousPlan: tenant.meta?.plan },
  });
  res.redirect(`/superadmin/tenants/${req.params.id}`);
});

router.post('/tenants/:id/delete', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/superadmin');
  await slab.collection('tenants').deleteOne({ _id: tenant._id });
  bustTenantCache(tenant.domain);
  logActivity({
    category: 'admin_action', action: 'deleted',
    tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
    actor: { email: req.superAdmin.email, role: 'superadmin' },
    details: { brandName: tenant.brand?.name, plan: tenant.meta?.plan },
  });
  res.redirect('/superadmin');
});

// ── Tenant tags ────────────────────────────────────────────────────────────
router.post('/tenants/:id/tags', async (req, res) => {
  const { tag, action } = req.body;
  if (!tag || !TENANT_TAGS[tag]) return res.redirect(`/superadmin/tenants/${req.params.id}`);

  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/superadmin');

  const op = action === 'remove'
    ? { $pull: { tags: tag }, $set: { updatedAt: new Date() } }
    : { $addToSet: { tags: tag }, $set: { updatedAt: new Date() } };

  await slab.collection('tenants').updateOne({ _id: tenant._id }, op);
  bustTenantCache(tenant.domain);

  // Support AJAX toggle from dashboard (returns JSON) or form post from detail page
  if (req.headers.accept?.includes('application/json')) {
    return res.json({ ok: true });
  }
  res.redirect(`/superadmin/tenants/${req.params.id}`);
});

router.post('/tenants/:id/toggle-promo', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/superadmin');

  const isPromo = !tenant.meta?.isPromo;
  await slab.collection('tenants').updateOne(
    { _id: tenant._id },
    { $set: { 'meta.isPromo': isPromo, updatedAt: new Date() } },
  );

  await logActivity({
    category: 'admin_action',
    action: `${isPromo ? 'Marked' : 'Unmarked'} ${tenant.domain} as promo (excluded from MRR)`,
    tenantDomain: tenant.domain,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });

  // Support AJAX or redirect
  if (req.headers.accept?.includes('application/json')) {
    return res.json({ ok: true, isPromo });
  }
  res.redirect('/superadmin#tab-slab');
});

// ── Promos ──────────────────────────────────────────────────────────────────
router.get('/promos', async (req, res) => {
  const slab = getSlabDb();
  const [promos, plans] = await Promise.all([
    slab.collection('promos').find().sort({ createdAt: -1 }).toArray(),
    slab.collection('plans').find().sort({ order: 1 }).toArray(),
  ]);
  // Get contacts: signups + preview tenants
  const previewTenants = await slab.collection('tenants')
    .find({ status: 'preview' }, { projection: { domain: 1, 'meta.ownerEmail': 1, 'brand.name': 1, createdAt: 1 } })
    .toArray();
  const signups = await slab.collection('signups').find().sort({ createdAt: -1 }).limit(100).toArray();

  res.render('superadmin/promos', {
    user: req.superAdmin,
    promos,
    plans,
    previewTenants,
    signups,
    sent: req.query.sent || null,
  });
});

router.post('/promos/send', async (req, res) => {
  const { emails, subject, body, plan } = req.body;
  if (!emails || !subject || !body) return res.redirect('/superadmin/promos?sent=error');

  const emailList = emails.split(',').map(e => e.trim()).filter(Boolean);
  if (!emailList.length) return res.redirect('/superadmin/promos?sent=error');

  // Get Zoho creds from env or first active tenant
  const zohoUser = process.env.ZOHO_USER;
  const zohoPass = process.env.ZOHO_PASS;
  if (!zohoUser || !zohoPass) return res.redirect('/superadmin/promos?sent=no-email-config');

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
      auth: { user: zohoUser, pass: zohoPass },
    });

    for (const to of emailList) {
      await transporter.sendMail({
        from: `"sLab Platform" <${zohoUser}>`,
        to,
        subject,
        html: body,
      });
    }

    // Log the promo send
    const slab = getSlabDb();
    await slab.collection('promos').insertOne({
      emails: emailList,
      subject,
      plan: plan || null,
      sentAt: new Date(),
      sentBy: req.superAdmin.email,
      createdAt: new Date(),
    });

    res.redirect(`/superadmin/promos?sent=${emailList.length}`);
  } catch (err) {
    console.error('[superadmin] Promo send failed:', err);
    res.redirect('/superadmin/promos?sent=error');
  }
});

// ── SEO / AEO / GEO / AAO analytics across all tenants ────────────────────
router.get('/seo', async (req, res) => {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find().sort({ createdAt: -1 }).toArray();

  // Per-tenant scoring — checks for the fields that power our seo middleware,
  // robots.txt, sitemap.xml, llms.txt, and agents.json output.
  const rows = await Promise.all(tenants.map(async (t) => {
    const brand = t.brand || {};
    const checks = {
      name:        !!brand.name,
      tagline:     !!brand.tagline,
      description: !!brand.description,
      industry:    !!brand.industry,
      location:    !!brand.location,
      services:    Array.isArray(brand.services) && brand.services.length > 0,
      contact:     !!(brand.email || brand.phone),
      social:      !!(brand.socialLinks && Object.values(brand.socialLinks || {}).some(v => typeof v === 'string' && v.startsWith('http'))),
    };

    let logo = false, pages = 0, posts = 0;
    try {
      const tdb = getTenantDb(t.db);
      const [logoDoc, pagesCount, postsCount] = await Promise.all([
        tdb.collection('brand_images').findOne({ slot: 'logo_primary' }),
        tdb.collection('pages').countDocuments({ status: 'published' }).catch(() => 0),
        tdb.collection('blog').countDocuments({ status: 'published' }).catch(() => 0),
      ]);
      logo = !!(logoDoc && logoDoc.url);
      pages = pagesCount;
      posts = postsCount;
    } catch { /* tenant db missing — leave defaults */ }

    checks.logo = logo;
    const passed = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;
    const pct = Math.round((passed / total) * 100);
    const health = pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red';

    const isPreview = t.status === 'preview';
    const indexable = !isPreview && t.status !== 'suspended';

    return {
      _id: t._id,
      domain: t.domain,
      brandName: brand.name || '(no brand)',
      status: t.status || 'active',
      isPreview,
      indexable,
      checks,
      passed, total, pct, health,
      sitemapUrls: 4 + pages + posts, // home, blog, terms, privacy + content
      pages, posts,
      lastSeen: t.meta?.lastSeenAt || null,
    };
  }));

  // Aggregates
  const agg = {
    total: rows.length,
    green: rows.filter(r => r.health === 'green').length,
    yellow: rows.filter(r => r.health === 'yellow').length,
    red: rows.filter(r => r.health === 'red').length,
    indexable: rows.filter(r => r.indexable).length,
    blocked: rows.filter(r => !r.indexable).length,
    avgPct: rows.length ? Math.round(rows.reduce((s, r) => s + r.pct, 0) / rows.length) : 0,
    fieldCoverage: {},
  };
  const fieldKeys = ['name','tagline','description','industry','location','services','contact','social','logo'];
  for (const k of fieldKeys) {
    const have = rows.filter(r => r.checks[k]).length;
    agg.fieldCoverage[k] = { have, pct: rows.length ? Math.round((have/rows.length)*100) : 0 };
  }

  res.render('superadmin/seo', { user: req.superAdmin, rows, agg, fieldKeys });
});

// ── Activity Log (full page) ────────────────────────────────────────────────
router.get('/activity', async (req, res) => {
  const logs = await getActivityLogs({ limit: 200 });
  res.render('superadmin/activity', { user: req.superAdmin, activityLogs: logs });
});

// ── Signups (marketing data) ────────────────────────────────────────────────
router.get('/signups', async (req, res) => {
  const slab = getSlabDb();
  const signups = await slab.collection('signups').find().sort({ createdAt: -1 }).toArray();
  res.render('superadmin/signups', { user: req.superAdmin, signups });
});

// ── Huginn REMOVED — all routes commented out ────────────────────────────

// ── Control Center ─────────────────────────────────────────────────────────
router.get('/control-center', (req, res) => {
  res.render('superadmin/control-center', { user: req.superAdmin });
});

// ── Plans management ────────────────────────────────────────────────────────
router.post('/plans', async (req, res) => {
  const { slug, name, mode, stripePriceId, amount, duration, order } = req.body;
  if (!slug || !name) return res.redirect('/superadmin/promos');

  const slab = getSlabDb();
  await slab.collection('plans').updateOne(
    { slug },
    {
      $set: {
        slug, name, mode: mode || 'subscription',
        stripePriceId: stripePriceId || null,
        amount: parseFloat(amount) || 0,
        duration: duration || null,
        order: parseInt(order) || 0,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
  res.redirect('/superadmin/promos');
});

// ── API: System tools (called from dashboard panels) ────────────────────────
function safeExec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 10000 }); }
  catch (e) { return e.stdout || e.message || 'Command failed'; }
}

router.get('/api/tool/:tool', async (req, res) => {
  const { tool } = req.params;
  try {
    let output = '';
    switch (tool) {
      case 'health': {
        const sessions = safeExec('tmux list-sessions 2>/dev/null');
        const ports = safeExec('ss -tlnp 2>/dev/null | grep LISTEN | head -40');
        output = '=== TMUX SESSIONS ===\n' + sessions + '\n=== LISTENING PORTS ===\n' + ports;
        break;
      }
      case 'apache':
        output = safeExec('apache2ctl -S 2>&1 | head -60');
        break;
      case 'ssl':
        output = safeExec('certbot certificates 2>&1 | head -40');
        break;
      case 'mongo': {
        const slab = getSlabDb();
        const collections = await slab.listCollections().toArray();
        output = 'Slab DB collections:\n' + collections.map(c => '  - ' + c.name).join('\n');
        break;
      }
      case 'disk':
        output = safeExec('df -h / && echo "" && du -sh /srv/*/ 2>/dev/null | sort -rh | head -20');
        break;
      case 'ollama': {
        const h = await ollamaHealth();
        output = JSON.stringify(h, null, 2);
        if (h.llm?.ok || h.sd?.ok) return res.json({ ok: true, tool, output, models: h.llm?.models || [], llm: h.llm, sd: h.sd });
        return res.json({ ok: false, tool, output, error: h.error || 'unreachable' });
      }
      default:
        output = 'Unknown tool: ' + tool;
    }
    res.json({ ok: true, tool, output });
  } catch (err) {
    res.json({ ok: false, tool, output: 'Error: ' + err.message });
  }
});

// ── Ollama tunnel analytics (proxy to ollama.madladslab.com) ────────────────
function ollamaBase() {
  return (config.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions')
    .replace(/\/v1\/chat\/completions\/?$/, '')
    .replace(/\/$/, '');
}

async function ollamaFetch(pathname, { auth = true, timeoutMs = 6000 } = {}) {
  const url = ollamaBase() + pathname;
  const headers = { 'Accept': 'application/json' };
  if (auth && config.OLLAMA_KEY) headers['Authorization'] = 'Bearer ' + config.OLLAMA_KEY;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function ollamaHealth() {
  const [llm, sd] = await Promise.all([ollamaFetch('/health', { auth: false }), ollamaFetch('/health/sd', { auth: false })]);
  return {
    llm: { ok: llm.ok, status: llm.status, ...(typeof llm.body === 'object' && llm.body ? llm.body : {}), error: llm.error },
    sd:  { ok: sd.ok,  status: sd.status,  ...(typeof sd.body  === 'object' && sd.body  ? sd.body  : {}), error: sd.error },
  };
}

router.get('/api/ollama/health', async (req, res) => {
  res.json(await ollamaHealth());
});

router.get('/api/ollama/keys', async (req, res) => {
  const r = await ollamaFetch('/analytics/keys');
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.get('/api/ollama/rate', async (req, res) => {
  const r = await ollamaFetch('/analytics/rate');
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.get('/api/ollama/analytics', async (req, res) => {
  const qs = new URLSearchParams();
  if (req.query.since) qs.set('since', String(req.query.since));
  if (req.query.until) qs.set('until', String(req.query.until));
  if (req.query.key)   qs.set('key',   String(req.query.key));
  const path = '/analytics' + (qs.toString() ? '?' + qs.toString() : '');
  const r = await ollamaFetch(path, { timeoutMs: 10000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

// ── Ops Pulse — per-service activity for the harmony visualizer ─────────────
const pulseCache = { lastActivity: {}, lastHistory: {}, history: [], lastCpuSample: null, lastTail: {}, lastErrCount: {} };

// Count error markers in a tail-50 block (HTTP 4xx/5xx access lines, Error/throws, common stack words)
const ERR_RE = /\b[45]\d{2}\b|\bError\b|\bECONN[A-Z]+\b|\bENOTFOUND\b|\bEACCES\b|\bUnhandled\b|TypeError|RangeError|ReferenceError/i;
function countErrorLines(s) {
  if (!s) return 0;
  let n = 0;
  for (const line of s.split('\n')) { if (ERR_RE.test(line)) n++; }
  return n;
}

function tmuxTail(session, lines = 50) {
  try {
    return execSync(`tmux capture-pane -t ${session} -p -S -${lines} 2>/dev/null`, { encoding: 'utf8', timeout: 1200 }) || '';
  } catch { return ''; }
}

function sysSnapshot() {
  // Load averages (Linux)
  const load = os.loadavg(); // [1m, 5m, 15m]
  const cores = os.cpus().length || 1;

  // Memory from /proc/meminfo (more accurate than os.freemem on Linux)
  let memTotal = os.totalmem(), memFree = os.freemem(), memAvail = memFree;
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = k => { const m = mi.match(new RegExp('^' + k + ':\\s+(\\d+)\\s+kB', 'm')); return m ? parseInt(m[1], 10) * 1024 : null; };
    memTotal = get('MemTotal') ?? memTotal;
    memFree = get('MemFree') ?? memFree;
    memAvail = get('MemAvailable') ?? memFree;
  } catch {}

  // CPU usage % since last sample (instantaneous)
  let cpuPct = null;
  try {
    const cpus = os.cpus();
    const sample = cpus.reduce((acc, c) => {
      acc.idle += c.times.idle;
      acc.total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
      return acc;
    }, { idle: 0, total: 0 });
    if (pulseCache.lastCpuSample) {
      const dIdle = sample.idle - pulseCache.lastCpuSample.idle;
      const dTotal = sample.total - pulseCache.lastCpuSample.total;
      if (dTotal > 0) cpuPct = Math.max(0, Math.min(100, 100 * (1 - dIdle / dTotal)));
    }
    pulseCache.lastCpuSample = sample;
  } catch {}

  // Top processes by CPU (single call, cheap)
  let topProcs = [];
  try {
    const out = execSync('ps -eo pid,pcpu,pmem,rss,comm --sort=-pcpu --no-headers 2>/dev/null | head -8', { encoding: 'utf8', timeout: 1000 });
    topProcs = out.trim().split('\n').filter(Boolean).map(line => {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.+)$/);
      if (!m) return null;
      return { pid: parseInt(m[1], 10), cpu: parseFloat(m[2]), mem: parseFloat(m[3]), rssKb: parseInt(m[4], 10), name: m[5].trim() };
    }).filter(Boolean);
  } catch {}

  // Process count
  let procCount = null;
  try { procCount = parseInt(execSync('ps -e --no-headers 2>/dev/null | wc -l', { encoding: 'utf8', timeout: 600 }).trim(), 10); } catch {}

  return {
    load: { m1: load[0], m5: load[1], m15: load[2], cores },
    cpuPct,
    mem: { total: memTotal, free: memFree, available: memAvail, used: memTotal - memAvail, usedPct: memTotal ? ((memTotal - memAvail) / memTotal) * 100 : 0 },
    procs: { total: procCount, top: topProcs },
    uptimeSec: os.uptime(),
  };
}

router.get('/api/ops/pulse', (req, res) => {
  const services = getServices();
  const now = Date.now();

  // Pull session_activity + history_size for all tmux sessions in one call.
  const tmux = {};
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}|#{session_activity}|#{history_size}" 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
    out.trim().split('\n').forEach(line => {
      const [name, act, size] = line.split('|');
      if (!name) return;
      tmux[name] = { activity: parseInt(act, 10) * 1000, size: parseInt(size, 10) || 0 };
    });
  } catch { /* tmux missing or no sessions */ }

  // One ss call, bucket established connections by local port.
  const connsByPort = {};
  try {
    const out = execSync('ss -tn state established 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
    out.split('\n').slice(1).forEach(line => {
      const m = line.match(/:(\d+)\s+\S+:\d+/);
      if (m) { const p = parseInt(m[1], 10); connsByPort[p] = (connsByPort[p] || 0) + 1; }
    });
  } catch {}

  // Pull in any tmux sessions that AREN'T in the registry as "unregistered" services,
  // so newly spun-up sessions show up in the harmony immediately.
  const registeredTmux = new Set(services.filter(s => s.tmux).map(s => s.tmux));
  const allSessionNames = Object.keys(tmux);
  const unregistered = allSessionNames
    .filter(name => !registeredTmux.has(name))
    .map(name => ({
      name,
      dir: null,
      port: null,
      domain: null,
      tmux: name,
      category: 'unregistered',
      description: 'tmux session not in registry',
      alive: true,
      unregistered: true,
    }));
  const allServices = services.concat(unregistered);

  let totalConns = 0;
  let totalErrorPulses = 0;
  const enriched = allServices.map(svc => {
    const t = svc.tmux ? tmux[svc.tmux] : null;
    const prevAct = pulseCache.lastActivity[svc.name];
    const prevSize = pulseCache.lastHistory[svc.name];
    const activityChanged = !!(t && prevAct != null && t.activity > prevAct);
    const outputGrew = !!(t && prevSize != null && t.size > prevSize);

    // Sample tail-50 only when output grew, to detect new error lines without paying for every session every tick
    let errorPulse = false;
    if (svc.tmux && outputGrew) {
      const tail = tmuxTail(svc.tmux, 50);
      pulseCache.lastTail[svc.name] = tail;
      const errCount = countErrorLines(tail);
      const prevErr = pulseCache.lastErrCount[svc.name] ?? errCount;
      if (errCount > prevErr) errorPulse = true;
      pulseCache.lastErrCount[svc.name] = errCount;
    }

    if (t) { pulseCache.lastActivity[svc.name] = t.activity; pulseCache.lastHistory[svc.name] = t.size; }
    const conns = svc.port ? (connsByPort[svc.port] || 0) : 0;
    totalConns += conns;
    if (errorPulse) totalErrorPulses++;
    return {
      name: svc.name,
      tmux: svc.tmux || null,
      port: svc.port || null,
      category: svc.category || 'tool',
      alive: svc.alive === true,
      unregistered: !!svc.unregistered,
      conns,
      idleMs: t?.activity ? Math.max(0, now - t.activity) : null,
      pulse: activityChanged || outputGrew,
      pulseKind: errorPulse ? 'error' : (outputGrew ? 'output' : (activityChanged ? 'session' : null)),
    };
  });

  const sys = sysSnapshot();

  // Keep a 60-sample ring buffer for sparkline (~2 minutes at 2s poll).
  pulseCache.history.push({
    ts: now,
    conns: totalConns,
    pulsing: enriched.filter(e => e.pulse).length,
    cpu: sys.cpuPct,
    memPct: sys.mem.usedPct,
    load1: sys.load.m1,
  });
  if (pulseCache.history.length > 60) pulseCache.history.shift();

  res.json({ ts: now, totalConns, totalErrorPulses, services: enriched, history: pulseCache.history, sys });
});

// ── Tail a tmux pane on demand (for hover tooltip) ─────────────────────────
router.get('/api/ops/tail', (req, res) => {
  const session = String(req.query.session || '').replace(/[^A-Za-z0-9_-]/g, '');
  const lines = Math.max(1, Math.min(500, parseInt(req.query.lines, 10) || 50));
  if (!session) return res.json({ ok: false, error: 'session required' });
  const tail = tmuxTail(session, lines);
  res.json({ ok: true, session, lines, tail, errorCount: countErrorLines(tail) });
});

// ── Outbound connections from this box (live) ──────────────────────────────
router.get('/api/ops/outbounds', (req, res) => {
  // Process for the peer (cmdline) when we can; else just count.
  let lines = [];
  try {
    const out = execSync('ss -tnp state established 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
    lines = out.split('\n').slice(1).filter(Boolean);
  } catch { return res.json({ ok: false, error: 'ss unavailable' }); }

  const peers = new Map(); // key: peerAddr+':'+peerPort, val: { peerAddr, peerPort, count, sample }
  for (const line of lines) {
    // ss output: state recvq sendq localAddr:port peerAddr:port [process]
    // The lines might have variable whitespace; use a generic split + regex for last two address:port tokens
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const local = cols[cols.length - 3] || cols[3] || '';
    const peer  = cols[cols.length - 2] || cols[4] || '';
    const proc  = cols.length > 5 ? cols.slice(5).join(' ') : '';
    // ss sometimes uses 4-col table without state — handle both layouts
    let peerAddr = peer;
    const m = peer.match(/^(.+):(\d+)$/);
    if (!m) continue;
    peerAddr = m[1].replace(/^\[|\]$/g, '');
    const peerPort = parseInt(m[2], 10);

    // Skip loopback peers (intra-host traffic)
    if (peerAddr === '127.0.0.1' || peerAddr === '::1' || peerAddr.startsWith('127.')) continue;
    // Also skip our own host's private IPs (Linode internal) — keep them for now since some are useful
    const key = peerAddr + ':' + peerPort;
    const cur = peers.get(key) || { peerAddr, peerPort, count: 0, local, proc };
    cur.count++;
    peers.set(key, cur);
  }

  // Group by peerAddr to show aggregate by host
  const byHost = new Map();
  for (const p of peers.values()) {
    const h = byHost.get(p.peerAddr) || { peerAddr: p.peerAddr, ports: new Set(), count: 0, procs: new Set() };
    h.count += p.count;
    h.ports.add(p.peerPort);
    if (p.proc) h.procs.add(p.proc);
    byHost.set(p.peerAddr, h);
  }
  const hosts = [...byHost.values()].map(h => ({
    peerAddr: h.peerAddr,
    ports: [...h.ports].sort((a, b) => a - b),
    count: h.count,
    procs: [...h.procs].slice(0, 3),
    label: peerLabel(h.peerAddr, [...h.ports]),
  })).sort((a, b) => b.count - a.count);

  res.json({ ok: true, total: peers.size, hosts });
});

// Map common peer addresses / ports to a friendly label
function peerLabel(addr, ports) {
  // Cheap heuristics — only label well-known ones
  const portSet = new Set(ports);
  if (portSet.has(27017)) return 'MongoDB Atlas';
  if (portSet.has(443) && addr.endsWith('.googleapis.com')) return 'Google APIs';
  if (portSet.has(443) && /\.amazonaws\.com$/.test(addr)) return 'AWS';
  if (portSet.has(443) && /(github|githubusercontent)\.com$/.test(addr)) return 'GitHub';
  if (portSet.has(443) && /\.zoho/.test(addr)) return 'Zoho';
  if (portSet.has(443) && /\.stripe\.com$/.test(addr)) return 'Stripe';
  if (portSet.has(443) && /\.cloudflare/.test(addr)) return 'Cloudflare';
  if (portSet.has(443) && /\.openai\.com$/.test(addr)) return 'OpenAI';
  if (portSet.has(443) && /anthropic/.test(addr)) return 'Anthropic';
  if (portSet.has(80)) return addr + ' (http)';
  if (portSet.has(443)) return addr + ' (https)';
  if (portSet.has(25) || portSet.has(465) || portSet.has(587)) return addr + ' (smtp)';
  return addr;
}

// ── Deprecation pipeline: ingest a service into /srv/depricated/new/<name> ──
router.post('/api/deprecation/ingest-service', (req, res) => {
  const name = String(req.body.name || '').replace(/[^A-Za-z0-9_.-]/g, '');
  if (!name) return res.json({ ok: false, error: 'name required' });
  const svc = getService(name);
  if (!svc) return res.json({ ok: false, error: 'service not in registry' });
  if (!svc.dir || !fs.existsSync(svc.dir)) return res.json({ ok: false, error: 'service dir missing' });

  const newStage = path.join(DEPR_ROOT, 'new', svc.name);
  if (fs.existsSync(newStage)) return res.json({ ok: false, error: 'already in pipeline (new stage)' });

  let scriptOutput = '';
  try {
    // Prefer the script if it exists; otherwise do a safe rename.
    const script = path.join(DEPR_ROOT, 'deprecate.sh');
    if (fs.existsSync(script)) {
      // deprecate.sh takes <project-name> only — it derives SRC=/srv/<name> internally
      scriptOutput = execSync(`bash "${script}" "${svc.name}" 2>&1`, { encoding: 'utf8', timeout: 60000 });
    } else {
      fs.mkdirSync(path.join(DEPR_ROOT, 'new'), { recursive: true });
      fs.renameSync(svc.dir, newStage);
      fs.writeFileSync(path.join(newStage, '_receipt.json'), JSON.stringify({ deprecatedAt: new Date().toISOString(), original: svc.dir, service: svc }, null, 2));
      scriptOutput = `Moved ${svc.dir} → ${newStage}`;
    }
    try { logActivity({ action: `service '${svc.name}' deprecated → /srv/depricated/new`, category: 'admin_action', actor: { email: req.superAdmin?.email || 'system' } }); } catch {}
    res.json({ ok: true, name: svc.name, staged: newStage, output: scriptOutput });
  } catch (err) {
    res.json({ ok: false, error: err.message, output: scriptOutput || (err.stdout || '').toString() });
  }
});

router.get('/api/service/:name/:action', (req, res) => {
  const svc = getService(req.params.name);
  if (!svc) return res.json({ ok: false, output: 'Unknown service' });
  try {
    const parts = [`Service: ${svc.name}`, `Dir: ${svc.dir}`, `Port: ${svc.port || 'n/a'}`,
      `Domain: ${svc.domain || 'n/a'}`, `tmux: ${svc.tmux || 'n/a'}`,
      `Alive: ${svc.alive ? 'YES' : 'NO'}`, `Port open: ${svc.portOpen === null ? 'n/a' : svc.portOpen ? 'YES' : 'NO'}`];
    if (svc.tmux && svc.alive) {
      const log = safeExec(`tmux capture-pane -t ${svc.tmux} -p 2>/dev/null | tail -15`);
      if (log.trim()) parts.push('\n=== RECENT OUTPUT ===\n' + log);
    }
    res.json({ ok: true, service: svc.name, output: parts.join('\n') });
  } catch (err) {
    res.json({ ok: false, output: 'Error: ' + err.message });
  }
});

router.get('/service/:name', (req, res) => {
  const svc = getService(req.params.name);
  if (!svc) return res.status(404).send('Service not found');
  res.redirect('/superadmin?service=' + req.params.name);
});

// ── Deprecation Pipeline API ──────────────────────────────────────────────
const DEPR_ROOT = '/srv/depricated';
const DEPR_STAGES = ['new', 'cleansed', 'deconstructed', 'deletion-stage'];

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function getDeprecationPipeline() {
  const pipeline = {};
  for (const stage of DEPR_STAGES) {
    const dir = path.join(DEPR_ROOT, stage);
    if (!fs.existsSync(dir)) { pipeline[stage] = []; continue; }
    const entries = fs.readdirSync(dir).filter(f => {
      const full = path.join(dir, f);
      return fs.statSync(full).isDirectory() && !f.startsWith('.');
    });
    pipeline[stage] = entries.map(name => {
      const base = path.join(dir, name);
      const receipt = readJsonFile(path.join(base, '_deprecation_receipt.json'));
      const manifest = readJsonFile(path.join(base, '_config_manifest.json'));
      const review = readJsonFile(path.join(base, '_deletion_review.json'));
      const report = fs.existsSync(path.join(base, '_deconstruction_report.md'));
      let size = '?';
      try { size = execSync(`du -sh "${base}" 2>/dev/null | cut -f1`, { encoding: 'utf8' }).trim(); } catch {}
      return { name, stage, receipt, manifest, review, hasReport: report, size };
    });
  }
  return pipeline;
}

// List all projects available for deprecation (dirs in /srv with package.json, not already deprecated)
function getDeprecatableSrvProjects() {
  const existing = new Set();
  for (const stage of DEPR_STAGES) {
    const dir = path.join(DEPR_ROOT, stage);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(f => existing.add(f));
    }
  }
  const skip = new Set(['depricated', 'node_modules', 'lost+found']);
  try {
    return fs.readdirSync('/srv').filter(f => {
      if (skip.has(f) || existing.has(f)) return false;
      const full = path.join('/srv', f);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'package.json'));
    });
  } catch { return []; }
}

router.get('/api/deprecation/pipeline', (req, res) => {
  const pipeline = getDeprecationPipeline();
  const available = getDeprecatableSrvProjects();
  res.json({ ok: true, pipeline, available });
});

router.get('/api/deprecation/report/:project', (req, res) => {
  const { project } = req.params;
  // Search all stages for the report
  for (const stage of DEPR_STAGES) {
    const reportPath = path.join(DEPR_ROOT, stage, project, '_deconstruction_report.md');
    if (fs.existsSync(reportPath)) {
      return res.json({ ok: true, project, report: fs.readFileSync(reportPath, 'utf8') });
    }
  }
  res.json({ ok: false, error: 'No report found for ' + project });
});

router.get('/api/deprecation/manifest/:project', (req, res) => {
  const { project } = req.params;
  for (const stage of DEPR_STAGES) {
    const mPath = path.join(DEPR_ROOT, stage, project, '_config_manifest.json');
    if (fs.existsSync(mPath)) {
      return res.json({ ok: true, project, manifest: readJsonFile(mPath) });
    }
  }
  res.json({ ok: false, error: 'No manifest found for ' + project });
});

router.get('/api/deprecation/review/:project', (req, res) => {
  const { project } = req.params;
  const rPath = path.join(DEPR_ROOT, 'deletion-stage', project, '_deletion_review.json');
  if (fs.existsSync(rPath)) {
    return res.json({ ok: true, project, review: readJsonFile(rPath) });
  }
  res.json({ ok: false, error: 'No review found for ' + project });
});

router.post('/api/deprecation/advance', (req, res) => {
  const { project, action } = req.body;
  if (!project) return res.status(400).json({ ok: false, error: 'project required' });

  const scriptMap = {
    deprecate:    path.join(DEPR_ROOT, 'deprecate.sh'),
    cleanse:      path.join(DEPR_ROOT, 'cleanse.sh'),
    deconstruct:  path.join(DEPR_ROOT, 'deconstruct.sh'),
    'stage-delete': path.join(DEPR_ROOT, 'stage-delete.sh'),
  };

  const script = scriptMap[action];
  if (!script) return res.status(400).json({ ok: false, error: 'Invalid action: ' + action });

  try {
    const output = execSync(`bash "${script}" "${project}" 2>&1`, {
      encoding: 'utf8', timeout: 30000,
    });
    // Try to parse JSON output from scripts
    try {
      const result = JSON.parse(output.trim().split('\n').pop());
      logActivity({
        category: 'admin_action', action: `deprecation_${action}`,
        tenantDomain: project, status: result.ok ? 'success' : 'error',
        actor: { email: req.superAdmin.email, role: 'superadmin' },
        details: result,
      });
      return res.json(result);
    } catch {
      return res.json({ ok: true, output });
    }
  } catch (err) {
    const errOutput = err.stdout || err.stderr || err.message;
    try {
      return res.json(JSON.parse(errOutput.trim().split('\n').pop()));
    } catch {
      return res.json({ ok: false, error: errOutput });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// IMPERSONATE — Login as tenant admin (moved from /admin/super)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/tenants/:id/impersonate', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/superadmin');

  const tenantDb = getTenantDb(tenant.db);
  const adminUser = await tenantDb.collection('users').findOne({ isAdmin: true });
  if (!adminUser) return res.redirect(`/superadmin/tenants/${req.params.id}?error=no-admin-user`);

  const token = createLoginToken(adminUser, tenant.db, '5m');
  const protocol = req.protocol;
  res.redirect(`${protocol}://${tenant.domain}/admin?token=${token}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// ESCALATED TICKETS (moved from /admin/super)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/tickets', async (req, res) => {
  const slab = getSlabDb();
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  else filter.status = 'escalated';

  const tickets = await slab.collection('escalated_tickets')
    .find(filter).sort({ escalatedAt: -1 }).toArray();

  const stats = await Promise.all([
    slab.collection('escalated_tickets').countDocuments({ status: 'escalated' }),
    slab.collection('escalated_tickets').countDocuments({ status: 'resolved' }),
    slab.collection('escalated_tickets').countDocuments({ status: 'closed' }),
  ]).then(([active, resolved, closed]) => ({ active, resolved, closed, total: active + resolved + closed }));

  res.render('superadmin/tickets', {
    superAdmin: req.superAdmin,
    tickets,
    stats,
    filters: { status: req.query.status || '' },
  });
});

router.get('/tickets/:tenantDb/:ticketId', async (req, res) => {
  try {
    const tenantDb = getTenantDb(req.params.tenantDb);
    const ticket = await tenantDb.collection('tickets').findOne({ _id: new ObjectId(req.params.ticketId) });
    if (!ticket) return res.redirect('/superadmin/tickets');

    res.render('superadmin/ticket-detail', {
      superAdmin: req.superAdmin,
      ticket,
      tenantDbName: req.params.tenantDb,
    });
  } catch {
    res.redirect('/superadmin/tickets');
  }
});

router.post('/tickets/:tenantDb/:ticketId/reply', async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.redirect(`/superadmin/tickets/${req.params.tenantDb}/${req.params.ticketId}`);

  const tenantDb = getTenantDb(req.params.tenantDb);
  const reply = {
    _id: new ObjectId(),
    author: {
      type: 'superadmin',
      email: req.superAdmin.email,
      displayName: (req.superAdmin.displayName || req.superAdmin.email) + ' (Platform)',
    },
    body: body.trim(),
    attachments: [],
    createdAt: new Date(),
  };

  await tenantDb.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.ticketId) },
    { $push: { replies: reply }, $set: { updatedAt: new Date() } },
  );
  res.redirect(`/superadmin/tickets/${req.params.tenantDb}/${req.params.ticketId}`);
});

router.post('/tickets/:tenantDb/:ticketId/resolve', async (req, res) => {
  const now = new Date();
  const tenantDb = getTenantDb(req.params.tenantDb);

  await tenantDb.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.ticketId) },
    { $set: { status: 'resolved', escalated: false, resolvedAt: now, updatedAt: now } },
  );

  const slab = getSlabDb();
  await slab.collection('escalated_tickets').updateOne(
    { ticketId: req.params.ticketId, tenantDbName: req.params.tenantDb },
    { $set: { status: 'resolved', resolvedAt: now } },
  );

  res.redirect('/superadmin/tickets');
});

router.post('/tickets/:tenantDb/:ticketId/de-escalate', async (req, res) => {
  const now = new Date();
  const tenantDb = getTenantDb(req.params.tenantDb);

  await tenantDb.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.ticketId) },
    { $set: { status: 'open', escalated: false, updatedAt: now } },
  );

  const slab = getSlabDb();
  await slab.collection('escalated_tickets').deleteOne({
    ticketId: req.params.ticketId, tenantDbName: req.params.tenantDb,
  });

  res.redirect('/superadmin/tickets');
});

// ═══════════════════════════════════════════════════════════════════════════
// OPSTRAIN — Brand management (centralized from opsTrain /superadmin)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/opstrain', async (req, res) => {
  const opsDb = getTenantDb('opsTrain');
  const [brands, users, tasks, qrCodes] = await Promise.all([
    opsDb.collection('brands').find().sort({ name: 1 }).toArray(),
    opsDb.collection('users').find().toArray(),
    opsDb.collection('tasks').find({ active: true }).toArray(),
    opsDb.collection('qrcodes').find({ active: true }).toArray(),
  ]);

  const brandStats = brands.map(b => ({
    ...b,
    userCount: users.filter(u => u.brand?.toString() === b._id.toString()).length,
    taskCount: tasks.filter(t => t.brand?.toString() === b._id.toString()).length,
    qrCount: qrCodes.filter(q => q.brand?.toString() === b._id.toString()).length,
  }));

  res.render('superadmin/opstrain', {
    superAdmin: req.superAdmin,
    brands: brandStats,
    users,
    stats: {
      totalBrands: brands.length,
      activeBrands: brands.filter(b => b.active !== false).length,
      previewBrands: brands.filter(b => b.status === 'preview').length,
      totalUsers: users.length,
    },
  });
});

router.post('/opstrain/brand/:id/toggle', async (req, res) => {
  const opsDb = getTenantDb('opsTrain');
  const brand = await opsDb.collection('brands').findOne({ _id: new ObjectId(req.params.id) });
  if (brand) {
    await opsDb.collection('brands').updateOne(
      { _id: brand._id },
      { $set: { active: !brand.active, updatedAt: new Date() } },
    );
  }
  res.redirect('/superadmin#tab-opstrain');
});

router.get('/opstrain/brand/:id/enter', (req, res) => {
  const appDef = GATEWAY_APPS.opsTrain;
  const token = generateGatewayToken('opsTrain', req.superAdmin.email, appDef.secret, { brand: req.params.id });
  const protocol = req.protocol;
  const host = req.hostname.replace(/:\d+$/, '');

  let targetUrl;
  if (config.NODE_ENV === 'production') {
    const svc = getServices().find(s => s.name === 'opsTrain');
    targetUrl = svc?.domain
      ? `https://${svc.domain}/gateway?token=${token}`
      : `${protocol}://${host}:${appDef.port}/gateway?token=${token}`;
  } else {
    targetUrl = `${protocol}://${host}:${appDef.port}/gateway?token=${token}`;
  }

  res.redirect(targetUrl);
});

router.post('/opstrain/user/:id/role', async (req, res) => {
  const { role } = req.body;
  const validRoles = ['superadmin', 'admin', 'manager', 'user'];
  if (!validRoles.includes(role)) return res.redirect('/superadmin#tab-opstrain');
  const opsDb = getTenantDb('opsTrain');
  await opsDb.collection('users').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { role, updatedAt: new Date() } },
  );
  res.redirect('/superadmin#tab-opstrain');
});

// ── Games user management (games.madladslab.com — DB: test) ────────────────
router.post('/games/user/:id/toggle-admin', async (req, res) => {
  const gamesDb = getTenantDb('test');
  const user = await gamesDb.collection('users').findOne({ _id: new ObjectId(req.params.id) });
  if (user) {
    await gamesDb.collection('users').updateOne(
      { _id: user._id },
      { $set: { isAdmin: !user.isAdmin } },
    );
    await logActivity({
      category: 'admin_action',
      action: `${user.isAdmin ? 'Revoked' : 'Granted'} admin for ${user.email} in Games`,
      actor: { email: req.superAdmin.email, role: 'superadmin' },
    });
  }
  res.redirect('/superadmin#tab-games');
});

router.post('/games/user/:id/toggle-broadcaster', async (req, res) => {
  const gamesDb = getTenantDb('test');
  const user = await gamesDb.collection('users').findOne({ _id: new ObjectId(req.params.id) });
  if (user) {
    await gamesDb.collection('users').updateOne(
      { _id: user._id },
      { $set: { isBroadcaster: !user.isBroadcaster } },
    );
  }
  res.redirect('/superadmin#tab-games');
});

router.post('/games/user/:id/game-admin', async (req, res) => {
  const gamesDb = getTenantDb('test');
  const user = await gamesDb.collection('users').findOne({ _id: new ObjectId(req.params.id) });
  if (user) {
    const hasGameAdmin = user.permissions?.games === 'admin';
    await gamesDb.collection('users').updateOne(
      { _id: user._id },
      hasGameAdmin
        ? { $unset: { 'permissions.games': '' } }
        : { $set: { 'permissions.games': 'admin' } },
    );
  }
  res.redirect('/superadmin#tab-games');
});

router.post('/games/user/:id/subscription', async (req, res) => {
  const { subscription } = req.body;
  const valid = ['free', 'player', 'admin', 'lifetime'];
  if (!valid.includes(subscription)) return res.redirect('/superadmin#tab-games');
  const gamesDb = getTenantDb('test');
  await gamesDb.collection('users').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { subscription } },
  );
  res.redirect('/superadmin#tab-games');
});

// ── Stringborn user management (ps.madladslab.com — DB: projectStringborne) ─
router.post('/stringborn/user/:id/toggle-admin', async (req, res) => {
  const psDb = getTenantDb('projectStringborne');
  const user = await psDb.collection('users').findOne({ _id: new ObjectId(req.params.id) });
  if (user) {
    await psDb.collection('users').updateOne(
      { _id: user._id },
      { $set: { isAdmin: !user.isAdmin, userRole: user.isAdmin ? 'tester' : 'admin' } },
    );
    await logActivity({
      category: 'admin_action',
      action: `${user.isAdmin ? 'Revoked' : 'Granted'} admin for ${user.email || user.username} in Stringborn`,
      actor: { email: req.superAdmin.email, role: 'superadmin' },
    });
  }
  res.redirect('/superadmin#tab-stringborn');
});

router.post('/stringborn/user/:id/role', async (req, res) => {
  const { role } = req.body;
  const valid = ['tester', 'admin'];
  if (!valid.includes(role)) return res.redirect('/superadmin#tab-stringborn');
  const psDb = getTenantDb('projectStringborne');
  await psDb.collection('users').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { userRole: role, isAdmin: role === 'admin' } },
  );
  res.redirect('/superadmin#tab-stringborn');
});

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL TICKETS — All tickets across all tenants
// ═══════════════════════════════════════════════════════════════════════════
router.get('/all-tickets', async (req, res) => {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find({}, { projection: { db: 1, domain: 1, 'brand.name': 1 } }).toArray();

  const statusFilter = req.query.status || '';
  const tenantFilter = req.query.tenant || '';
  const allTickets = [];

  for (const tenant of tenants) {
    if (tenantFilter && tenant.db !== tenantFilter) continue;
    try {
      const tDb = getTenantDb(tenant.db);
      const filter = {};
      if (statusFilter && statusFilter !== 'all') filter.status = statusFilter;
      const tickets = await tDb.collection('tickets').find(filter).sort({ createdAt: -1 }).limit(100).toArray();
      for (const t of tickets) {
        allTickets.push({
          ...t,
          _tenantDb: tenant.db,
          _tenantDomain: tenant.domain,
          _tenantName: tenant.brand?.name || tenant.domain,
        });
      }
    } catch { /* skip dead tenant DBs */ }
  }

  allTickets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const statusCounts = {
    open: allTickets.filter(t => t.status === 'open').length,
    'in-progress': allTickets.filter(t => t.status === 'in-progress').length,
    escalated: allTickets.filter(t => t.escalated || t.status === 'escalated').length,
    resolved: allTickets.filter(t => t.status === 'resolved').length,
    closed: allTickets.filter(t => t.status === 'closed').length,
    total: allTickets.length,
  };

  res.render('superadmin/all-tickets', {
    superAdmin: req.superAdmin,
    tickets: allTickets,
    statusCounts,
    tenants,
    filters: { status: statusFilter, tenant: tenantFilter },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCAN REPORTS — Site-scanner findings, separate from tickets
// Devs review and mark fixed here. Tenants see the resulting devStatus on
// their /admin/scanner page.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/scan-reports', async (req, res) => {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants')
    .find({}, { projection: { db: 1, domain: 1, 'brand.name': 1 } }).toArray();

  const statusFilter = req.query.status || '';
  const reports = [];

  for (const tenant of tenants) {
    try {
      const tDb = getTenantDb(tenant.db);
      const latest = await tDb.collection('scan_results')
        .find({}).sort({ 'summary.scannedAt': -1 }).limit(1).toArray();
      if (!latest.length) continue;
      const r = latest[0];
      const devStatus = r.devStatus || (r.summary?.counts?.critical || r.summary?.counts?.high ? 'pending-review' : 'clean');
      if (statusFilter && statusFilter !== 'all' && devStatus !== statusFilter) continue;
      reports.push({
        ...r,
        devStatus,
        _tenantDb: tenant.db,
        _tenantDomain: tenant.domain,
        _tenantName: tenant.brand?.name || tenant.domain,
      });
    } catch { /* skip dead tenants */ }
  }

  reports.sort((a, b) => (b.summary?.scannedAt || 0) - (a.summary?.scannedAt || 0));

  const stats = reports.reduce((acc, r) => {
    acc[r.devStatus] = (acc[r.devStatus] || 0) + 1;
    return acc;
  }, { 'pending-review': 0, 'in-progress': 0, fixed: 0, clean: 0 });
  stats.total = reports.length;

  res.render('superadmin/scan-reports', {
    superAdmin: req.superAdmin,
    reports,
    stats,
    filters: { status: statusFilter },
  });
});

router.get('/scan-reports/:tenantDb/:scanId', async (req, res) => {
  try {
    const tDb = getTenantDb(req.params.tenantDb);
    const report = await tDb.collection('scan_results').findOne({ _id: new ObjectId(req.params.scanId) });
    if (!report) return res.redirect('/superadmin/scan-reports');
    res.render('superadmin/scan-report-detail', {
      superAdmin: req.superAdmin,
      report,
      tenantDbName: req.params.tenantDb,
    });
  } catch {
    res.redirect('/superadmin/scan-reports');
  }
});

router.post('/scan-reports/:tenantDb/:scanId/status', async (req, res) => {
  const { devStatus, devNotes } = req.body;
  const valid = ['pending-review', 'in-progress', 'fixed', 'clean'];
  if (!valid.includes(devStatus)) return res.redirect(`/superadmin/scan-reports/${req.params.tenantDb}/${req.params.scanId}`);
  const tDb = getTenantDb(req.params.tenantDb);
  await tDb.collection('scan_results').updateOne(
    { _id: new ObjectId(req.params.scanId) },
    { $set: { devStatus, devNotes: (devNotes || '').trim(), devReviewedBy: req.superAdmin.email, devReviewedAt: new Date() } },
  );
  res.redirect(`/superadmin/scan-reports/${req.params.tenantDb}/${req.params.scanId}`);
});

// ── AI agentry for ticket detail (suggest reply / summarize / classify) ────
router.post('/tickets/:tenantDb/:ticketId/agent', async (req, res) => {
  try {
    const { callLLM } = await import('../plugins/agentMcp.js');
    const tenantDb = getTenantDb(req.params.tenantDb);
    const ticket = await tenantDb.collection('tickets').findOne({ _id: new ObjectId(req.params.ticketId) });
    if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket not found' });

    const action = req.body.action || 'reply';
    const replies = (ticket.replies || []).map(r => `${r.author?.displayName || r.author?.email || 'Unknown'} (${r.author?.type || 'tenant'}):\n${r.body}`).join('\n\n---\n\n');
    const threadText = `Subject: ${ticket.subject || '(no subject)'}\nFrom: ${ticket.submittedBy?.displayName || ticket.submittedBy?.email || 'tenant'}\nTenant: ${req.params.tenantDb} (${ticket.tenantBrandName || ''})\nPriority: ${ticket.priority || 'medium'} | Category: ${ticket.category || 'other'}\n\nBody:\n${ticket.description || ticket.body || '(empty)'}\n\nReplies so far:\n${replies || '(none)'}`;

    let systemPrompt;
    if (action === 'summarize') {
      systemPrompt = 'You are a senior platform engineer summarizing a customer support ticket for the dev team. Write a 2-3 sentence summary identifying the core issue, what has been tried, and what is still blocking. Return plain prose. No fluff.';
    } else if (action === 'classify') {
      systemPrompt = 'You triage support tickets for a multi-tenant SaaS. Return ONLY JSON: {"category": "bug|improvement|question|onboarding|billing|other", "priority": "low|medium|high|critical", "reasoning": "one short sentence"}. No fences, no prose.';
    } else {
      systemPrompt = 'You are platform support staff (signed as "Platform Support") drafting a reply to a tenant. Be concise (3-6 sentences), professional, warm. Acknowledge the issue, state next steps, give a realistic timeframe. If technical info is needed, ask one focused question. Do NOT invent platform features. Return plain prose only, no signature.';
    }

    const raw = await callLLM([{ role: 'user', content: threadText }], systemPrompt, 60000);
    res.json({ ok: true, action, output: raw.trim() });
  } catch (err) {
    console.error('[superadmin] ticket agent error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL USERS — Cross-tenant user management
// ═══════════════════════════════════════════════════════════════════════════
router.get('/users', async (req, res) => {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find({}, { projection: { db: 1, domain: 1, 'brand.name': 1, status: 1, platform: 1 } }).toArray();

  const tenantFilter = req.query.tenant || '';
  const roleFilter   = req.query.role || '';
  const searchQuery   = req.query.q || '';
  const productFilter = req.query.product || '';
  const allUsers = [];

  // Helper: apply role + search filters to a user
  function matchesFilters(u) {
    if (roleFilter === 'admin' && !u.isAdmin) return false;
    if (roleFilter === 'owner' && !u.isOwner) return false;
    if (roleFilter === 'client' && u.role !== 'client') return false;
    if (roleFilter === 'collaborator' && u.role !== 'collaborator') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(u.email || '').toLowerCase().includes(q) &&
          !(u.displayName || '').toLowerCase().includes(q)) return false;
    }
    return true;
  }

  // ── 1. Slab tenants (multi-tenant: each tenant DB has its own users) ──
  if (!productFilter || productFilter === 'slab') {
    for (const tenant of tenants) {
      if (tenantFilter && tenant.db !== tenantFilter) continue;
      try {
        const tDb = getTenantDb(tenant.db);
        const users = await tDb.collection('users').find().toArray();
        for (const u of users) {
          if (!matchesFilters(u)) continue;
          allUsers.push({
            ...u,
            _product: 'slab',
            _tenantDb: tenant.db,
            _tenantDomain: tenant.domain,
            _tenantName: tenant.brand?.name || tenant.domain,
            _tenantStatus: tenant.status,
            _isSuperAdmin: isSuperAdminEmail(u.email),
          });
        }
      } catch { /* skip dead tenant DBs */ }
    }
  }

  // ── 2. Standalone products (opstrain, games, madladslab) ──
  for (const [productKey, product] of Object.entries(PRODUCTS)) {
    if (product.type !== 'standalone') continue;
    if (productFilter && productFilter !== productKey) continue;
    try {
      const pDb = getTenantDb(product.db);
      const users = await pDb.collection(product.usersCollection).find().toArray();
      for (const u of users) {
        if (!matchesFilters(u)) continue;
        allUsers.push({
          ...u,
          _product: productKey,
          _tenantDb: product.db,
          _tenantDomain: null,
          _tenantName: product.label,
          _tenantStatus: 'active',
          _isSuperAdmin: isSuperAdminEmail(u.email),
        });
      }
    } catch { /* skip if DB unreachable */ }
  }


  // ── 3. Graffiti TV tenants + subscribers (flat JSON) ──
  if (!productFilter || productFilter === 'graffititv') {
    try {
      const gftvTenants = gftvRead('tenants.json', []);
      for (const gt of gftvTenants) {
        const td = gftvRead(`tenant-${gt.slug}.json`, {});

        // Tenant owner account
        const ownerMatch = !searchQuery || [gt.name, gt.email, gt.slug]
          .some(v => (v||'').toLowerCase().includes(searchQuery.toLowerCase()));
        if (ownerMatch) {
          allUsers.push({
            _id:           `gftv-owner-${gt.slug}`,
            email:         gt.email || `${gt.slug}@graffititv`,
            displayName:   gt.name,
            createdAt:     new Date(gt.createdAt || 0),
            role:          'owner',
            isAdmin:       true,
            isOwner:       true,
            _product:      'graffititv',
            _tenantDb:     gt.slug,
            _tenantDomain: `graffititv.madladslab.com/tv/${gt.slug}`,
            _tenantName:   gt.name,
            _tenantStatus: gt.active ? 'active' : 'disabled',
            _tenantPlan:   gt.plan,
            _isSuperAdmin: false,
            _gftv:         true,
            _gftvRole:     'owner',
            _subCount:     (td.subscribers||[]).length,
          });
        }

        // TV email subscribers
        for (const sub of (td.subscribers || [])) {
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            if (!(sub.email||'').toLowerCase().includes(q) &&
                !(sub.name||'').toLowerCase().includes(q)) continue;
          }
          allUsers.push({
            _id:           `gftv-sub-${gt.slug}-${sub.email}`,
            email:         sub.email,
            displayName:   sub.name || '',
            createdAt:     new Date(sub.date || 0),
            role:          'subscriber',
            isAdmin:       false,
            isOwner:       false,
            _product:      'graffititv',
            _tenantDb:     gt.slug,
            _tenantDomain: `graffititv.madladslab.com/tv/${gt.slug}`,
            _tenantName:   gt.name,
            _tenantStatus: gt.active ? 'active' : 'disabled',
            _tenantPlan:   gt.plan,
            _isSuperAdmin: false,
            _gftv:         true,
            _gftvRole:     'subscriber',
            _subCount:     null,
          });
        }
      }
    } catch(e) { console.error('[superadmin] GFTV users error:', e.message); }
  }

  allUsers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  res.render('superadmin/global-users', {
    superAdmin: req.superAdmin,
    users: allUsers,
    tenants,
    products: PRODUCTS,
    filters: { tenant: tenantFilter, role: roleFilter, q: searchQuery, product: productFilter },
    stats: {
      total: allUsers.length,
      admins: allUsers.filter(u => u.isAdmin).length,
      owners: allUsers.filter(u => u.isOwner).length,
      clients: allUsers.filter(u => u.role === 'client').length,
      superadmins: allUsers.filter(u => u._isSuperAdmin).length,
      gftvSubs: allUsers.filter(u => u._gftv).length,
    },
  });
});

router.post('/users/:tenantDb/:userId/toggle-admin', async (req, res) => {
  const tDb = getTenantDb(req.params.tenantDb);
  const user = await tDb.collection('users').findOne({ _id: new ObjectId(req.params.userId) });
  if (user) {
    // Prevent toggling admin on superadmin accounts
    if (isSuperAdminEmail(user.email)) {
      return res.redirect(`/superadmin/users?tenant=${req.params.tenantDb}`);
    }
    await tDb.collection('users').updateOne(
      { _id: user._id },
      { $set: { isAdmin: !user.isAdmin, updatedAt: new Date() } },
    );
    await logActivity({
      category: 'admin_action',
      action: `${user.isAdmin ? 'Revoked' : 'Granted'} tenant admin for ${user.email} in ${req.params.tenantDb}`,
      tenantDomain: req.params.tenantDb,
      actor: { email: req.superAdmin.email, role: 'superadmin' },
    });
  }
  res.redirect(`/superadmin/users?tenant=${req.params.tenantDb}`);
});

router.post('/users/:tenantDb/:userId/role', async (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin', 'client', 'collaborator'];
  if (!validRoles.includes(role)) return res.redirect('/superadmin/users');
  const tDb = getTenantDb(req.params.tenantDb);
  await tDb.collection('users').updateOne(
    { _id: new ObjectId(req.params.userId) },
    { $set: { role, updatedAt: new Date() } },
  );
  await logActivity({
    category: 'admin_action',
    action: `Changed role to ${role} for user ${req.params.userId}`,
    tenantDomain: req.params.tenantDb,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });
  res.redirect(`/superadmin/users?tenant=${req.params.tenantDb}`);
});

router.post('/users/:tenantDb/:userId/delete', async (req, res) => {
  const tDb = getTenantDb(req.params.tenantDb);
  const user = await tDb.collection('users').findOne({ _id: new ObjectId(req.params.userId) });
  if (user) {
    // Prevent deleting superadmin accounts
    if (isSuperAdminEmail(user.email)) {
      return res.redirect(`/superadmin/users?tenant=${req.params.tenantDb}`);
    }
    await tDb.collection('users').deleteOne({ _id: user._id });
    await logActivity({
      category: 'admin_action',
      action: `Deleted user ${user.email} from ${req.params.tenantDb}`,
      tenantDomain: req.params.tenantDb,
      actor: { email: req.superAdmin.email, role: 'superadmin' },
    });
  }
  res.redirect(`/superadmin/users?tenant=${req.params.tenantDb}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM PERMISSIONS — Manage superadmin access & platform roles
// ═══════════════════════════════════════════════════════════════════════════
router.get('/permissions', async (req, res) => {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find({}, { projection: { db: 1, domain: 1, 'brand.name': 1, status: 1 } }).toArray();

  // Gather all admins across tenants
  const tenantAdmins = [];
  for (const tenant of tenants) {
    try {
      const tDb = getTenantDb(tenant.db);
      const admins = await tDb.collection('users').find({ isAdmin: true }).toArray();
      for (const a of admins) {
        tenantAdmins.push({
          ...a,
          _tenantDb: tenant.db,
          _tenantDomain: tenant.domain,
          _tenantName: tenant.brand?.name || tenant.domain,
          _tenantStatus: tenant.status,
        });
      }
    } catch { /* skip */ }
  }

  // Get platform-level permission overrides from slab registry
  const platformRoles = await slab.collection('platform_roles').find().sort({ createdAt: -1 }).toArray().catch(() => []);

  res.render('superadmin/permissions', {
    superAdmin: req.superAdmin,
    tenantAdmins,
    platformRoles,
    tenants,
    stats: {
      totalAdmins: tenantAdmins.length,
      totalTenants: tenants.length,
      activeTenants: tenants.filter(t => t.status === 'active').length,
    },
  });
});

router.post('/permissions/platform-role', async (req, res) => {
  const { email, role, scope } = req.body;
  if (!email || !role) return res.redirect('/superadmin/permissions');
  const slab = getSlabDb();
  await slab.collection('platform_roles').updateOne(
    { email: email.toLowerCase() },
    { $set: { email: email.toLowerCase(), role, scope: scope || 'full', updatedAt: new Date(), grantedBy: req.superAdmin.email }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  await logActivity({
    category: 'admin_action',
    action: `Set platform role: ${email} → ${role} (${scope || 'full'})`,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });
  res.redirect('/superadmin/permissions');
});

router.post('/permissions/platform-role/:id/delete', async (req, res) => {
  const slab = getSlabDb();
  const role = await slab.collection('platform_roles').findOne({ _id: new ObjectId(req.params.id) });
  if (role) {
    await slab.collection('platform_roles').deleteOne({ _id: role._id });
    await logActivity({
      category: 'admin_action',
      action: `Removed platform role for ${role.email}`,
      actor: { email: req.superAdmin.email, role: 'superadmin' },
    });
  }
  res.redirect('/superadmin/permissions');
});

// ═══════════════════════════════════════════════════════════════════════════
// USER DETAIL — Full user profile with permissions, analytics, messaging
// ═══════════════════════════════════════════════════════════════════════════
router.get('/users/:tenantDb/:userId', async (req, res) => {
  const slab = getSlabDb();
  const tDb = getTenantDb(req.params.tenantDb);

  let user;
  try { user = await tDb.collection('users').findOne({ _id: new ObjectId(req.params.userId) }); }
  catch { return res.redirect('/superadmin/users'); }
  if (!user) return res.redirect('/superadmin/users');

  const tenant = await slab.collection('tenants').findOne({ db: req.params.tenantDb });

  // Activity for this user
  const userActivity = await getActivityLogs({ limit: 20 }).then(logs =>
    logs.filter(l => l.actor?.email === user.email)
  );

  // Ticket count for this user
  const userTickets = await tDb.collection('tickets').find({
    $or: [{ 'author.email': user.email }, { 'author.displayName': user.displayName }]
  }).sort({ createdAt: -1 }).limit(20).toArray();

  // Messages sent to this user from superadmin
  const messages = await slab.collection('superadmin_messages')
    .find({ recipientEmail: user.email, tenantDb: req.params.tenantDb })
    .sort({ createdAt: -1 }).limit(20).toArray().catch(() => []);

  // Analytics: login count, last login, content counts
  const analytics = {};
  try {
    analytics.blogCount = await tDb.collection('blog').countDocuments({ authorEmail: user.email });
    analytics.invoiceCount = await tDb.collection('invoices').countDocuments({ createdBy: user.email });
    analytics.clientCount = user.clientId ? 1 : 0;
  } catch { /* some collections may not exist */ }

  res.render('superadmin/user-detail', {
    superAdmin: req.superAdmin,
    user,
    tenant,
    tenantDb: req.params.tenantDb,
    userActivity,
    userTickets,
    messages,
    analytics,
    isSuperAdminUser: isSuperAdminEmail(user.email),
  });
});

router.post('/users/:tenantDb/:userId/permissions', async (req, res) => {
  const { permissions } = req.body;
  const permArray = (permissions || '').split(',').map(p => p.trim()).filter(Boolean);
  const tDb = getTenantDb(req.params.tenantDb);
  await tDb.collection('users').updateOne(
    { _id: new ObjectId(req.params.userId) },
    { $set: { permissions: permArray, updatedAt: new Date() } },
  );
  await logActivity({
    category: 'admin_action',
    action: `Updated permissions for user ${req.params.userId}: [${permArray.join(', ')}]`,
    tenantDomain: req.params.tenantDb,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });
  res.redirect(`/superadmin/users/${req.params.tenantDb}/${req.params.userId}`);
});

router.post('/users/:tenantDb/:userId/message', async (req, res) => {
  const { subject, body } = req.body;
  if (!body?.trim()) return res.redirect(`/superadmin/users/${req.params.tenantDb}/${req.params.userId}`);

  const tDb = getTenantDb(req.params.tenantDb);
  const user = await tDb.collection('users').findOne({ _id: new ObjectId(req.params.userId) });
  if (!user) return res.redirect('/superadmin/users');

  const slab = getSlabDb();
  const message = {
    recipientEmail: user.email,
    recipientName: user.displayName,
    tenantDb: req.params.tenantDb,
    subject: subject?.trim() || 'Message from Platform Admin',
    body: body.trim(),
    sender: { email: req.superAdmin.email, displayName: req.superAdmin.displayName || 'Platform Admin' },
    read: false,
    createdAt: new Date(),
  };
  await slab.collection('superadmin_messages').insertOne(message);

  await logActivity({
    category: 'admin_action',
    action: `Sent message to ${user.email}: "${message.subject}"`,
    tenantDomain: req.params.tenantDb,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });

  res.redirect(`/superadmin/users/${req.params.tenantDb}/${req.params.userId}?sent=1`);
});

router.post('/users/:tenantDb/:userId/update', async (req, res) => {
  const { displayName, role, isAdmin, isOwner } = req.body;
  const update = { updatedAt: new Date() };
  if (displayName !== undefined) update.displayName = displayName.trim();
  if (role) update.role = role;
  update.isAdmin = isAdmin === 'on' || isAdmin === 'true';
  update.isOwner = isOwner === 'on' || isOwner === 'true';

  const tDb = getTenantDb(req.params.tenantDb);
  await tDb.collection('users').updateOne(
    { _id: new ObjectId(req.params.userId) },
    { $set: update },
  );
  await logActivity({
    category: 'admin_action',
    action: `Updated user profile ${req.params.userId} in ${req.params.tenantDb}`,
    tenantDomain: req.params.tenantDb,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });
  res.redirect(`/superadmin/users/${req.params.tenantDb}/${req.params.userId}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIBERS — Manage captured subscriber data
// ═══════════════════════════════════════════════════════════════════════════
router.get('/subscribers', async (req, res) => {
  const slab = getSlabDb();
  const statusFilter = req.query.status || '';
  const filter = {};
  if (statusFilter && statusFilter !== 'all') filter.status = statusFilter;

  const subscribers = await slab.collection('subscribers').find(filter).sort({ createdAt: -1 }).toArray();
  const stats = {
    total: subscribers.length,
    active: subscribers.filter(s => s.status === 'active').length,
    interests: {},
  };
  subscribers.forEach(s => { stats.interests[s.interest || 'general'] = (stats.interests[s.interest || 'general'] || 0) + 1; });

  res.render('superadmin/subscribers', {
    superAdmin: req.superAdmin,
    subscribers,
    stats,
    filters: { status: statusFilter },
  });
});

router.post('/subscribers/:id/delete', async (req, res) => {
  const slab = getSlabDb();
  await slab.collection('subscribers').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/superadmin/subscribers');
});

// ═══════════════════════════════════════════════════════════════════════════
// GREEALITYTV — Community TV management
// ═══════════════════════════════════════════════════════════════════════════
router.get('/greealitytv', async (req, res) => {
  const client = new MongoClient(config.DB_URL || 'mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net');
  try {
    await client.connect();
    const grvDb = client.db('madLadsLab');

    const [users, posts, videos, petitions, locals, gigs, delegates] = await Promise.all([
      grvDb.collection('grv_users').find().toArray(),
      grvDb.collection('posts').countDocuments(),
      grvDb.collection('videos').countDocuments(),
      grvDb.collection('petitions').countDocuments(),
      grvDb.collection('locals').countDocuments(),
      grvDb.collection('gigs').countDocuments(),
      grvDb.collection('delegates').countDocuments().catch(() => 0),
    ]);

    const userStats = {
      total: users.length,
      admins: users.filter(u => u.isAdmin).length,
      contributors: users.filter(u => u.role === 'contributor').length,
      delegates: users.filter(u => u.role === 'delegate').length,
      verified: users.filter(u => u.isVerified).length,
    };

    res.render('superadmin/greealitytv', {
      superAdmin: req.superAdmin,
      users,
      userStats,
      contentStats: { posts, videos, petitions, locals, gigs, delegates },
    });
  } finally { await client.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN GATEWAY — Drop into any app's admin panel from superadmin
// ═══════════════════════════════════════════════════════════════════════════
const GATEWAY_APPS = {
  opsTrain:       { port: 3603, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'OpsTrain' },
  madladslab:     { port: 3000, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'MadLadsLab' },
  greealitytv:    { port: 3400, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'GreeAlityTV' },
  games:          { port: 3500, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'Games' },
  bih:            { port: 3055, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'BallzInHolez' },
  ps:             { port: 3399, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'Stringborn' },
  acm:            { port: 3004, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'ACM' },
  nocometalworkz: { port: 3002, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'NoCometal' },
};

function generateGatewayToken(app, email, secret, extra = {}) {
  const payload = JSON.stringify({ app, email, ts: Date.now(), ...extra });
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

router.get('/gateway/:app', (req, res) => {
  const appKey = req.params.app;
  const appDef = GATEWAY_APPS[appKey];
  if (!appDef) return res.status(404).send('Unknown app');

  const token = generateGatewayToken(appKey, req.superAdmin.email, appDef.secret);
  const protocol = req.protocol;
  const host = req.hostname.replace(/:\d+$/, '');

  // In production use the app's domain, in dev use localhost:port
  let targetUrl;
  if (config.NODE_ENV === 'production') {
    // Use the service registry domain if available
    const svc = getServices().find(s => s.name === appKey);
    targetUrl = svc?.domain
      ? `https://${svc.domain}/gateway?token=${token}`
      : `${protocol}://${host}:${appDef.port}/gateway?token=${token}`;
  } else {
    targetUrl = `${protocol}://${host}:${appDef.port}/gateway?token=${token}`;
  }

  res.redirect(targetUrl);
});

// API endpoint returning gateway info for all apps
router.get('/api/gateway', (req, res) => {
  const apps = Object.entries(GATEWAY_APPS).map(([key, def]) => ({
    key,
    label: def.label,
    port: def.port,
    url: `/superadmin/gateway/${key}`,
  }));
  res.json({ apps });
});

// ═══════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS — Platform-wide notifications to tenant admins
// ═══════════════════════════════════════════════════════════════════════════

// List all announcements
router.get('/announcements', async (req, res) => {
  const slab = getSlabDb();
  const announcements = await slab.collection('platform_notifications')
    .find().sort({ createdAt: -1 }).toArray();
  res.render('superadmin/announcements', {
    user: req.superAdmin,
    announcements,
  });
});

// Create announcement
router.post('/announcements', async (req, res) => {
  const slab = getSlabDb();
  const { title, message, type, audience } = req.body;
  if (!title || !message) return res.redirect('/superadmin/announcements');

  await slab.collection('platform_notifications').insertOne({
    title: title.trim(),
    message: message.trim(),
    type: type || 'info',
    audience: audience || 'all',
    createdBy: req.superAdmin.email,
    createdAt: new Date(),
    dismissedBy: [],
    status: 'published',
  });

  await logActivity({
    category: 'admin_action',
    action: `Published announcement: "${title.trim()}"`,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });

  res.redirect('/superadmin/announcements');
});

// Archive announcement
router.post('/announcements/:id/archive', async (req, res) => {
  const slab = getSlabDb();
  await slab.collection('platform_notifications').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: 'archived', archivedAt: new Date() } },
  );
  res.redirect('/superadmin/announcements');
});

// Delete announcement
router.post('/announcements/:id/delete', async (req, res) => {
  const slab = getSlabDb();
  await slab.collection('platform_notifications').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/superadmin/announcements');
});

// ── Graffiti TV SaaS ─────────────────────────────────────────────────────────
import { readFileSync as gftvReadFS, writeFileSync as gftvWriteFS, existsSync as gftvExistsFS } from 'fs';

const GFTV_DATA = '/srv/graffiti-tv/data';
const PLAN_PRICES_GFTV = { starter: 18, pro: 35 };

function gftvRead(file, def = []) {
  const p = `${GFTV_DATA}/${file}`;
  if (!gftvExistsFS(p)) return def;
  try { return JSON.parse(gftvReadFS(p, 'utf8')); } catch { return def; }
}

function gftvWrite(file, data) {
  gftvWriteFS(`${GFTV_DATA}/${file}`, JSON.stringify(data, null, 2));
}

// JSON API — dashboard tab loads this
router.get('/gftv/data', async (req, res) => {
  const tenants = gftvRead('tenants.json', []);
  const leads   = gftvRead('leads.json', []);
  const mrr     = tenants
    .filter(t => t.active && !t.isPromo)
    .reduce((a, t) => a + (PLAN_PRICES_GFTV[t.plan] || 0), 0);
  let totalSubs = 0;
  for (const t of tenants) {
    const d = gftvRead(`tenant-${t.slug}.json`, {});
    totalSubs += (d.subscribers || []).length;
  }
  res.json({ tenants, leads, mrr, totalSubs, planPrices: PLAN_PRICES_GFTV });
});

// Create tenant
router.post('/gftv/tenants', async (req, res) => {
  const tenants = gftvRead('tenants.json', []);
  const slug = (req.body.slug || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  if (!slug || !req.body.name) return res.status(400).json({ error: 'Name and slug required' });
  if (tenants.find(t => t.slug === slug)) return res.status(400).json({ error: 'Slug already exists' });
  const t = {
    id: slug, slug,
    name:         req.body.name,
    email:        req.body.email || '',
    plan:         req.body.plan || 'starter',
    active:       true,
    isPromo:      req.body.isPromo === 'true',
    createdAt:    new Date().toISOString(),
    passwordHash: req.body.password || 'changeme',
    branding: {
      name:     req.body.name,
      color:    req.body.color || '#ff5000',
      location: req.body.location || '',
    },
  };
  tenants.push(t);
  gftvWrite('tenants.json', tenants);
  gftvWrite(`tenant-${slug}.json`, { menu:[], specials:[], events:[], offerings:[], subscribers:[], analytics:{ themes:{} } });
  await logActivity({ category:'admin_action', action:`Created GFTV tenant: ${t.name} (${t.plan})`, actor:{ email: req.superAdmin.email, role:'superadmin' } });
  res.json({ ok: true, tenant: t });
});

// Update tenant
router.put('/gftv/tenants/:slug', async (req, res) => {
  let tenants = gftvRead('tenants.json', []);
  tenants = tenants.map(t => t.slug === req.params.slug ? { ...t, ...req.body } : t);
  gftvWrite('tenants.json', tenants);
  await logActivity({ category:'admin_action', action:`Updated GFTV tenant: ${req.params.slug}`, actor:{ email: req.superAdmin.email, role:'superadmin' } });
  res.json({ ok: true });
});

// Delete tenant
router.delete('/gftv/tenants/:slug', async (req, res) => {
  let tenants = gftvRead('tenants.json', []);
  tenants = tenants.filter(t => t.slug !== req.params.slug);
  gftvWrite('tenants.json', tenants);
  await logActivity({ category:'admin_action', action:`Deleted GFTV tenant: ${req.params.slug}`, actor:{ email: req.superAdmin.email, role:'superadmin' } });
  res.json({ ok: true });
});

// Toggle promo
router.post('/gftv/tenants/:slug/toggle-promo', async (req, res) => {
  let tenants = gftvRead('tenants.json', []);
  const t = tenants.find(x => x.slug === req.params.slug);
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.isPromo = !t.isPromo;
  gftvWrite('tenants.json', tenants);
  await logActivity({ category:'admin_action', action:`${t.isPromo ? 'Marked' : 'Unmarked'} GFTV tenant ${t.slug} as promo`, actor:{ email: req.superAdmin.email, role:'superadmin' } });
  if (req.headers.accept?.includes('application/json')) return res.json({ ok:true, isPromo:t.isPromo });
  res.redirect('/superadmin#tab-gftv');
});

// Update lead status
router.put('/gftv/leads/:id/status', async (req, res) => {
  let leads = gftvRead('leads.json', []);
  leads = leads.map(l => String(l.id) === String(req.params.id) ? { ...l, status: req.body.status } : l);
  gftvWrite('leads.json', leads);
  res.json({ ok: true });
});

// Tenant detail page
router.get('/gftv/tenants/:slug', async (req, res) => {
  const tenants = gftvRead('tenants.json', []);
  const tenant  = tenants.find(t => t.slug === req.params.slug);
  if (!tenant) return res.redirect('/superadmin#tab-gftv');
  const data = gftvRead(`tenant-${tenant.slug}.json`, {});
  res.render('superadmin/gftv-tenant-detail', {
    user: req.superAdmin,
    tenant,
    data,
    planPrices: PLAN_PRICES_GFTV,
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECURITY DASHBOARD — fail2ban events, jail status, system stats
// ═══════════════════════════════════════════════════════════════════════════
router.get("/security", async (req, res) => {
  const slab = getSlabDb();
  const [recentEvents, latestSnapshot, latestStats] = await Promise.all([
    slab.collection("security_events").find().sort({ timestamp: -1 }).limit(300).toArray(),
    slab.collection("security_snapshots").findOne({}, { sort: { createdAt: -1 } }),
    slab.collection("security_system_stats").findOne({}, { sort: { recordedAt: -1 } }),
  ]);
  const bans   = recentEvents.filter(e => e.action === "ban");
  const unbans = recentEvents.filter(e => e.action === "unban");
  const found  = recentEvents.filter(e => e.action === "found");
  const ipCount = {};
  for (const ev of recentEvents) if (ev.ip) ipCount[ev.ip] = (ipCount[ev.ip] || 0) + 1;
  const topIPs = Object.entries(ipCount).sort((a,b) => b[1]-a[1]).slice(0,10).map(([ip,count]) => ({ ip, count }));
  res.render("superadmin/security", {
    user: req.superAdmin,
    recentEvents,
    latestSnapshot,
    latestStats,
    summary: { bans: bans.length, unbans: unbans.length, found: found.length, total: recentEvents.length },
    topIPs,
    currentJails: latestSnapshot?.bans || [],
  });
});

router.get("/api/security/summary", async (req, res) => {
  const slab = getSlabDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [events, snapshot, stats] = await Promise.all([
    slab.collection("security_events").find({ timestamp: { $gte: since } }).sort({ timestamp: -1 }).toArray(),
    slab.collection("security_snapshots").findOne({}, { sort: { createdAt: -1 } }),
    slab.collection("security_system_stats").findOne({}, { sort: { recordedAt: -1 } }),
  ]);
  res.json({ ok: true, events: events.slice(0,50), jails: snapshot?.bans || [], stats,
    summary: { bans: events.filter(e=>e.action==="ban").length, unbans: events.filter(e=>e.action==="unban").length, found: events.filter(e=>e.action==="found").length } });
});


// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM EVENTS — signups, contacts, bookings across all apps
// ═══════════════════════════════════════════════════════════════════════════
router.get('/events', async (req, res) => {
  const slab = getSlabDb();

  const typeFilter = req.query.type || '';
  const appFilter  = req.query.app  || '';
  const limit = parseInt(req.query.limit) || 100;

  const query = {};
  if (typeFilter) query.type = typeFilter;
  if (appFilter)  query.app  = appFilter;

  const [events, total, stats] = await Promise.all([
    slab.collection('platform_events').find(query).sort({ createdAt: -1 }).limit(limit).toArray(),
    slab.collection('platform_events').countDocuments(),
    slab.collection('platform_events').aggregate([
      { $group: { _id: { type: '$type', app: '$app' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
  ]);

  // Tally by type for today
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayCounts = await slab.collection('platform_events').aggregate([
    { $match: { createdAt: { $gte: todayStart } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]).toArray();
  const today = {};
  todayCounts.forEach(t => { today[t._id] = t.count; });

  res.render('superadmin/events', {
    user: req.superAdmin,
    events,
    total,
    stats,
    today,
    filters: { type: typeFilter, app: appFilter },
  });
});

router.get('/api/events/stream', async (req, res) => {
  const slab = getSlabDb();
  const since = new Date(Date.now() - 5 * 60 * 1000); // last 5 min
  const events = await slab.collection('platform_events')
    .find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 }).limit(20).toArray();
  res.json({ events, count: events.length });
});

export default router;
