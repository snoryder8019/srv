import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../../middleware/superadmin.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import { createLoginToken } from '../../middleware/jwtAuth.js';
import { config } from '../../config/config.js';
import nodemailer from 'nodemailer';
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

router.get('/tenants/:id', async (req, res) => {
  const slab = getSlabDb();
  let tenant;
  try {
    tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  } catch { return res.redirect('/superadmin'); }
  if (!tenant) return res.redirect('/superadmin');

  // Get tenant DB stats + activity logs in parallel
  const tenantDb = getTenantDb(tenant.db, tenant.dbHost);
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

export default router;
