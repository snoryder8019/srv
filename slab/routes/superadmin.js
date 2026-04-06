/**
 * Slab — Superadmin Panel
 * /superadmin                → dashboard (all tenants, revenue, signups)
 * /superadmin/login          → Google OAuth login
 * /superadmin/tenants        → tenant list + management
 * /superadmin/tenants/:id    → tenant detail + actions
 * /superadmin/promos         → promo offer management
 * /superadmin/promos/send    → send promo email
 * /superadmin/signups        → marketing signup data
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../middleware/superadmin.js';
import { bustTenantCache } from '../middleware/tenant.js';
import { config } from '../config/config.js';
import nodemailer from 'nodemailer';
import { logActivity, getActivityLogs } from '../plugins/activityLog.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getServices, getServicesByCategory, getService } from '../plugins/serviceRegistry.js';

const router = express.Router();

// ── Tenant tag definitions ─────────────────────────────────────────────────
const TENANT_TAGS = {
  vip:              { label: 'VIP',              color: '#c9a848', bg: '#2a2410' },
  'hot-lead':       { label: 'Hot Lead',         color: '#f97316', bg: '#431407' },
  'needs-onboarding': { label: 'Needs Onboarding', color: '#38bdf8', bg: '#0c2d48' },
  'needs-design':   { label: 'Needs Design',     color: '#a78bfa', bg: '#1e1540' },
  'needs-content':  { label: 'Needs Content',    color: '#34d399', bg: '#052e1c' },
  'at-risk':        { label: 'At Risk',          color: '#f87171', bg: '#451a1a' },
  enterprise:       { label: 'Enterprise',       color: '#e2e8f0', bg: '#1e293b' },
  'power-user':     { label: 'Power User',       color: '#facc15', bg: '#362f05' },
};

// ── Subscription-change courtesy email ──────────────────────────────────────
const PLAN_LABELS = {
  free: 'Free',
  monthly: 'Monthly',
  '30day': '30-Day',
  '120day': '120-Day',
  annual: 'Annual',
  lifetime: 'Lifetime',
};

async function sendSubscriptionEmail(tenant, action, plan) {
  const to = tenant.meta?.ownerEmail;
  if (!to) return;
  const zohoUser = process.env.ZOHO_USER;
  const zohoPass = process.env.ZOHO_PASS;
  if (!zohoUser || !zohoPass) return;

  const brandName = tenant.brand?.name || tenant.domain || 'your site';
  const planLabel = PLAN_LABELS[plan] || plan;

  let subject, body;
  if (action === 'activated') {
    subject = `Your sLab subscription is now active — ${planLabel} plan`;
    body = `<p>Hi there,</p>
<p>Great news! Your site <strong>${brandName}</strong> has been activated on the <strong>${planLabel}</strong> plan.</p>
<p>You now have full access to all features included in your plan. Log in to your admin panel to get started.</p>
<p>If you have any questions, just reply to this email.</p>
<p>— The sLab Team</p>`;
  } else if (action === 'plan-changed') {
    subject = `Your sLab plan has been updated to ${planLabel}`;
    body = `<p>Hi there,</p>
<p>This is a courtesy notice that the subscription plan for <strong>${brandName}</strong> has been changed to <strong>${planLabel}</strong>.</p>
${plan === 'free' ? '<p>Your site has been moved to preview mode. Upgrade anytime from your admin panel.</p>' : '<p>Your new plan is effective immediately.</p>'}
<p>If you have questions or believe this was a mistake, just reply to this email.</p>
<p>— The sLab Team</p>`;
  } else if (action === 'suspended') {
    subject = 'Your sLab subscription has been suspended';
    body = `<p>Hi there,</p>
<p>This is to let you know that your site <strong>${brandName}</strong> has been suspended.</p>
<p>If you believe this is an error or would like to reactivate your account, please reply to this email and we'll get it sorted out.</p>
<p>— The sLab Team</p>`;
  } else {
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
      auth: { user: zohoUser, pass: zohoPass },
    });
    await transporter.sendMail({
      from: `"sLab Platform" <${zohoUser}>`,
      to,
      subject,
      html: body,
    });
    console.log(`[superadmin] Subscription email sent to ${to} (${action})`);
  } catch (err) {
    console.error(`[superadmin] Subscription email failed for ${to}:`, err.message);
  }
}

// ── Login ───────────────────────────────────────────────────────────────────
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

// ── All routes below require superadmin ─────────────────────────────────────
router.use(requireSuperAdmin);

// ── Dashboard (unified panel — services, tenants, tools, agents, activity) ──
router.get('/', async (req, res) => {
  const slab = getSlabDb();
  const [tenants, recentSignups, activityLogs] = await Promise.all([
    slab.collection('tenants').find().sort({ createdAt: -1 }).toArray(),
    slab.collection('signups').find().sort({ createdAt: -1 }).limit(10).toArray(),
    getActivityLogs({ limit: 30 }),
  ]);

  const active = tenants.filter(t => t.status === 'active').length;
  const preview = tenants.filter(t => t.status === 'preview' || !t.status).length;
  const suspended = tenants.filter(t => t.status === 'suspended').length;

  const services = getServices();
  const servicesByCategory = getServicesByCategory();
  const aliveCount = services.filter(s => s.alive === true).length;
  const deadCount = services.filter(s => s.alive === false).length;

  res.render('superadmin/dashboard', {
    user: req.superAdmin,
    services,
    servicesByCategory,
    totalServices: services.length,
    aliveCount,
    deadCount,
    tenants,
    stats: { total: tenants.length, active, preview, suspended, mrr: active * 50 },
    recentSignups,
    tagDefs: TENANT_TAGS,
    activityLogs,
    selectedService: req.query.service || 'all',
  });
});

// ── Tenant detail ───────────────────────────────────────────────────────────
router.get('/tenants/:id', async (req, res) => {
  const slab = getSlabDb();
  let tenant;
  try {
    tenant = await slab.collection('tenants').findOne({ _id: new ObjectId(req.params.id) });
  } catch { return res.redirect('/superadmin'); }
  if (!tenant) return res.redirect('/superadmin');

  // Get tenant DB stats + activity logs in parallel
  const tenantDb = getTenantDb(tenant.db);
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

// ── Huginn Chat (superadmin) — context-enriched ────────────────────────────
import {
  buildHuginnContext, logConversation, parseAndSaveIntents,
  listTasks as huginnListTasks,
} from '../plugins/huginnMcp.js';

const HUGINN_BASE = (config.OLLAMA_URL || '').replace(/\/v1\/chat\/completions$/, '');

async function huginnGet(path, timeoutMs = 8000) {
  const r = await fetch(`${HUGINN_BASE}/huginn${path}`, {
    headers: { 'Authorization': `Bearer ${config.OLLAMA_KEY}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`Huginn ${r.status}`);
  return r.json();
}

router.get('/huginn', (req, res) => {
  res.render('superadmin/huginn', { user: req.superAdmin });
});

router.post('/huginn/chat', async (req, res) => {
  try {
    const { messages, session } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const sessionId = session || `sa-${req.superAdmin?.email || 'default'}`;
    const userMsg = messages[messages.length - 1]?.content || '';

    // Log user message
    logConversation(sessionId, 'user', userMsg).catch(() => {});

    // Build live context from Slab DB and inject as system message
    let contextBlock = '';
    try { contextBlock = await buildHuginnContext(userMsg); } catch (e) {
      console.warn('[huginn] context build failed:', e.message);
    }

    const enrichedMessages = [
      ...(contextBlock ? [{ role: 'system', content: contextBlock }] : []),
      ...messages,
    ];

    const upstream = await fetch(`${HUGINN_BASE}/huginn/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.OLLAMA_KEY}`,
        'X-Huginn-Session': sessionId,
      },
      body: JSON.stringify({ messages: enrichedMessages }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({ error: `Huginn ${upstream.status}`, detail: text });
    }
    const ct = upstream.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
      // Stream through, collect full response for intent parsing
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
          // Collect for intent parsing
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload);
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) fullResponse += delta;
            } catch {}
          }
        }
      } catch { /* client disconnect */ }
      res.end();

      // Post-stream: log + parse intents (fire-and-forget)
      if (fullResponse) {
        logConversation(sessionId, 'assistant', fullResponse).catch(() => {});
        parseAndSaveIntents(fullResponse, sessionId).catch(() => {});
      }
    } else {
      const data = await upstream.json();
      res.json(data);

      // Log + parse intents from JSON response
      const reply = data.choices?.[0]?.message?.content || '';
      if (reply) {
        logConversation(sessionId, 'assistant', reply).catch(() => {});
        parseAndSaveIntents(reply, sessionId).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[huginn] proxy error:', err.message);
    res.status(502).json({ error: 'Huginn unreachable', detail: err.message });
  }
});

router.get('/huginn/health', async (req, res) => {
  try {
    const data = await huginnGet('/status');
    res.json({ ok: data.model === 'deepseek-r1:7b', busy: !!data.busy, busyTask: data.busyTask || null });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/huginn/tasks', async (req, res) => {
  try {
    const tasks = await huginnListTasks({
      status: req.query.status || undefined,
      limit: parseInt(req.query.limit) || 50,
    });
    res.json({ ok: true, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/huginn/sessions', async (req, res) => {
  try { res.json(await huginnGet('/sessions')); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

router.get('/huginn/sessions/:id', async (req, res) => {
  try { res.json(await huginnGet(`/sessions/${encodeURIComponent(req.params.id)}`)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// ── Control Center ─────────────────────────────────────────────────────────
router.get('/control-center', (req, res) => {
  res.render('superadmin/control-center', { user: req.superAdmin });
});

// ── Plans management ────────────────────────────────────────────────────────
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
function safeExec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 10000 }); }
  catch (e) { return e.stdout || e.message || 'Command failed'; }
}

router.get('/api/tool/:tool', async (req, res) => {
  const { tool } = req.params;
  try {
    let output = '';
    switch (tool) {
      case 'health': {
        const sessions = safeExec('tmux list-sessions 2>/dev/null');
        const ports = safeExec('ss -tlnp 2>/dev/null | grep LISTEN | head -40');
        output = '=== TMUX SESSIONS ===\n' + sessions + '\n=== LISTENING PORTS ===\n' + ports;
        break;
      }
      case 'apache':
        output = safeExec('apache2ctl -S 2>&1 | head -60');
        break;
      case 'ssl':
        output = safeExec('certbot certificates 2>&1 | head -40');
        break;
      case 'mongo': {
        const slab = getSlabDb();
        const collections = await slab.listCollections().toArray();
        output = 'Slab DB collections:\n' + collections.map(c => '  - ' + c.name).join('\n');
        break;
      }
      case 'disk':
        output = safeExec('df -h / && echo "" && du -sh /srv/*/ 2>/dev/null | sort -rh | head -20');
        break;
      case 'ollama': {
        const url = (config.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions').replace('/v1/chat/completions', '/health');
        output = safeExec(`curl -s --max-time 5 ${url} 2>&1`);
        break;
      }
      default:
        output = 'Unknown tool: ' + tool;
    }
    res.json({ ok: true, tool, output });
  } catch (err) {
    res.json({ ok: false, tool, output: 'Error: ' + err.message });
  }
});

router.get('/api/service/:name/:action', (req, res) => {
  const svc = getService(req.params.name);
  if (!svc) return res.json({ ok: false, output: 'Unknown service' });
  try {
    const parts = [`Service: ${svc.name}`, `Dir: ${svc.dir}`, `Port: ${svc.port || 'n/a'}`,
      `Domain: ${svc.domain || 'n/a'}`, `tmux: ${svc.tmux || 'n/a'}`,
      `Alive: ${svc.alive ? 'YES' : 'NO'}`, `Port open: ${svc.portOpen === null ? 'n/a' : svc.portOpen ? 'YES' : 'NO'}`];
    if (svc.tmux && svc.alive) {
      const log = safeExec(`tmux capture-pane -t ${svc.tmux} -p 2>/dev/null | tail -15`);
      if (log.trim()) parts.push('\n=== RECENT OUTPUT ===\n' + log);
    }
    res.json({ ok: true, service: svc.name, output: parts.join('\n') });
  } catch (err) {
    res.json({ ok: false, output: 'Error: ' + err.message });
  }
});

router.get('/service/:name', (req, res) => {
  const svc = getService(req.params.name);
  if (!svc) return res.status(404).send('Service not found');
  res.redirect('/superadmin?service=' + req.params.name);
});

// ── Deprecation Pipeline API ──────────────────────────────────────────────
const DEPR_ROOT = '/srv/depricated';
const DEPR_STAGES = ['new', 'cleansed', 'deconstructed', 'deletion-stage'];

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function getDeprecationPipeline() {
  const pipeline = {};
  for (const stage of DEPR_STAGES) {
    const dir = path.join(DEPR_ROOT, stage);
    if (!fs.existsSync(dir)) { pipeline[stage] = []; continue; }
    const entries = fs.readdirSync(dir).filter(f => {
      const full = path.join(dir, f);
      return fs.statSync(full).isDirectory() && !f.startsWith('.');
    });
    pipeline[stage] = entries.map(name => {
      const base = path.join(dir, name);
      const receipt = readJsonFile(path.join(base, '_deprecation_receipt.json'));
      const manifest = readJsonFile(path.join(base, '_config_manifest.json'));
      const review = readJsonFile(path.join(base, '_deletion_review.json'));
      const report = fs.existsSync(path.join(base, '_deconstruction_report.md'));
      let size = '?';
      try { size = execSync(`du -sh "${base}" 2>/dev/null | cut -f1`, { encoding: 'utf8' }).trim(); } catch {}
      return { name, stage, receipt, manifest, review, hasReport: report, size };
    });
  }
  return pipeline;
}

// List all projects available for deprecation (dirs in /srv with package.json, not already deprecated)
function getDeprecatableSrvProjects() {
  const existing = new Set();
  for (const stage of DEPR_STAGES) {
    const dir = path.join(DEPR_ROOT, stage);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(f => existing.add(f));
    }
  }
  const skip = new Set(['depricated', 'node_modules', 'lost+found']);
  try {
    return fs.readdirSync('/srv').filter(f => {
      if (skip.has(f) || existing.has(f)) return false;
      const full = path.join('/srv', f);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'package.json'));
    });
  } catch { return []; }
}

router.get('/api/deprecation/pipeline', (req, res) => {
  const pipeline = getDeprecationPipeline();
  const available = getDeprecatableSrvProjects();
  res.json({ ok: true, pipeline, available });
});

router.get('/api/deprecation/report/:project', (req, res) => {
  const { project } = req.params;
  // Search all stages for the report
  for (const stage of DEPR_STAGES) {
    const reportPath = path.join(DEPR_ROOT, stage, project, '_deconstruction_report.md');
    if (fs.existsSync(reportPath)) {
      return res.json({ ok: true, project, report: fs.readFileSync(reportPath, 'utf8') });
    }
  }
  res.json({ ok: false, error: 'No report found for ' + project });
});

router.get('/api/deprecation/manifest/:project', (req, res) => {
  const { project } = req.params;
  for (const stage of DEPR_STAGES) {
    const mPath = path.join(DEPR_ROOT, stage, project, '_config_manifest.json');
    if (fs.existsSync(mPath)) {
      return res.json({ ok: true, project, manifest: readJsonFile(mPath) });
    }
  }
  res.json({ ok: false, error: 'No manifest found for ' + project });
});

router.get('/api/deprecation/review/:project', (req, res) => {
  const { project } = req.params;
  const rPath = path.join(DEPR_ROOT, 'deletion-stage', project, '_deletion_review.json');
  if (fs.existsSync(rPath)) {
    return res.json({ ok: true, project, review: readJsonFile(rPath) });
  }
  res.json({ ok: false, error: 'No review found for ' + project });
});

router.post('/api/deprecation/advance', (req, res) => {
  const { project, action } = req.body;
  if (!project) return res.status(400).json({ ok: false, error: 'project required' });

  const scriptMap = {
    deprecate:    path.join(DEPR_ROOT, 'deprecate.sh'),
    cleanse:      path.join(DEPR_ROOT, 'cleanse.sh'),
    deconstruct:  path.join(DEPR_ROOT, 'deconstruct.sh'),
    'stage-delete': path.join(DEPR_ROOT, 'stage-delete.sh'),
  };

  const script = scriptMap[action];
  if (!script) return res.status(400).json({ ok: false, error: 'Invalid action: ' + action });

  try {
    const output = execSync(`bash "${script}" "${project}" 2>&1`, {
      encoding: 'utf8', timeout: 30000,
    });
    // Try to parse JSON output from scripts
    try {
      const result = JSON.parse(output.trim().split('\n').pop());
      logActivity({
        category: 'admin_action', action: `deprecation_${action}`,
        tenantDomain: project, status: result.ok ? 'success' : 'error',
        actor: { email: req.superAdmin.email, role: 'superadmin' },
        details: result,
      });
      return res.json(result);
    } catch {
      return res.json({ ok: true, output });
    }
  } catch (err) {
    const errOutput = err.stdout || err.stderr || err.message;
    try {
      return res.json(JSON.parse(errOutput.trim().split('\n').pop()));
    } catch {
      return res.json({ ok: false, error: errOutput });
    }
  }
});

export default router;
