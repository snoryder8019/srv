/**
 * Slab — Superadmin routes (inside admin panel)
 * Mounted at /admin/super — requires both admin JWT + superadmin JWT.
 *
 * /admin/super/tenants          → tenant list
 * /admin/super/tenants/:id      → tenant detail + actions
 * /admin/super/tenants/:id/impersonate → login as tenant admin
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { requireSuperInAdmin } from '../../middleware/superadmin.js';
import { createLoginToken } from '../../middleware/jwtAuth.js';
import { bustTenantCache } from '../../middleware/tenant.js';

const router = express.Router();

// ── Tenant tag definitions ─────────────────────────────────────────────────
const TENANT_TAGS = {
  vip:              { label: 'VIP',              color: '#c9a848', bg: 'rgba(201,168,72,0.12)' },
  'hot-lead':       { label: 'Hot Lead',         color: '#f97316', bg: 'rgba(249,115,22,0.10)' },
  'needs-onboarding': { label: 'Needs Onboarding', color: '#0ea5e9', bg: 'rgba(14,165,233,0.10)' },
  'needs-design':   { label: 'Needs Design',     color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' },
  'needs-content':  { label: 'Needs Content',    color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  'at-risk':        { label: 'At Risk',          color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  enterprise:       { label: 'Enterprise',       color: '#1e293b', bg: 'rgba(30,41,59,0.10)' },
  'power-user':     { label: 'Power User',       color: '#eab308', bg: 'rgba(234,179,8,0.10)' },
};

// ── Integration checks (works on raw tenant docs, encrypted secrets are still truthy)
const CONFIG_CHECKS = {
  email:    { label: 'Email',     icon: '✉', test: t => !!(t.public?.zohoUser || t.secrets?.zohoUser) && !!t.secrets?.zohoPass },
  stripe:   { label: 'Stripe',    icon: '💳', test: t => !!t.secrets?.stripeSecret },
  paypal:   { label: 'PayPal',    icon: 'PP', test: t => !!t.public?.paypalClientId && !!t.secrets?.paypalSecret },
  google:   { label: 'Google',    icon: 'G',  test: t => !!t.public?.googlePlacesKey },
  oauth:    { label: 'OAuth',     icon: '🔑', test: t => !!t.public?.googleOAuthClientId && !!t.secrets?.googleOAuthSecret },
  domain:   { label: 'Custom Domain', icon: '🌐', test: t => !!t.meta?.customDomain || !!t.public?.customDomain },
};

function getConfigStatus(tenant) {
  const out = {};
  for (const [key, check] of Object.entries(CONFIG_CHECKS)) {
    out[key] = check.test(tenant);
  }
  out._count = Object.values(out).filter(Boolean).length;
  out._total = Object.keys(CONFIG_CHECKS).length;
  return out;
}

// All routes require superadmin
router.use(requireSuperInAdmin);

// ── Tenants List ────────────────────────────────────────────────────────────
router.get('/tenants', async (req, res) => {
  const slab = getSlabDb();
  const [tenants, stats] = await Promise.all([
    slab.collection('tenants').find().sort({ createdAt: -1 }).toArray(),
    Promise.all([
      slab.collection('tenants').countDocuments(),
      slab.collection('tenants').countDocuments({ status: 'active' }),
      slab.collection('tenants').countDocuments({ status: 'preview' }),
      slab.collection('tenants').countDocuments({ status: 'suspended' }),
    ]).then(([total, active, preview, suspended]) => ({ total, active, preview, suspended })),
  ]);

  // Compute config status per tenant
  const configMap = {};
  for (const t of tenants) configMap[t._id.toString()] = getConfigStatus(t);

  res.render('admin/super/tenants', {
    user: req.adminUser,
    page: 'super-tenants',
    tenants,
    stats,
    tagDefs: TENANT_TAGS,
    configMap,
    configChecks: CONFIG_CHECKS,
  });
});

// ── Tenant Detail ───────────────────────────────────────────────────────────
router.get('/tenants/:id', async (req, res) => {
  const slab = getSlabDb();
  let tenant;
  try {
    tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  } catch { return res.redirect('/admin/super/tenants'); }
  if (!tenant) return res.redirect('/admin/super/tenants');

  // Get tenant DB stats
  const tenantDb = getTenantDb(tenant.db);
  const [blogCount, clientCount, pageCount, invoiceCount, userCount] = await Promise.all([
    tenantDb.collection('blog').countDocuments().catch(() => 0),
    tenantDb.collection('clients').countDocuments().catch(() => 0),
    tenantDb.collection('pages').countDocuments().catch(() => 0),
    tenantDb.collection('invoices').countDocuments().catch(() => 0),
    tenantDb.collection('users').countDocuments().catch(() => 0),
  ]);

  res.render('admin/super/tenant-detail', {
    user: req.adminUser,
    page: 'super-tenants',
    tenant,
    dbStats: { blogCount, clientCount, pageCount, invoiceCount, userCount },
    error: req.query.error || null,
    tagDefs: TENANT_TAGS,
    configStatus: getConfigStatus(tenant),
    configChecks: CONFIG_CHECKS,
  });
});

// ── Activate Tenant ─────────────────────────────────────────────────────────
router.post('/tenants/:id/activate', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/admin/super/tenants');

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
  res.redirect(`/admin/super/tenants/${req.params.id}`);
});

// ── Change Plan ─────────────────────────────────────────────────────────────
router.post('/tenants/:id/change-plan', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/admin/super/tenants');

  const plan = req.body.plan || 'monthly';
  let expiresAt = null;
  const now = new Date();
  if (plan === 'monthly') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  else if (plan === '30day') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  else if (plan === '120day') expiresAt = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  else if (plan === 'annual') expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const update = {
    'meta.plan': plan,
    'meta.expiresAt': expiresAt,
    updatedAt: now,
  };

  if (plan === 'free') {
    update.status = 'preview';
    update['meta.plan'] = 'free';
    update['meta.expiresAt'] = null;
  }

  await slab.collection('tenants').updateOne({ _id: tenant._id }, { $set: update });
  bustTenantCache(tenant.domain);
  res.redirect(`/admin/super/tenants/${req.params.id}`);
});

// ── Suspend Tenant ──────────────────────────────────────────────────────────
router.post('/tenants/:id/suspend', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/admin/super/tenants');
  await slab.collection('tenants').updateOne(
    { _id: tenant._id },
    { $set: { status: 'suspended', updatedAt: new Date() } }
  );
  bustTenantCache(tenant.domain);
  res.redirect(`/admin/super/tenants/${req.params.id}`);
});

// ── Delete Tenant ───────────────────────────────────────────────────────────
router.post('/tenants/:id/delete', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/admin/super/tenants');
  await slab.collection('tenants').deleteOne({ _id: tenant._id });
  bustTenantCache(tenant.domain);
  res.redirect('/admin/super/tenants');
});

// ── Toggle Tenant Tags ─────────────────────────────────────────────────────
router.post('/tenants/:id/tags', async (req, res) => {
  const { tag, action } = req.body;
  if (!tag || !TENANT_TAGS[tag]) return res.redirect(`/admin/super/tenants/${req.params.id}`);

  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/admin/super/tenants');

  const op = action === 'remove'
    ? { $pull: { tags: tag }, $set: { updatedAt: new Date() } }
    : { $addToSet: { tags: tag }, $set: { updatedAt: new Date() } };

  await slab.collection('tenants').updateOne({ _id: tenant._id }, op);
  bustTenantCache(tenant.domain);
  res.redirect(`/admin/super/tenants/${req.params.id}`);
});

// ── Impersonate (Login as Tenant Admin) ─────────────────────────────────────
router.post('/tenants/:id/impersonate', async (req, res) => {
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  if (!tenant) return res.redirect('/admin/super/tenants');

  // Find the tenant's admin user
  const tenantDb = getTenantDb(tenant.db);
  const adminUser = await tenantDb.collection('users').findOne({
    isAdmin: true,
  });
  if (!adminUser) {
    return res.redirect(`/admin/super/tenants/${req.params.id}?error=no-admin-user`);
  }

  // Mint a one-time login token for the tenant's admin
  const token = createLoginToken(adminUser);

  // Redirect to the tenant's admin panel with the login token
  const protocol = req.protocol;
  res.redirect(`${protocol}://${tenant.domain}/admin?token=${token}`);
});

// ── Escalated Tickets ──────────────────────────────────────────────────────

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

  res.render('admin/super/tickets', {
    user: req.adminUser,
    page: 'super-tickets',
    tickets,
    stats,
    filters: { status: req.query.status || '' },
  });
});

router.get('/tickets/:tenantDb/:ticketId', async (req, res) => {
  try {
    const tenantDb = getTenantDb(req.params.tenantDb);
    const ticket = await tenantDb.collection('tickets').findOne({ _id: new ObjectId(req.params.ticketId) });
    if (!ticket) return res.redirect('/admin/super/tickets');

    res.render('admin/super/ticket-detail', {
      user: req.adminUser,
      page: 'super-tickets',
      ticket,
      tenantDbName: req.params.tenantDb,
    });
  } catch {
    res.redirect('/admin/super/tickets');
  }
});

router.post('/tickets/:tenantDb/:ticketId/reply', async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.redirect(`/admin/super/tickets/${req.params.tenantDb}/${req.params.ticketId}`);

  const tenantDb = getTenantDb(req.params.tenantDb);
  const reply = {
    _id: new ObjectId(),
    author: {
      type: 'superadmin',
      email: req.adminUser.email,
      displayName: req.adminUser.displayName + ' (Platform)',
    },
    body: body.trim(),
    attachments: [],
    createdAt: new Date(),
  };

  await tenantDb.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.ticketId) },
    { $push: { replies: reply }, $set: { updatedAt: new Date() } },
  );
  res.redirect(`/admin/super/tickets/${req.params.tenantDb}/${req.params.ticketId}`);
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

  res.redirect('/admin/super/tickets');
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

  res.redirect('/admin/super/tickets');
});

export default router;
