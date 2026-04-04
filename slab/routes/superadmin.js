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
import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../middleware/superadmin.js';
import { bustTenantCache } from '../middleware/tenant.js';
import { config } from '../config/config.js';
import nodemailer from 'nodemailer';
import { logActivity, getActivityLogs } from '../plugins/activityLog.js';

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

// ── All routes below require superadmin ─────────────────────────────────────
router.use(requireSuperAdmin);

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const slab = getSlabDb();
  const [
    totalTenants,
    activeTenants,
    previewTenants,
    suspendedTenants,
    recentSignups,
    allTenants,
    activityLogs,
  ] = await Promise.all([
    slab.collection('tenants').countDocuments(),
    slab.collection('tenants').countDocuments({ status: 'active' }),
    slab.collection('tenants').countDocuments({ status: 'preview' }),
    slab.collection('tenants').countDocuments({ status: 'suspended' }),
    slab.collection('signups').find().sort({ createdAt: -1 }).limit(10).toArray(),
    slab.collection('tenants').find().sort({ createdAt: -1 }).toArray(),
    getActivityLogs({ limit: 30 }),
  ]);

  const monthlyRevenue = activeTenants * 50; // rough estimate

  res.render('superadmin/dashboard', {
    user: req.superAdmin,
    stats: { totalTenants, activeTenants, previewTenants, suspendedTenants, monthlyRevenue },
    tenants: allTenants,
    recentSignups,
    tagDefs: TENANT_TAGS,
    activityLogs,
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

export default router;
