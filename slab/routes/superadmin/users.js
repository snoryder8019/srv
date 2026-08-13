import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../../middleware/superadmin.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import { createLoginToken } from '../../middleware/jwtAuth.js';
import { config } from '../../config/config.js';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import { logActivity, getActivityLogs, getSignupFunnel } from '../../plugins/activityLog.js';
import { scanSrv, scanSrvSummary } from '../../plugins/srvScan.js';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getServices, getServicesByCategory, getService, getInfraServices, PRODUCTS } from '../../plugins/serviceRegistry.js';
import { FEATURES, STAGES, STAGE_LABELS, resolveStage, defaultStage } from '../../plugins/featureRegistry.js';
import { s3Client, BUCKET } from '../../plugins/s3.js';
import { ListObjectsV2Command, HeadBucketCommand } from '@aws-sdk/client-s3';
import scottsGatewayRouter, { redeemTvPair, tvOrSuper, missionControlHandler, publicPairRequest, publicPairPoll } from './scottsGateway.js';
import {
  TENANT_TAGS, PLAN_LABELS, sendSubscriptionEmail, noStore, safeExec,
  ollamaBase, ollamaFetch, ollamaHealth, OLLAMA_SERVICE_NAMES,
  infraCache, INFRA_TTL_MS, pingMongo, pingBucket, pingOllamaAll, refreshInfra, getInfraCached,
  pulseCache, ERR_RE, countErrorLines, tmuxTail, sysSnapshot, peerLabel,
  DEPR_ROOT, DEPR_STAGES, readJsonFile, getDeprecationPipeline, getDeprecatableSrvProjects,
  GATEWAY_APPS, generateGatewayToken, GFTV_DATA, PLAN_PRICES_GFTV, gftvRead, gftvWrite,
} from './shared.js';

const router = express.Router();

// A real PAYING subscriber: on a recurring plan (monthly/quarterly/annual) AND
// with a Stripe/PayPal go-live payment on file. Everything else is non-paying —
// including comped 'lifetime' (a retired tier, $0 recurring) and the stale legacy
// 'pro' plan. This is the "paying vs non-paying" division that matters for a
// real-user read; the raw plan is still shown as a chip for context.
const PAYING_PLANS = new Set(['monthly', 'quarterly', 'annual']);
function isPayingTenant(tenant) {
  const plan = tenant.meta?.plan;
  const hasProcessorTxn = !!(tenant.meta?.stripeSessionId || tenant.meta?.paypalCaptureId);
  return PAYING_PLANS.has(plan) && hasProcessorTxn;
}

// System / test accounts — seeded bots, smoke-test users, internal scanners. These
// are not real people, so they're flagged 'system use' and muted from the list by
// default (reveal with ?system=1). Kept narrow so a real user never matches.
function isSystemAccount(u) {
  const e = (u.email || '').toLowerCase();
  if (!e) return false;
  return e.endsWith('@slab.system')
      || e.endsWith('@test.com')
      || /^fakebot\d*@/.test(e)
      || e.startsWith('scanner-test@')
      || e === 'bot@slab.system';
}

// A readable-but-strong one-time password (no ambiguous chars). Used when a
// superadmin resets a tenant user's or delegate's password — shown ONCE to the
// superadmin to relay; NEVER logged in plaintext.
export function genTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n)).map((b) => chars[b % chars.length]).join('');
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
}

router.get('/users', async (req, res) => {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find({}, { projection: { db: 1, dbHost: 1, domain: 1, 'brand.name': 1, status: 1, platform: 1, 'meta.plan': 1, 'meta.ownerEmail': 1, 'meta.stripeSessionId': 1, 'meta.paypalCaptureId': 1 } }).toArray();

  const tenantFilter = req.query.tenant || '';
  const roleFilter   = req.query.role || '';
  const searchQuery   = req.query.q || '';
  const productFilter = req.query.product || '';
  const accountFilter = req.query.account || '';   // '', 'premium', 'free'
  const showSystem    = req.query.system === '1';  // reveal muted system/bot accounts
  const allUsers = [];
  const failedTenants = [];   // tenants whose users could NOT be loaded (so we surface, not hide)

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
      const plan = tenant.meta?.plan || 'free';
      const premium = isPayingTenant(tenant);   // _premium now means "real paying subscriber"
      if (accountFilter === 'premium' && !premium) continue;
      if (accountFilter === 'free' && premium) continue;
      const ownerEmail = (tenant.meta?.ownerEmail || '').toLowerCase();
      try {
        // Pass dbHost explicitly — all live tenants sit on the self-hosted 'gpu'
        // cluster; relying on the host-map default is fragile.
        const tDb = getTenantDb(tenant.db, tenant.dbHost);
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
            _tenantPlan: plan,
            _premium: premium,
            _isOwnerAccount: !!ownerEmail && (u.email || '').toLowerCase() === ownerEmail,
            _isSuperAdmin: isSuperAdminEmail(u.email),
          });
        }
      } catch (e) {
        // Do NOT silently drop the tenant — a gpu-tunnel blip would otherwise
        // empty the whole page with no signal. Record it so the view can warn.
        failedTenants.push({ db: tenant.db, name: tenant.brand?.name || tenant.domain, error: e.message });
        console.error(`[superadmin/users] failed to load ${tenant.db}:`, e.message);
      }
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

  // Flag system/bot accounts, then mute them from the visible list unless asked for.
  for (const u of allUsers) u._system = isSystemAccount(u);
  const systemCount = allUsers.filter(u => u._system).length;
  const users = showSystem ? allUsers : allUsers.filter(u => !u._system);

  res.render('superadmin/global-users', {
    superAdmin: req.superAdmin,
    users,
    tenants,
    products: PRODUCTS,
    failedTenants,
    showSystem,
    filters: { tenant: tenantFilter, role: roleFilter, q: searchQuery, product: productFilter, account: accountFilter },
    stats: {
      total: users.length,
      admins: users.filter(u => u.isAdmin).length,
      owners: users.filter(u => u.isOwner).length,
      clients: users.filter(u => u.role === 'client').length,
      superadmins: users.filter(u => u._isSuperAdmin).length,
      gftvSubs: users.filter(u => u._gftv).length,
      premium: users.filter(u => u._premium).length,
      free: users.filter(u => u._product === 'slab' && !u._premium).length,
      system: systemCount,
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
  // Keep isAdmin in sync with the role — admins and collaborators (restricted
  // admins) get panel access; clients are portal-only. See routes/admin/users.js.
  await tDb.collection('users').updateOne(
    { _id: new ObjectId(req.params.userId) },
    { $set: { role, isAdmin: role === 'admin' || role === 'collaborator', updatedAt: new Date() } },
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

// ── Reset a tenant user's password ────────────────────────────────────────────
// Sets a fresh temporary password (adds the 'local' provider so email login works
// even for a Google-only account) and hands it back to the superadmin ONCE via a
// query param. The plaintext is never persisted or logged.
router.post('/users/:tenantDb/:userId/reset-password', async (req, res) => {
  const back = `/superadmin/users/${req.params.tenantDb}/${req.params.userId}`;
  const tDb = getTenantDb(req.params.tenantDb);
  let user;
  try { user = await tDb.collection('users').findOne({ _id: new ObjectId(req.params.userId) }); }
  catch { return res.redirect('/superadmin/users'); }
  if (!user) return res.redirect('/superadmin/users');

  const tempPw = genTempPassword();
  const hash = await bcrypt.hash(tempPw, 12);
  const providers = [...new Set([...(user.providers || (user.provider ? [user.provider] : [])), 'local'])];
  await tDb.collection('users').updateOne(
    { _id: user._id },
    { $set: { password: hash, providers, updatedAt: new Date() } },
  );
  await logActivity({
    category: 'admin_action',
    action: `Reset password for ${user.email} in ${req.params.tenantDb}`,
    tenantDomain: req.params.tenantDb,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });
  res.redirect(`${back}?tmppw=${encodeURIComponent(tempPw)}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM FEATURES — Set each admin feature's release stage platform-wide.
//   experimental → hidden until a tenant opts in (/admin/labs), badged "exp"
//   beta         → visible to all tenants, badged "beta"
//   visible      → visible to all tenants (GA), no badge
//   off          → hidden from all tenants
// Superadmins always see every feature regardless of stage.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/features', async (req, res) => {
  const slab = getSlabDb();
  const rows = await slab.collection('platform_features').find({}).toArray().catch(() => []);
  const byKey = {};
  for (const r of rows) byKey[r.key] = r;

  res.render('superadmin/features', {
    superAdmin: req.superAdmin,
    stages: STAGES,
    stageLabels: STAGE_LABELS,
    features: FEATURES.map((f) => ({
      key: f.key,
      label: f.label,
      section: f.section,
      url: f.url,
      stage: resolveStage(f, byKey[f.key]?.stage ? { [f.key]: byKey[f.key].stage } : {}),
      isDefault: !byKey[f.key]?.stage,
      defaultStage: defaultStage(f),
      updatedAt: byKey[f.key]?.updatedAt || null,
      updatedBy: byKey[f.key]?.updatedBy || null,
    })),
  });
});

router.post('/features/stage', async (req, res) => {
  const { key, stage } = req.body;
  const feature = FEATURES.find((f) => f.key === key);
  if (!feature || !STAGES.includes(stage)) return res.redirect('/superadmin/features');

  const slab = getSlabDb();
  await slab.collection('platform_features').updateOne(
    { key },
    {
      $set: { key, stage, updatedAt: new Date(), updatedBy: req.superAdmin.email },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  await logActivity({
    category: 'admin_action',
    action: `Feature "${key}" stage → ${stage} (platform-wide)`,
    actor: { email: req.superAdmin.email, role: 'superadmin' },
  });
  res.redirect('/superadmin/features');
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
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

// ── Grant tenant admin by email — creates the user in the tenant DB if absent ──
// The everyday "give this person admin on that site" action. If the email already
// exists in the tenant it's elevated to admin; otherwise a fresh admin user is
// created (no password yet — they sign in via Google or a superadmin reset link).
router.post('/permissions/grant-tenant-admin', async (req, res) => {
  const back = '/superadmin/permissions';
  const email = (req.body.email || '').toLowerCase().trim();
  const tenantDb = (req.body.tenantDb || '').trim();
  const displayName = (req.body.displayName || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !tenantDb) {
    return res.redirect(`${back}?error=${encodeURIComponent('A valid email and a tenant are required.')}`);
  }
  const slab = getSlabDb();
  const tenant = await slab.collection('tenants').findOne({ db: tenantDb });
  if (!tenant) return res.redirect(`${back}?error=${encodeURIComponent('Tenant not found.')}`);
  try {
    const tDb = getTenantDb(tenant.db, tenant.dbHost);
    const existing = await tDb.collection('users').findOne({ email });
    if (existing) {
      await tDb.collection('users').updateOne(
        { _id: existing._id },
        { $set: { isAdmin: true, role: 'admin', updatedAt: new Date() } },
      );
    } else {
      await tDb.collection('users').insertOne({
        email,
        displayName: displayName || email.split('@')[0],
        isAdmin: true,
        role: 'admin',
        providers: [],
        createdAt: new Date(),
      });
    }
    await logActivity({
      category: 'admin_action',
      action: `Granted tenant admin to ${email} in ${tenant.db}${existing ? '' : ' (new user)'}`,
      tenantDomain: tenant.db,
      actor: { email: req.superAdmin.email, role: 'superadmin' },
    });
    const label = tenant.brand?.name || tenant.domain || tenant.db;
    res.redirect(`${back}?success=${encodeURIComponent(`${existing ? 'Elevated' : 'Created'} admin ${email} on ${label}.`)}`);
  } catch (e) {
    console.error('[superadmin/grant-tenant-admin] error:', e.message);
    res.redirect(`${back}?error=${encodeURIComponent('Failed to grant admin: ' + e.message)}`);
  }
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
    tmppw: req.query.tmppw || null,
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

export default router;
