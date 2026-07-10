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

  res.render('superadmin/tickets', {
    superAdmin: req.superAdmin,
    tickets,
    stats,
    filters: { status: req.query.status || '' },
  });
});

router.get('/tickets/:tenantDb/:ticketId', async (req, res) => {
  try {
    const tenantDb = getTenantDb(req.params.tenantDb);
    const ticket = await tenantDb.collection('tickets').findOne({ _id: new ObjectId(req.params.ticketId) });
    if (!ticket) return res.redirect('/superadmin/tickets');

    res.render('superadmin/ticket-detail', {
      superAdmin: req.superAdmin,
      ticket,
      tenantDbName: req.params.tenantDb,
    });
  } catch {
    res.redirect('/superadmin/tickets');
  }
});

router.post('/tickets/:tenantDb/:ticketId/reply', async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.redirect(`/superadmin/tickets/${req.params.tenantDb}/${req.params.ticketId}`);

  const tenantDb = getTenantDb(req.params.tenantDb);
  const reply = {
    _id: new ObjectId(),
    author: {
      type: 'superadmin',
      email: req.superAdmin.email,
      displayName: (req.superAdmin.displayName || req.superAdmin.email) + ' (Platform)',
    },
    body: body.trim(),
    attachments: [],
    createdAt: new Date(),
  };

  await tenantDb.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.ticketId) },
    { $push: { replies: reply }, $set: { updatedAt: new Date() } },
  );
  res.redirect(`/superadmin/tickets/${req.params.tenantDb}/${req.params.ticketId}`);
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

  res.redirect('/superadmin/tickets');
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

  res.redirect('/superadmin/tickets');
});

// ═══════════════════════════════════════════════════════════════════════════
// SETUP REQUESTS — "Wire up my accounts" submissions from the settings banner
// Action list: new → working → done
// ═══════════════════════════════════════════════════════════════════════════
router.get('/setup-requests', async (req, res) => {
  const slab = getSlabDb();
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const requests = await slab.collection('setup_requests')
    .find(filter).sort({ createdAt: -1 }).limit(300).toArray();

  const [open, working, done] = await Promise.all([
    slab.collection('setup_requests').countDocuments({ status: 'new' }),
    slab.collection('setup_requests').countDocuments({ status: 'working' }),
    slab.collection('setup_requests').countDocuments({ status: 'done' }),
  ]);

  res.render('superadmin/setup-requests', {
    superAdmin: req.superAdmin,
    requests,
    stats: { open, working, done, total: open + working + done },
    filters: { status: req.query.status || '' },
  });
});

router.post('/setup-requests/:id/status', async (req, res) => {
  const status = ['new', 'working', 'done'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Invalid status' });
  try {
    const slab = getSlabDb();
    await slab.collection('setup_requests').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date(), updatedBy: req.superAdmin?.email || 'superadmin' } },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// OPSTRAIN — Brand management (centralized from opsTrain /superadmin)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/all-tickets', async (req, res) => {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find({}, { projection: { db: 1, domain: 1, 'brand.name': 1 } }).toArray();

  const statusFilter = req.query.status || '';
  const tenantFilter = req.query.tenant || '';
  const allTickets = [];

  for (const tenant of tenants) {
    if (tenantFilter && tenant.db !== tenantFilter) continue;
    try {
      const tDb = getTenantDb(tenant.db);
      const filter = {};
      if (statusFilter && statusFilter !== 'all') filter.status = statusFilter;
      const tickets = await tDb.collection('tickets').find(filter).sort({ createdAt: -1 }).limit(100).toArray();
      for (const t of tickets) {
        allTickets.push({
          ...t,
          _tenantDb: tenant.db,
          _tenantDomain: tenant.domain,
          _tenantName: tenant.brand?.name || tenant.domain,
        });
      }
    } catch { /* skip dead tenant DBs */ }
  }

  allTickets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const statusCounts = {
    open: allTickets.filter(t => t.status === 'open').length,
    'in-progress': allTickets.filter(t => t.status === 'in-progress').length,
    escalated: allTickets.filter(t => t.escalated || t.status === 'escalated').length,
    resolved: allTickets.filter(t => t.status === 'resolved').length,
    closed: allTickets.filter(t => t.status === 'closed').length,
    total: allTickets.length,
  };

  res.render('superadmin/all-tickets', {
    superAdmin: req.superAdmin,
    tickets: allTickets,
    statusCounts,
    tenants,
    filters: { status: statusFilter, tenant: tenantFilter },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCAN REPORTS — Site-scanner findings, separate from tickets
// Devs review and mark fixed here. Tenants see the resulting devStatus on
// their /admin/scanner page.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/scan-reports', async (req, res) => {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants')
    .find({}, { projection: { db: 1, domain: 1, 'brand.name': 1 } }).toArray();

  const statusFilter = req.query.status || '';
  const reports = [];

  for (const tenant of tenants) {
    try {
      const tDb = getTenantDb(tenant.db);
      const latest = await tDb.collection('scan_results')
        .find({}).sort({ 'summary.scannedAt': -1 }).limit(1).toArray();
      if (!latest.length) continue;
      const r = latest[0];
      const devStatus = r.devStatus || (r.summary?.counts?.critical || r.summary?.counts?.high ? 'pending-review' : 'clean');
      if (statusFilter && statusFilter !== 'all' && devStatus !== statusFilter) continue;
      reports.push({
        ...r,
        devStatus,
        _tenantDb: tenant.db,
        _tenantDomain: tenant.domain,
        _tenantName: tenant.brand?.name || tenant.domain,
      });
    } catch { /* skip dead tenants */ }
  }

  reports.sort((a, b) => (b.summary?.scannedAt || 0) - (a.summary?.scannedAt || 0));

  const stats = reports.reduce((acc, r) => {
    acc[r.devStatus] = (acc[r.devStatus] || 0) + 1;
    return acc;
  }, { 'pending-review': 0, 'in-progress': 0, fixed: 0, clean: 0 });
  stats.total = reports.length;

  res.render('superadmin/scan-reports', {
    superAdmin: req.superAdmin,
    reports,
    stats,
    filters: { status: statusFilter },
  });
});

router.get('/scan-reports/:tenantDb/:scanId', async (req, res) => {
  try {
    const tDb = getTenantDb(req.params.tenantDb);
    const report = await tDb.collection('scan_results').findOne({ _id: new ObjectId(req.params.scanId) });
    if (!report) return res.redirect('/superadmin/scan-reports');
    res.render('superadmin/scan-report-detail', {
      superAdmin: req.superAdmin,
      report,
      tenantDbName: req.params.tenantDb,
    });
  } catch {
    res.redirect('/superadmin/scan-reports');
  }
});

router.post('/scan-reports/:tenantDb/:scanId/status', async (req, res) => {
  const { devStatus, devNotes } = req.body;
  const valid = ['pending-review', 'in-progress', 'fixed', 'clean'];
  if (!valid.includes(devStatus)) return res.redirect(`/superadmin/scan-reports/${req.params.tenantDb}/${req.params.scanId}`);
  const tDb = getTenantDb(req.params.tenantDb);
  await tDb.collection('scan_results').updateOne(
    { _id: new ObjectId(req.params.scanId) },
    { $set: { devStatus, devNotes: (devNotes || '').trim(), devReviewedBy: req.superAdmin.email, devReviewedAt: new Date() } },
  );
  res.redirect(`/superadmin/scan-reports/${req.params.tenantDb}/${req.params.scanId}`);
});

// ── AI agentry for ticket detail (suggest reply / summarize / classify) ────
router.post('/tickets/:tenantDb/:ticketId/agent', async (req, res) => {
  try {
    const { callLLM } = await import('../plugins/agentMcp.js');
    const tenantDb = getTenantDb(req.params.tenantDb);
    const ticket = await tenantDb.collection('tickets').findOne({ _id: new ObjectId(req.params.ticketId) });
    if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket not found' });

    const action = req.body.action || 'reply';
    const replies = (ticket.replies || []).map(r => `${r.author?.displayName || r.author?.email || 'Unknown'} (${r.author?.type || 'tenant'}):\n${r.body}`).join('\n\n---\n\n');
    const threadText = `Subject: ${ticket.subject || '(no subject)'}\nFrom: ${ticket.submittedBy?.displayName || ticket.submittedBy?.email || 'tenant'}\nTenant: ${req.params.tenantDb} (${ticket.tenantBrandName || ''})\nPriority: ${ticket.priority || 'medium'} | Category: ${ticket.category || 'other'}\n\nBody:\n${ticket.description || ticket.body || '(empty)'}\n\nReplies so far:\n${replies || '(none)'}`;

    let systemPrompt;
    if (action === 'summarize') {
      systemPrompt = 'You are a senior platform engineer summarizing a customer support ticket for the dev team. Write a 2-3 sentence summary identifying the core issue, what has been tried, and what is still blocking. Return plain prose. No fluff.';
    } else if (action === 'classify') {
      systemPrompt = 'You triage support tickets for a multi-tenant SaaS. Return ONLY JSON: {"category": "bug|improvement|question|onboarding|billing|other", "priority": "low|medium|high|critical", "reasoning": "one short sentence"}. No fences, no prose.';
    } else {
      systemPrompt = 'You are platform support staff (signed as "Platform Support") drafting a reply to a tenant. Be concise (3-6 sentences), professional, warm. Acknowledge the issue, state next steps, give a realistic timeframe. If technical info is needed, ask one focused question. Do NOT invent platform features. Return plain prose only, no signature.';
    }

    const raw = await callLLM([{ role: 'user', content: threadText }], systemPrompt, 60000);
    res.json({ ok: true, action, output: raw.trim() });
  } catch (err) {
    console.error('[superadmin] ticket agent error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL USERS — Cross-tenant user management
// ═══════════════════════════════════════════════════════════════════════════

export default router;
