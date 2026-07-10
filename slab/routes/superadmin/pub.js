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


export default router;
