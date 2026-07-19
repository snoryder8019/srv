import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../../middleware/superadmin.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import { createLoginToken } from '../../middleware/jwtAuth.js';
import { config } from '../../config/config.js';
import { PLANS, BASE_MONTHLY } from '../../config/pricing.js';
import nodemailer from 'nodemailer';
import { logActivity, getActivityLogs, getSignupFunnel } from '../../plugins/activityLog.js';
import { getRouteUsageSummary } from '../../plugins/routeUsage.js';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getServices, getServicesByCategory, getService, getInfraServices, PRODUCTS } from '../../plugins/serviceRegistry.js';
import { FEATURES, STAGES, STAGE_LABELS, resolveStage, defaultStage } from '../../plugins/featureRegistry.js';
import { s3Client, BUCKET } from '../../plugins/s3.js';
import { readToolUsage } from '../../plugins/agentMcp.js';
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

// Monthly-recurring value of a tenant's plan, single-sourced from config/pricing.js.
// 'pro' = legacy label for the standard base sub; free/trial/lifetime = $0 recurring
// (lifetime is a one-time payment, so it never counts toward MRR).
function planMonthly(plan) {
  if (!plan || plan === 'free') return 0;
  if (plan === 'pro') return BASE_MONTHLY;
  return PLANS[plan]?.monthly || 0;
}

router.get('/', async (req, res) => {
  const slab = getSlabDb();

  const [tenants, openTickets, activityLogs, signupFunnel] = await Promise.all([
    slab.collection('tenants').find().sort({ 'meta.lastSeenAt': -1, createdAt: -1 }).toArray(),
    slab.collection('escalated_tickets').countDocuments({ status: 'escalated' }).catch(() => 0),
    getActivityLogs({ limit: 30 }),
    getSignupFunnel({ recentErrors: 15 }),
  ]);

  const active = tenants.filter(t => t.status === 'active').length;
  const preview = tenants.filter(t => t.status === 'preview' || !t.status).length;
  const suspended = tenants.filter(t => t.status === 'suspended').length;

  // Real monthly recurring revenue: sum each active, non-promo tenant's actual
  // plan price. Lifetime is a one-time payment (never recurring → $0); free/trial
  // are $0; 'pro' is the legacy label for the standard base subscription.
  const payingTenants = tenants.filter(t => t.status === 'active' && !t.meta?.isPromo);
  const mrr = payingTenants.reduce((sum, t) => sum + planMonthly(t.meta?.plan), 0);

  res.render('superadmin/dashboard', {
    user: req.superAdmin,
    tenants,
    tagDefs: TENANT_TAGS,
    stats: {
      total: tenants.length, active, preview, suspended,
      promo: tenants.filter(t => t.meta?.isPromo).length,
      mrr: Math.round(mrr),
      mrrExact: mrr.toFixed(2),
      payingCount: payingTenants.filter(t => planMonthly(t.meta?.plan) > 0).length,
    },
    openTickets,
    signupFunnel,
    activityLogs,
  });
});

// ── Route-usage analytics (global + per-tenant) ──────────────────────────────
// Which app endpoints tenants actually hit — the signal that replaced the old
// /srv overview. Feeds the charts on the dashboard. ?days=7|30|90, ?tenantDb=…
router.get('/route-usage', async (req, res) => {
  try {
    const days = [7, 30, 90].includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 30;
    const tenantDb = req.query.tenantDb && req.query.tenantDb !== 'all' ? String(req.query.tenantDb) : null;
    const data = await getRouteUsageSummary({ days, tenantDb });
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    console.error('[superadmin/route-usage] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── MCP tool-usage scoreboard (global, cross-tenant) ─────────────────────────
// The platform-owner view of which agent tools users actually call — the data
// that drives tool right-sizing (split the heavy, cut the dead, add where demand
// is). Reads the aggregated counters written by runTool() from the slab master
// DB; no tenantKey = rolled up across every tenant.
router.get('/tool-usage', async (req, res) => {
  try {
    const tools = await readToolUsage({});
    const totals = tools.reduce((a, t) => {
      a.calls += t.calls; a.ok += t.ok; a.err += t.err; return a;
    }, { calls: 0, ok: 0, err: 0 });
    totals.successPct = totals.calls ? Math.round((totals.ok / totals.calls) * 100) : null;
    res.set('Cache-Control', 'no-store');
    res.json({ scope: 'global', totals, tools });
  } catch (err) {
    console.error('[superadmin/tool-usage] error:', err);
    res.status(500).json({ error: err.message });
  }
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

// ── Token analytics ─────────────────────────────────────────────────────────
// Aggregates slab.token_usage (one row per LLM call, written by the engine seam
// in plugins/agentEngine.js). Anthropic usage is exact; house/Ollama rows appear
// only when that backend reports a usage block.
router.get('/token-analytics', async (req, res) => {
  const slab = getSlabDb();
  const col = slab.collection('token_usage');
  const days = [7, 30, 90].includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 30;
  const since = new Date(Date.now() - days * 86400 * 1000);
  const match = { at: { $gte: since } };

  const [totals, byEngine, byModel, byTenant, daily] = await Promise.all([
    col.aggregate([{ $match: match }, { $group: { _id: null, calls: { $sum: 1 }, input: { $sum: '$inputTokens' }, output: { $sum: '$outputTokens' }, total: { $sum: '$totalTokens' }, cacheRead: { $sum: '$cacheReadTokens' } } }]).toArray(),
    col.aggregate([{ $match: match }, { $group: { _id: '$engine', calls: { $sum: 1 }, total: { $sum: '$totalTokens' } } }, { $sort: { total: -1 } }]).toArray(),
    col.aggregate([{ $match: match }, { $group: { _id: '$model', calls: { $sum: 1 }, input: { $sum: '$inputTokens' }, output: { $sum: '$outputTokens' }, total: { $sum: '$totalTokens' } } }, { $sort: { total: -1 } }]).toArray(),
    col.aggregate([{ $match: match }, { $group: { _id: { domain: '$tenantDomain', db: '$tenantDb' }, calls: { $sum: 1 }, input: { $sum: '$inputTokens' }, output: { $sum: '$outputTokens' }, total: { $sum: '$totalTokens' } } }, { $sort: { total: -1 } }, { $limit: 50 }]).toArray(),
    col.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } }, total: { $sum: '$totalTokens' }, calls: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
  ]);

  res.render('superadmin/token-analytics', {
    user: req.superAdmin,
    days,
    totals: totals[0] || { calls: 0, input: 0, output: 0, total: 0, cacheRead: 0 },
    byEngine, byModel, byTenant, daily,
  });
});

// ── Plans management ────────────────────────────────────────────────────────

export default router;
