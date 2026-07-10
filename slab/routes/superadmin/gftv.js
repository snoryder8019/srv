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

router.get('/gftv/data', async (req, res) => {
  const tenants = gftvRead('tenants.json', []);
  const leads   = gftvRead('leads.json', []);
  const mrr     = tenants
    .filter(t => t.active && !t.isPromo)
    .reduce((a, t) => a + (PLAN_PRICES_GFTV[t.plan] || 0), 0);
  let totalSubs = 0;
  for (const t of tenants) {
    const d = gftvRead(`tenant-${t.slug}.json`, {});
    totalSubs += (d.subscribers || []).length;
  }
  res.json({ tenants, leads, mrr, totalSubs, planPrices: PLAN_PRICES_GFTV });
});

// Create tenant
router.post('/gftv/tenants', async (req, res) => {
  const tenants = gftvRead('tenants.json', []);
  const slug = (req.body.slug || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  if (!slug || !req.body.name) return res.status(400).json({ error: 'Name and slug required' });
  if (tenants.find(t => t.slug === slug)) return res.status(400).json({ error: 'Slug already exists' });
  const t = {
    id: slug, slug,
    name:         req.body.name,
    email:        req.body.email || '',
    plan:         req.body.plan || 'starter',
    active:       true,
    isPromo:      req.body.isPromo === 'true',
    createdAt:    new Date().toISOString(),
    passwordHash: req.body.password || 'changeme',
    branding: {
      name:     req.body.name,
      color:    req.body.color || '#ff5000',
      location: req.body.location || '',
    },
  };
  tenants.push(t);
  gftvWrite('tenants.json', tenants);
  gftvWrite(`tenant-${slug}.json`, { menu:[], specials:[], events:[], offerings:[], subscribers:[], analytics:{ themes:{} } });
  await logActivity({ category:'admin_action', action:`Created GFTV tenant: ${t.name} (${t.plan})`, actor:{ email: req.superAdmin.email, role:'superadmin' } });
  res.json({ ok: true, tenant: t });
});

// Update tenant
router.put('/gftv/tenants/:slug', async (req, res) => {
  let tenants = gftvRead('tenants.json', []);
  tenants = tenants.map(t => t.slug === req.params.slug ? { ...t, ...req.body } : t);
  gftvWrite('tenants.json', tenants);
  await logActivity({ category:'admin_action', action:`Updated GFTV tenant: ${req.params.slug}`, actor:{ email: req.superAdmin.email, role:'superadmin' } });
  res.json({ ok: true });
});

// Delete tenant
router.delete('/gftv/tenants/:slug', async (req, res) => {
  let tenants = gftvRead('tenants.json', []);
  tenants = tenants.filter(t => t.slug !== req.params.slug);
  gftvWrite('tenants.json', tenants);
  await logActivity({ category:'admin_action', action:`Deleted GFTV tenant: ${req.params.slug}`, actor:{ email: req.superAdmin.email, role:'superadmin' } });
  res.json({ ok: true });
});

// Toggle promo
router.post('/gftv/tenants/:slug/toggle-promo', async (req, res) => {
  let tenants = gftvRead('tenants.json', []);
  const t = tenants.find(x => x.slug === req.params.slug);
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.isPromo = !t.isPromo;
  gftvWrite('tenants.json', tenants);
  await logActivity({ category:'admin_action', action:`${t.isPromo ? 'Marked' : 'Unmarked'} GFTV tenant ${t.slug} as promo`, actor:{ email: req.superAdmin.email, role:'superadmin' } });
  if (req.headers.accept?.includes('application/json')) return res.json({ ok:true, isPromo:t.isPromo });
  res.redirect('/superadmin#tab-gftv');
});

// Update lead status
router.put('/gftv/leads/:id/status', async (req, res) => {
  let leads = gftvRead('leads.json', []);
  leads = leads.map(l => String(l.id) === String(req.params.id) ? { ...l, status: req.body.status } : l);
  gftvWrite('leads.json', leads);
  res.json({ ok: true });
});

// Tenant detail page
router.get('/gftv/tenants/:slug', async (req, res) => {
  const tenants = gftvRead('tenants.json', []);
  const tenant  = tenants.find(t => t.slug === req.params.slug);
  if (!tenant) return res.redirect('/superadmin#tab-gftv');
  const data = gftvRead(`tenant-${tenant.slug}.json`, {});
  res.render('superadmin/gftv-tenant-detail', {
    user: req.superAdmin,
    tenant,
    data,
    planPrices: PLAN_PRICES_GFTV,
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// SECURITY DASHBOARD — fail2ban events, jail status, system stats
// ═══════════════════════════════════════════════════════════════════════════

export default router;
