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

export default router;
