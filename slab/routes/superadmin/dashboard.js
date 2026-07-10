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

router.get('/', async (req, res) => {
  const slab = getSlabDb();

  // Live /srv scan — the actual directories on disk, overlaid with the registry.
  const srv = scanSrv();
  const srvSummary = scanSrvSummary(srv);

  const [tenants, openTickets, activityLogs, signupFunnel] = await Promise.all([
    slab.collection('tenants').find().sort({ 'meta.lastSeenAt': -1, createdAt: -1 }).toArray(),
    slab.collection('escalated_tickets').countDocuments({ status: 'escalated' }).catch(() => 0),
    getActivityLogs({ limit: 30 }),
    getSignupFunnel({ recentErrors: 15 }),
  ]);

  const active = tenants.filter(t => t.status === 'active').length;
  const preview = tenants.filter(t => t.status === 'preview' || !t.status).length;
  const suspended = tenants.filter(t => t.status === 'suspended').length;

  res.render('superadmin/dashboard', {
    user: req.superAdmin,
    srv,
    srvSummary,
    tenants,
    tagDefs: TENANT_TAGS,
    stats: {
      total: tenants.length, active, preview, suspended,
      promo: tenants.filter(t => t.meta?.isPromo).length,
      mrr: tenants.filter(t => t.status === 'active' && !t.meta?.isPromo).length * 50,
    },
    openTickets,
    signupFunnel,
    activityLogs,
  });
});

// ── Tenant detail ───────────────────────────────────────────────────────────
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
      const tdb = getTenantDb(t.db, t.dbHost);
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

export default router;
