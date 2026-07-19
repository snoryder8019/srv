// Shared helpers, monitoring/ops utilities, ollama proxy, deprecation pipeline,
// gateway tokens, and graffiti-tv JSON store for the /superadmin route modules.
// Extracted verbatim from the original single-file superadmin.js.
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
  trial: 'Free Trial',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
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
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
}
function safeExec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 10000 }); }
  catch (e) { return e.stdout || e.message || 'Command failed'; }
}

function ollamaBase() {
  return (config.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions')
    .replace(/\/v1\/chat\/completions\/?$/, '')
    .replace(/\/$/, '');
}

async function ollamaFetch(pathname, { auth = true, timeoutMs = 6000, method = 'GET', body } = {}) {
  const url = ollamaBase() + pathname;
  const headers = { 'Accept': 'application/json' };
  if (auth && config.OLLAMA_KEY) headers['Authorization'] = 'Bearer ' + config.OLLAMA_KEY;
  const init = { method, headers, signal: undefined };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const ctl = new AbortController();
  init.signal = ctl.signal;
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let respBody; try { respBody = JSON.parse(text); } catch { respBody = text; }
    return { ok: r.ok, status: r.status, body: respBody };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function ollamaHealth() {
  const [llm, sd] = await Promise.all([ollamaFetch('/health', { auth: false }), ollamaFetch('/health/sd', { auth: false })]);
  return {
    llm: { ok: llm.ok, status: llm.status, ...(typeof llm.body === 'object' && llm.body ? llm.body : {}), error: llm.error },
    sd:  { ok: sd.ok,  status: sd.status,  ...(typeof sd.body  === 'object' && sd.body  ? sd.body  : {}), error: sd.error },
  };
}

const OLLAMA_SERVICE_NAMES = new Set([
  'OllamaCluster', 'OllamaClusterTunnel', 'OllamaSD',
  'OllamaWatchdog', 'OllamaClusterBenchmark', 'OllamaMCP',
  // future: 'OllamaBucket', 'OllamaMongo' once registered as scheduled tasks
]);

const infraCache = { ts: 0, data: null, refreshing: false };
const INFRA_TTL_MS = 8000;

async function pingMongo() {
  const t0 = Date.now();
  try {
    const slab = getSlabDb();
    const ping = await slab.command({ ping: 1 });
    let status = null, dbList = null;
    try { status = await slab.admin().serverStatus(); } catch {}
    try { dbList = await slab.admin().listDatabases(); } catch {}
    const latencyMs = Date.now() - t0;
    return {
      ok: ping?.ok === 1,
      latencyMs,
      version: status?.version || null,
      connections: status?.connections || null,
      uptimeSec: status?.uptime || null,
      memMB: status?.mem?.resident || null,
      dbCount: dbList?.databases?.length || null,
      totalSizeBytes: dbList?.totalSize || null,
      databases: (dbList?.databases || []).slice(0, 16).map(d => ({ name: d.name, sizeOnDisk: d.sizeOnDisk })),
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: e.message };
  }
}

async function pingBucket() {
  const t0 = Date.now();
  try {
    // ListObjectsV2 with MaxKeys=1 gives reachability + a sample key (HeadBucket needs special permission)
    const out = await s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
    const latencyMs = Date.now() - t0;
    return {
      ok: true,
      latencyMs,
      bucket: BUCKET,
      endpoint: config.LINODE_ENDPOINT,
      region: config.LINODE_REGION,
      keyCountSample: out.KeyCount || 0,
      sampleKey: out.Contents?.[0]?.Key || null,
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: e.message, bucket: BUCKET, endpoint: config.LINODE_ENDPOINT, region: config.LINODE_REGION };
  }
}

async function pingOllamaAll() {
  const t0 = Date.now();
  const h = await ollamaHealth();
  const latencyMs = Date.now() - t0;
  return { latencyMs, ...h };
}

async function refreshInfra() {
  if (infraCache.refreshing) return infraCache.data;
  infraCache.refreshing = true;
  try {
    const [mongo, bucket, ollama] = await Promise.all([pingMongo(), pingBucket(), pingOllamaAll()]);
    infraCache.data = { ts: Date.now(), mongo, bucket, ollama };
    infraCache.ts = Date.now();
    return infraCache.data;
  } finally {
    infraCache.refreshing = false;
  }
}

async function getInfraCached() {
  if (!infraCache.data || (Date.now() - infraCache.ts) > INFRA_TTL_MS) {
    // Kick refresh but don't block — return stale if available; otherwise await first fetch
    if (!infraCache.data) return await refreshInfra();
    refreshInfra().catch(() => {});
  }
  return infraCache.data;
}

const pulseCache = { lastActivity: {}, lastHistory: {}, history: [], lastCpuSample: null, lastTail: {}, lastErrCount: {} };

// Count error markers in a tail-50 block (HTTP 4xx/5xx access lines, Error/throws, common stack words)
const ERR_RE = /\b[45]\d{2}\b|\bError\b|\bECONN[A-Z]+\b|\bENOTFOUND\b|\bEACCES\b|\bUnhandled\b|TypeError|RangeError|ReferenceError/i;
function countErrorLines(s) {
  if (!s) return 0;
  let n = 0;
  for (const line of s.split('\n')) { if (ERR_RE.test(line)) n++; }
  return n;
}

function tmuxTail(session, lines = 50) {
  try {
    return execSync(`tmux capture-pane -t ${session} -p -S -${lines} 2>/dev/null`, { encoding: 'utf8', timeout: 1200 }) || '';
  } catch { return ''; }
}

function sysSnapshot() {
  // Load averages (Linux)
  const load = os.loadavg(); // [1m, 5m, 15m]
  const cores = os.cpus().length || 1;

  // Memory from /proc/meminfo (more accurate than os.freemem on Linux)
  let memTotal = os.totalmem(), memFree = os.freemem(), memAvail = memFree;
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = k => { const m = mi.match(new RegExp('^' + k + ':\\s+(\\d+)\\s+kB', 'm')); return m ? parseInt(m[1], 10) * 1024 : null; };
    memTotal = get('MemTotal') ?? memTotal;
    memFree = get('MemFree') ?? memFree;
    memAvail = get('MemAvailable') ?? memFree;
  } catch {}

  // CPU usage % since last sample (instantaneous)
  let cpuPct = null;
  try {
    const cpus = os.cpus();
    const sample = cpus.reduce((acc, c) => {
      acc.idle += c.times.idle;
      acc.total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
      return acc;
    }, { idle: 0, total: 0 });
    if (pulseCache.lastCpuSample) {
      const dIdle = sample.idle - pulseCache.lastCpuSample.idle;
      const dTotal = sample.total - pulseCache.lastCpuSample.total;
      if (dTotal > 0) cpuPct = Math.max(0, Math.min(100, 100 * (1 - dIdle / dTotal)));
    }
    pulseCache.lastCpuSample = sample;
  } catch {}

  // Top processes by CPU (single call, cheap)
  let topProcs = [];
  try {
    const out = execSync('ps -eo pid,pcpu,pmem,rss,comm --sort=-pcpu --no-headers 2>/dev/null | head -8', { encoding: 'utf8', timeout: 1000 });
    topProcs = out.trim().split('\n').filter(Boolean).map(line => {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.+)$/);
      if (!m) return null;
      return { pid: parseInt(m[1], 10), cpu: parseFloat(m[2]), mem: parseFloat(m[3]), rssKb: parseInt(m[4], 10), name: m[5].trim() };
    }).filter(Boolean);
  } catch {}

  // Process count
  let procCount = null;
  try { procCount = parseInt(execSync('ps -e --no-headers 2>/dev/null | wc -l', { encoding: 'utf8', timeout: 600 }).trim(), 10); } catch {}

  return {
    load: { m1: load[0], m5: load[1], m15: load[2], cores },
    cpuPct,
    mem: { total: memTotal, free: memFree, available: memAvail, used: memTotal - memAvail, usedPct: memTotal ? ((memTotal - memAvail) / memTotal) * 100 : 0 },
    procs: { total: procCount, top: topProcs },
    uptimeSec: os.uptime(),
  };
}

function peerLabel(addr, ports) {
  // Cheap heuristics — only label well-known ones
  const portSet = new Set(ports);
  if (portSet.has(27017)) return 'MongoDB Atlas';
  if (portSet.has(443) && addr.endsWith('.googleapis.com')) return 'Google APIs';
  if (portSet.has(443) && /\.amazonaws\.com$/.test(addr)) return 'AWS';
  if (portSet.has(443) && /(github|githubusercontent)\.com$/.test(addr)) return 'GitHub';
  if (portSet.has(443) && /\.zoho/.test(addr)) return 'Zoho';
  if (portSet.has(443) && /\.stripe\.com$/.test(addr)) return 'Stripe';
  if (portSet.has(443) && /\.cloudflare/.test(addr)) return 'Cloudflare';
  if (portSet.has(443) && /\.openai\.com$/.test(addr)) return 'OpenAI';
  if (portSet.has(443) && /anthropic/.test(addr)) return 'Anthropic';
  if (portSet.has(80)) return addr + ' (http)';
  if (portSet.has(443)) return addr + ' (https)';
  if (portSet.has(25) || portSet.has(465) || portSet.has(587)) return addr + ' (smtp)';
  return addr;
}

// ── Deprecation pipeline: ingest a service into /srv/depricated/new/<name> ──
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

const GATEWAY_APPS = {
  opsTrain:       { port: 3603, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'OpsTrain' },
  madladslab:     { port: 3000, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'MadLadsLab' },
  greealitytv:    { port: 3400, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'GreeAlityTV' },
  games:          { port: 3500, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'Games' },
  bih:            { port: 3055, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'BallzInHolez' },
  ps:             { port: 3399, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'Stringborn' },
  acm:            { port: 3004, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'ACM' },
  nocometalworkz: { port: 3002, secret: 'doner5%$$!@ojeFGojtYOjergewr', label: 'NoCometal' },
};

function generateGatewayToken(app, email, secret, extra = {}) {
  const payload = JSON.stringify({ app, email, ts: Date.now(), ...extra });
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

import { readFileSync as gftvReadFS, writeFileSync as gftvWriteFS, existsSync as gftvExistsFS } from 'fs';

const GFTV_DATA = '/srv/graffiti-tv/data';
const PLAN_PRICES_GFTV = { starter: 18, pro: 35 };

function gftvRead(file, def = []) {
  const p = `${GFTV_DATA}/${file}`;
  if (!gftvExistsFS(p)) return def;
  try { return JSON.parse(gftvReadFS(p, 'utf8')); } catch { return def; }
}

function gftvWrite(file, data) {
  gftvWriteFS(`${GFTV_DATA}/${file}`, JSON.stringify(data, null, 2));
}

// JSON API — dashboard tab loads this

export {
  TENANT_TAGS, PLAN_LABELS, sendSubscriptionEmail, noStore, safeExec,
  ollamaBase, ollamaFetch, ollamaHealth, OLLAMA_SERVICE_NAMES,
  infraCache, INFRA_TTL_MS, pingMongo, pingBucket, pingOllamaAll, refreshInfra, getInfraCached,
  pulseCache, ERR_RE, countErrorLines, tmuxTail, sysSnapshot, peerLabel,
  DEPR_ROOT, DEPR_STAGES, readJsonFile, getDeprecationPipeline, getDeprecatableSrvProjects,
  GATEWAY_APPS, generateGatewayToken, GFTV_DATA, PLAN_PRICES_GFTV, gftvRead, gftvWrite,
};
