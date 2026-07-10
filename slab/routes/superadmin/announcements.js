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

export default router;
