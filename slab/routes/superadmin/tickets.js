import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../../middleware/superadmin.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import { createLoginToken } from '../../middleware/jwtAuth.js';
import { config } from '../../config/config.js';
import { decrypt } from '../../plugins/crypto.js';
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

// Primary tickets queue — aggregates EVERY tenant's user-created tickets (not
// just the ones escalated to the platform). Escalated ones are pinned via the
// status filter; the default view is "active" (anything not resolved/closed) so
// a freshly-created tenant ticket shows up here the moment it's filed.
router.get('/tickets', async (req, res) => {
  const slab = getSlabDb();
  const statusFilter = req.query.status || ''; // '' → active default
  const tenants = await slab.collection('tenants')
    .find({}, { projection: { db: 1, domain: 1, 'brand.name': 1 } }).toArray();

  const all = [];
  for (const tenant of tenants) {
    if (!tenant.db) continue;
    try {
      const tDb = getTenantDb(tenant.db); // host auto-resolves (atlas/gpu)
      const rows = await tDb.collection('tickets').find({}).sort({ createdAt: -1 }).limit(200).toArray();
      for (const t of rows) {
        all.push({
          ...t,
          tenantDbName: tenant.db,
          ticketId: t._id,
          tenantBrandName: t.tenantBrandName || tenant.brand?.name || tenant.domain,
          authorEmail: t.submittedBy?.email || t.author?.email || null,
        });
      }
    } catch { /* skip a tenant DB that's unreachable (e.g. gpu tunnel down) */ }
  }
  all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const isActive = (t) => t.status !== 'resolved' && t.status !== 'closed';
  let tickets;
  if (!statusFilter || statusFilter === 'active') tickets = all.filter(isActive);
  else if (statusFilter === 'all') tickets = all;
  else if (statusFilter === 'escalated') tickets = all.filter((t) => t.escalated || t.status === 'escalated');
  else tickets = all.filter((t) => t.status === statusFilter);

  const stats = {
    active: all.filter(isActive).length,
    resolved: all.filter((t) => t.status === 'resolved').length,
    closed: all.filter((t) => t.status === 'closed').length,
    total: all.length,
  };

  res.render('superadmin/tickets', {
    superAdmin: req.superAdmin,
    tickets,
    stats,
    filters: { status: statusFilter },
  });
});

router.get('/tickets/:tenantDb/:ticketId', async (req, res) => {
  try {
    const tenantDb = getTenantDb(req.params.tenantDb);
    const ticket = await tenantDb.collection('tickets').findOne({ _id: new ObjectId(req.params.ticketId) });
    if (!ticket) return res.redirect('/superadmin/tickets');

    // Any existing fix handoff for this ticket (diagnosis parked in the DB queue).
    const handoff = await getSlabDb().collection('fix_handoffs').findOne({
      ticketId: req.params.ticketId, tenantDbName: req.params.tenantDb,
    });

    res.render('superadmin/ticket-detail', {
      superAdmin: req.superAdmin,
      ticket,
      handoff: handoff || null,
      tenantDbName: req.params.tenantDb,
    });
  } catch {
    res.redirect('/superadmin/tickets');
  }
});

router.post('/tickets/:tenantDb/:ticketId/reply', async (req, res) => {
  const { body, notify } = req.body;
  const backTo = `/superadmin/tickets/${req.params.tenantDb}/${req.params.ticketId}`;
  if (!body?.trim()) return res.redirect(backTo);

  const tenantDb = getTenantDb(req.params.tenantDb);
  const ticketOid = new ObjectId(req.params.ticketId);
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
    { _id: ticketOid },
    { $push: { replies: reply }, $set: { updatedAt: new Date() } },
  );

  // Delivery-on-send: a platform reply should actually reach the tenant, not
  // just sit in the thread. Opt-out per reply via the "Email the tenant"
  // checkbox (unchecked → internal note only). Guarded by author email + creds.
  if (notify === 'on') {
    try {
      const ticket = await tenantDb.collection('tickets')
        .findOne({ _id: ticketOid }, { projection: { subject: 1, submittedBy: 1, ticketNumber: 1 } });
      const to = ticket?.submittedBy?.email;
      const zohoUser = process.env.ZOHO_USER, zohoPass = process.env.ZOHO_PASS;
      if (to && zohoUser && zohoPass) {
        const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        const transporter = nodemailer.createTransport({
          host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
          auth: { user: zohoUser, pass: zohoPass },
        });
        await transporter.sendMail({
          from: `"sLab Support" <${zohoUser}>`,
          to,
          subject: `Re: ${ticket.subject || 'your support ticket'}${ticket.ticketNumber ? ' (#' + ticket.ticketNumber + ')' : ''}`,
          html: `<p>Hi ${esc(ticket.submittedBy?.displayName || 'there')},</p>\n<p>${esc(reply.body).replace(/\n/g, '<br>')}</p>\n<p style="color:#666;font-size:13px;">Reply to this email or open your admin panel to continue the conversation.</p>\n<p>— sLab Support</p>`,
        });
        console.log(`[superadmin] ticket reply emailed to ${to}`);
      } else if (!to) {
        console.warn(`[superadmin] ticket ${req.params.ticketId}: no author email — reply stored but not delivered`);
      }
    } catch (e) {
      console.error('[superadmin] ticket reply email failed:', e.message);
    }
  }

  res.redirect(backTo);
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

// Load a tenant with DECRYPTED custom keys (same shape the request middleware
// puts on req.tenant), so the ticket agent can run on that tenant's BYO
// Anthropic key when present.
async function loadEngineTenant(tenantDbName) {
  try {
    const doc = await getSlabDb().collection('tenants')
      .findOne({ db: tenantDbName }, { projection: { domain: 1, customKeys: 1 } });
    if (!doc) return null;
    return {
      domain: doc.domain,
      customKeys: (doc.customKeys || []).map((k) => {
        let value = '';
        try { value = k.value ? decrypt(k.value) : ''; } catch { value = null; }
        return { name: k.name, value };
      }),
    };
  } catch { return null; }
}

// Platform engine for superadmin-side ticket agentry. These are OUR operations
// (diagnosis, drafting platform replies), so they run on the madladslab tenant's
// vaulted Anthropic key — rotatable at /admin/settings/keys on madladslab, no
// plaintext key in the systemd unit. Falls back to the ticket tenant's own key,
// then the env platform key (config.ANTHROPIC_API_KEY), then house.
async function loadPlatformEngineTenant(fallbackTenantDb) {
  const { tenantAnthropicKey } = await import('../../plugins/agentEngine.js');
  const platform = await loadEngineTenant('slab_madladslab');
  if (tenantAnthropicKey(platform)) return platform;
  const own = fallbackTenantDb ? await loadEngineTenant(fallbackTenantDb) : null;
  return (own && tenantAnthropicKey(own)) ? own : (platform || own);
}

// ── AI agentry for ticket detail (suggest reply / revise / summarize / classify) ──
router.post('/tickets/:tenantDb/:ticketId/agent', async (req, res) => {
  try {
    const { callLLM } = await import('../../plugins/agentMcp.js');
    const tenantDb = getTenantDb(req.params.tenantDb);
    const ticket = await tenantDb.collection('tickets').findOne({ _id: new ObjectId(req.params.ticketId) });
    if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket not found' });

    const action = req.body.action || 'reply';
    const replies = (ticket.replies || []).map(r => `${r.author?.displayName || r.author?.email || 'Unknown'} (${r.author?.type || 'tenant'}):\n${r.body}`).join('\n\n---\n\n');
    const threadText = `Subject: ${ticket.subject || '(no subject)'}\nFrom: ${ticket.submittedBy?.displayName || ticket.submittedBy?.email || 'tenant'}\nTenant: ${req.params.tenantDb} (${ticket.tenantBrandName || ''})\nPriority: ${ticket.priority || 'medium'} | Category: ${ticket.category || 'other'}\n\nBody:\n${ticket.description || ticket.body || '(empty)'}\n\nReplies so far:\n${replies || '(none)'}`;

    // System snapshot — the debug capture the bug button stored on the ticket.
    // Fed to the model for diagnosis; trimmed so a huge log tail can't blow the
    // context window (keep the tail — that's where the fresh error lives).
    const tail = (s, n) => { const str = String(s || ''); return str.length > n ? '…' + str.slice(-n) : str; };
    const d = ticket.debugData || {};
    const snapshotText = !ticket.debugData ? '(no system snapshot captured)' : [
      `Captured: ${d.capturedAt || '—'}`,
      `URL: ${d.currentUrl || '—'}`,
      `User-Agent: ${d.userAgent || '—'}`,
      `Screen: ${d.screenSize || '—'}`,
      Array.isArray(d.consoleErrors) && d.consoleErrors.length
        ? `\nConsole errors (${d.consoleErrors.length}):\n${d.consoleErrors.map(e => '• ' + (typeof e === 'string' ? e : JSON.stringify(e))).join('\n')}` : '',
      d.apacheErrorLog && d.apacheErrorLog !== '[not available]' ? `\nApache error log (tail):\n${tail(d.apacheErrorLog, 4000)}` : '',
      d.tmuxLog && d.tmuxLog !== '[not available]' ? `\nServer log / tmux (tail):\n${tail(d.tmuxLog, 4000)}` : '',
    ].filter(Boolean).join('\n');

    let systemPrompt, userContent = threadText;
    if (action === 'diagnose') {
      systemPrompt = 'You are a senior engineer on the Slab platform diagnosing a bug ticket. You are given the ticket thread AND a system snapshot (the page URL, browser, console errors, and server/apache log tails captured at report time). Produce a technical diagnosis for the dev queue.\n\nSLAB REPO LAYOUT (respect it — there is NO controllers/ dir, NO src/, and views are EJS not React): Express routes live in routes/ (admin surfaces in routes/admin/**, superadmin in routes/superadmin/**, tenant/public APIs at repo-root routes/*.js). Business logic and integrations live in plugins/ (e.g. plugins/mongo.js, plugins/s3.js, plugins/agentEngine.js, plugins/socialPublish.js). Server-rendered views are EJS under views/** (e.g. views/admin/design/*.ejs). Middleware in middleware/, config in config/, browser JS in public/js/. Multi-tenant: getTenantDb(dbName) selects a tenant DB (atlas or gpu-hosted); the platform registry DB is getSlabDb(). When you name filesToCheck, use paths that fit THIS layout (e.g. "routes/admin/design.js", "plugins/socialPublish.js") — never invent controllers/ or MVC paths. If you are guessing, say so.\n\nReturn ONLY JSON, no fences, no prose outside it: {"rootCause": "your best hypothesis of the underlying cause", "area": "the subsystem/route/feature likely at fault", "filesToCheck": ["repo-relative paths that fit the layout above; mark guesses"], "reproSteps": "shortest path to reproduce", "suggestedFix": "concrete fix direction a dev or on-box coding model can act on", "confidence": "low|medium|high"}. Ground every claim in the snapshot/thread; if the snapshot lacks the evidence, say so in rootCause and set confidence low.';
      userContent = `TICKET THREAD:\n${threadText}\n\n=== SYSTEM SNAPSHOT ===\n${snapshotText}`;
    } else if (action === 'summarize') {
      systemPrompt = 'You are a senior platform engineer summarizing a customer support ticket for the dev team. Write a 2-3 sentence summary identifying the core issue, what has been tried, and what is still blocking. Return plain prose. No fluff.';
    } else if (action === 'classify') {
      systemPrompt = 'You triage support tickets for a multi-tenant SaaS. Return ONLY JSON: {"category": "bug|improvement|question|onboarding|billing|other", "priority": "low|medium|high|critical", "reasoning": "one short sentence"}. No fences, no prose.';
    } else if (action === 'revise') {
      // Revise loop: take the current draft + an instruction, return a new draft.
      systemPrompt = 'You are platform support staff refining a draft reply to a tenant. Apply the requested revision while keeping it concise (3-6 sentences), professional, and warm. Do NOT invent platform features. Return ONLY the revised reply text — no preamble, no signature.';
      userContent = `TICKET CONTEXT:\n${threadText}\n\nCURRENT DRAFT:\n${(req.body.draft || '').trim() || '(none)'}\n\nREVISION REQUESTED:\n${(req.body.instruction || '').trim() || 'Improve clarity and tone.'}`;
    } else {
      systemPrompt = 'You are platform support staff (signed as "Platform Support") drafting a reply to a tenant. Be concise (3-6 sentences), professional, warm. Acknowledge the issue, state next steps, give a realistic timeframe. If technical info is needed, ask one focused question. Do NOT invent platform features. Return plain prose only, no signature.';
    }

    const engineTenant = await loadPlatformEngineTenant(req.params.tenantDb);

    if (action === 'diagnose') {
      // Dev-facing diagnosis must be a real Anthropic answer or an honest
      // failure — never a silent downgrade to the flaky house model (which
      // hallucinates repo paths and 500s mid-GPU-reset).
      const { resolveEngine, callAnthropic } = await import('../../plugins/agentEngine.js');
      const chosen = resolveEngine({ tenant: engineTenant, engine: 'anthropic' });
      if (chosen.engine !== 'anthropic') {
        return res.status(503).json({ ok: false, error: 'AI diagnosis needs an Anthropic key. Add the madladslab platform key at /admin/settings/keys (name: anthropic_api_key).' });
      }
      try {
        const raw = await callAnthropic([{ role: 'user', content: userContent }], systemPrompt, { apiKey: chosen.apiKey, model: chosen.model, timeoutMs: 60000 });
        return res.json({ ok: true, action, engine: 'anthropic', output: raw.trim() });
      } catch (e) {
        return res.status(502).json({ ok: false, error: `Anthropic diagnosis failed (no house fallback): ${e.message || e}` });
      }
    }

    const raw = await callLLM([{ role: 'user', content: userContent }], systemPrompt, 60000, { tenant: engineTenant });
    res.json({ ok: true, action, output: raw.trim() });
  } catch (err) {
    console.error('[superadmin] ticket agent error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FIX HANDOFFS — dev queue for AI-diagnosed bugs
// A superadmin diagnosis (or hand-written note) is parked in slab.fix_handoffs
// so a human dev — or a future on-box coding model — can pull the queue and
// apply the fix. One handoff per ticket (upsert); the ticket also carries a
// pointer so it shows on the detail view.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/tickets/:tenantDb/:ticketId/handoff', async (req, res) => {
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  const backTo = `/superadmin/tickets/${req.params.tenantDb}/${req.params.ticketId}`;
  try {
    const slab = getSlabDb();
    const tenantDb = getTenantDb(req.params.tenantDb);
    const ticket = await tenantDb.collection('tickets')
      .findOne({ _id: new ObjectId(req.params.ticketId) }, { projection: { subject: 1, ticketNumber: 1, priority: 1, category: 1 } });
    if (!ticket) {
      if (wantsJson) return res.status(404).json({ ok: false, error: 'Ticket not found' });
      return res.redirect('/superadmin/tickets');
    }

    const now = new Date();
    const $set = {
      ticketId: req.params.ticketId,
      tenantDbName: req.params.tenantDb,
      ticketNumber: ticket.ticketNumber || null,
      subject: ticket.subject || '(no subject)',
      priority: ticket.priority || 'medium',
      category: ticket.category || 'bug',
      updatedAt: now,
      updatedBy: req.superAdmin?.email || 'superadmin',
    };

    // Only touch diagnosis/notes when this request actually carries them — a
    // status-only re-post (Queued/In progress/Done) must not wipe a saved
    // diagnosis. Diagnosis may be a JSON string (from the agent) or plain notes.
    if (req.body.diagnosis) {
      try { $set.diagnosis = typeof req.body.diagnosis === 'string' ? JSON.parse(req.body.diagnosis) : req.body.diagnosis; }
      catch { $set.notes = String(req.body.diagnosis).trim(); }
    }
    if (typeof req.body.notes === 'string' && req.body.notes.trim()) $set.notes = req.body.notes.trim();
    if (req.body.status && ['queued', 'in-progress', 'done'].includes(req.body.status)) $set.status = req.body.status;

    // Status lives in $set only when supplied; otherwise seed 'queued' on insert
    // (never both — Mongo rejects the same path in $set and $setOnInsert).
    const $setOnInsert = { createdAt: now, createdBy: req.superAdmin?.email || 'superadmin' };
    if (!$set.status) $setOnInsert.status = 'queued';

    await slab.collection('fix_handoffs').updateOne(
      { ticketId: req.params.ticketId, tenantDbName: req.params.tenantDb },
      { $set, $setOnInsert },
      { upsert: true },
    );

    // Pointer on the ticket so list/detail views reflect the queued fix.
    await tenantDb.collection('tickets').updateOne(
      { _id: new ObjectId(req.params.ticketId) },
      { $set: { 'fixHandoff.status': $set.status || 'queued', 'fixHandoff.updatedAt': now, updatedAt: now } },
    );

    if (wantsJson) return res.json({ ok: true });
    res.redirect(backTo);
  } catch (err) {
    console.error('[superadmin] fix handoff save error:', err);
    if (wantsJson) return res.status(500).json({ ok: false, error: err.message });
    res.redirect(backTo);
  }
});

router.get('/fix-handoffs', async (req, res) => {
  const slab = getSlabDb();
  const statusFilter = req.query.status || '';
  const filter = {};
  if (statusFilter && statusFilter !== 'all') filter.status = statusFilter;

  const handoffs = await slab.collection('fix_handoffs')
    .find(filter).sort({ updatedAt: -1 }).limit(300).toArray();

  const [queued, inProgress, done] = await Promise.all([
    slab.collection('fix_handoffs').countDocuments({ status: 'queued' }),
    slab.collection('fix_handoffs').countDocuments({ status: 'in-progress' }),
    slab.collection('fix_handoffs').countDocuments({ status: 'done' }),
  ]);

  res.render('superadmin/fix-handoffs', {
    superAdmin: req.superAdmin,
    handoffs,
    stats: { queued, inProgress, done, total: queued + inProgress + done },
    filters: { status: statusFilter },
  });
});

router.post('/fix-handoffs/:id/status', async (req, res) => {
  const status = ['queued', 'in-progress', 'done'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ ok: false, error: 'Invalid status' });
  try {
    const slab = getSlabDb();
    const h = await slab.collection('fix_handoffs').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date(), updatedBy: req.superAdmin?.email || 'superadmin' } },
      { returnDocument: 'after' },
    );
    // Keep the ticket pointer in sync.
    const doc = h?.value || h;
    if (doc?.ticketId && doc?.tenantDbName) {
      try {
        const tDb = getTenantDb(doc.tenantDbName);
        await tDb.collection('tickets').updateOne(
          { _id: new ObjectId(doc.ticketId) },
          { $set: { 'fixHandoff.status': status, 'fixHandoff.updatedAt': new Date() } },
        );
      } catch { /* tenant DB unreachable — queue status still updated */ }
    }
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL USERS — Cross-tenant user management
// ═══════════════════════════════════════════════════════════════════════════

export default router;
