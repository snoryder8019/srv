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

  res.render('admin/super/tenants', {
    user: req.adminUser,
    page: 'super-tenants',
    tenants,
    stats,
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

export default router;
