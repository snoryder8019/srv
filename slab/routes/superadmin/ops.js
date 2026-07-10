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

router.get('/api/ops/infra', async (req, res) => {
  if (req.query.refresh === '1') infraCache.ts = 0;
  const data = await getInfraCached();
  res.json({ ok: true, ...data });
});

// ── Ops Pulse — per-service activity for the harmony visualizer ─────────────
router.get('/api/ops/pulse', (req, res) => {
  // Exclude services whose source dir has been moved out of /srv (deprecated pipeline),
  // and the explicit 'deprecated' category. Keeps stale red orbs out of the harmony scene.
  const services = getServices().filter(s => s.hasDir !== false && s.category !== 'deprecated');
  const now = Date.now();

  // Pull session_activity + history_size for all tmux sessions in one call.
  const tmux = {};
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}|#{session_activity}|#{history_size}" 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
    out.trim().split('\n').forEach(line => {
      const [name, act, size] = line.split('|');
      if (!name) return;
      tmux[name] = { activity: parseInt(act, 10) * 1000, size: parseInt(size, 10) || 0 };
    });
  } catch { /* tmux missing or no sessions */ }

  // One ss call, bucket established connections by local port.
  const connsByPort = {};
  try {
    const out = execSync('ss -tn state established 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
    out.split('\n').slice(1).forEach(line => {
      const m = line.match(/:(\d+)\s+\S+:\d+/);
      if (m) { const p = parseInt(m[1], 10); connsByPort[p] = (connsByPort[p] || 0) + 1; }
    });
  } catch {}

  // Pull in any tmux sessions that AREN'T in the registry as "unregistered" services,
  // so newly spun-up sessions show up in the harmony immediately.
  const registeredTmux = new Set(services.filter(s => s.tmux).map(s => s.tmux));
  const allSessionNames = Object.keys(tmux);
  const unregistered = allSessionNames
    .filter(name => !registeredTmux.has(name))
    .map(name => ({
      name,
      dir: null,
      port: null,
      domain: null,
      tmux: name,
      category: 'unregistered',
      description: 'tmux session not in registry',
      alive: true,
      unregistered: true,
    }));
  const allServices = services.concat(unregistered);

  let totalConns = 0;
  let totalErrorPulses = 0;
  const enriched = allServices.map(svc => {
    const t = svc.tmux ? tmux[svc.tmux] : null;
    const prevAct = pulseCache.lastActivity[svc.name];
    const prevSize = pulseCache.lastHistory[svc.name];
    const activityChanged = !!(t && prevAct != null && t.activity > prevAct);
    const outputGrew = !!(t && prevSize != null && t.size > prevSize);

    // Sample tail-50 only when output grew, to detect new error lines without paying for every session every tick
    let errorPulse = false;
    if (svc.tmux && outputGrew) {
      const tail = tmuxTail(svc.tmux, 50);
      pulseCache.lastTail[svc.name] = tail;
      const errCount = countErrorLines(tail);
      const prevErr = pulseCache.lastErrCount[svc.name] ?? errCount;
      if (errCount > prevErr) errorPulse = true;
      pulseCache.lastErrCount[svc.name] = errCount;
    }

    if (t) { pulseCache.lastActivity[svc.name] = t.activity; pulseCache.lastHistory[svc.name] = t.size; }
    const conns = svc.port ? (connsByPort[svc.port] || 0) : 0;
    totalConns += conns;
    if (errorPulse) totalErrorPulses++;
    return {
      name: svc.name,
      tmux: svc.tmux || null,
      port: svc.port || null,
      category: svc.category || 'tool',
      alive: svc.alive === true,
      unregistered: !!svc.unregistered,
      conns,
      idleMs: t?.activity ? Math.max(0, now - t.activity) : null,
      pulse: activityChanged || outputGrew,
      pulseKind: errorPulse ? 'error' : (outputGrew ? 'output' : (activityChanged ? 'session' : null)),
    };
  });

  const sys = sysSnapshot();

  // Infra (ollama, sd, mongo, bucket) — pulled from the cached infra ping (refreshed
  // every ~8s). These ride along on the pulse stream so the Harmony 3D scene can
  // light them up as alive/dead alongside the tmux services.
  const infraData = infraCache.data || null;
  const infraEnriched = getInfraServices().map(svc => {
    let alive = null;
    let latencyMs = null;
    if (infraData) {
      if (svc.kind === 'ollama-llm')   { alive = !!infraData.ollama?.llm?.ok; latencyMs = infraData.ollama?.latencyMs ?? null; }
      else if (svc.kind === 'ollama-sd') { alive = !!infraData.ollama?.sd?.ok;  latencyMs = infraData.ollama?.latencyMs ?? null; }
      else if (svc.kind === 'mongo')    { alive = !!infraData.mongo?.ok;       latencyMs = infraData.mongo?.latencyMs ?? null; }
      else if (svc.kind === 'bucket')   { alive = !!infraData.bucket?.ok;      latencyMs = infraData.bucket?.latencyMs ?? null; }
    }
    return {
      name: svc.name,
      tmux: null,
      port: null,
      category: 'infra',
      alive: alive === null ? false : alive,
      unregistered: false,
      conns: 0,
      idleMs: null,
      latencyMs,
      pulse: alive === true,                    // a successful ping is a "pulse" for infra nodes
      pulseKind: alive === true ? 'session' : (alive === false ? 'error' : null),
      kind: svc.kind,
    };
  });
  // Kick a refresh in the background if the cache is stale; first call awaits.
  if (!infraCache.data || (Date.now() - infraCache.ts) > INFRA_TTL_MS) refreshInfra().catch(() => {});

  // Keep a 60-sample ring buffer for sparkline (~2 minutes at 2s poll).
  pulseCache.history.push({
    ts: now,
    conns: totalConns,
    pulsing: enriched.filter(e => e.pulse).length,
    cpu: sys.cpuPct,
    memPct: sys.mem.usedPct,
    load1: sys.load.m1,
  });
  if (pulseCache.history.length > 60) pulseCache.history.shift();

  res.json({ ts: now, totalConns, totalErrorPulses, services: enriched.concat(infraEnriched), history: pulseCache.history, sys, infra: infraData });
});

// ── Tail a tmux pane on demand (for hover tooltip) ─────────────────────────
router.get('/api/ops/tail', (req, res) => {
  const session = String(req.query.session || '').replace(/[^A-Za-z0-9_-]/g, '');
  const lines = Math.max(1, Math.min(500, parseInt(req.query.lines, 10) || 50));
  if (!session) return res.json({ ok: false, error: 'session required' });
  const tail = tmuxTail(session, lines);
  res.json({ ok: true, session, lines, tail, errorCount: countErrorLines(tail) });
});

// ── Outbound connections from this box (live) ──────────────────────────────
router.get('/api/ops/outbounds', (req, res) => {
  // Process for the peer (cmdline) when we can; else just count.
  let lines = [];
  try {
    const out = execSync('ss -tnp state established 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
    lines = out.split('\n').slice(1).filter(Boolean);
  } catch { return res.json({ ok: false, error: 'ss unavailable' }); }

  const peers = new Map(); // key: peerAddr+':'+peerPort, val: { peerAddr, peerPort, count, sample }
  for (const line of lines) {
    // ss output: state recvq sendq localAddr:port peerAddr:port [process]
    // The lines might have variable whitespace; use a generic split + regex for last two address:port tokens
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const local = cols[cols.length - 3] || cols[3] || '';
    const peer  = cols[cols.length - 2] || cols[4] || '';
    const proc  = cols.length > 5 ? cols.slice(5).join(' ') : '';
    // ss sometimes uses 4-col table without state — handle both layouts
    let peerAddr = peer;
    const m = peer.match(/^(.+):(\d+)$/);
    if (!m) continue;
    peerAddr = m[1].replace(/^\[|\]$/g, '');
    const peerPort = parseInt(m[2], 10);

    // Skip loopback peers (intra-host traffic)
    if (peerAddr === '127.0.0.1' || peerAddr === '::1' || peerAddr.startsWith('127.')) continue;
    // Also skip our own host's private IPs (Linode internal) — keep them for now since some are useful
    const key = peerAddr + ':' + peerPort;
    const cur = peers.get(key) || { peerAddr, peerPort, count: 0, local, proc };
    cur.count++;
    peers.set(key, cur);
  }

  // Group by peerAddr to show aggregate by host
  const byHost = new Map();
  for (const p of peers.values()) {
    const h = byHost.get(p.peerAddr) || { peerAddr: p.peerAddr, ports: new Set(), count: 0, procs: new Set() };
    h.count += p.count;
    h.ports.add(p.peerPort);
    if (p.proc) h.procs.add(p.proc);
    byHost.set(p.peerAddr, h);
  }
  const hosts = [...byHost.values()].map(h => ({
    peerAddr: h.peerAddr,
    ports: [...h.ports].sort((a, b) => a - b),
    count: h.count,
    procs: [...h.procs].slice(0, 3),
    label: peerLabel(h.peerAddr, [...h.ports]),
  })).sort((a, b) => b.count - a.count);

  res.json({ ok: true, total: peers.size, hosts });
});

// Map common peer addresses / ports to a friendly label
router.post('/api/deprecation/ingest-service', (req, res) => {
  const name = String(req.body.name || '').replace(/[^A-Za-z0-9_.-]/g, '');
  if (!name) return res.json({ ok: false, error: 'name required' });
  const svc = getService(name);
  if (!svc) return res.json({ ok: false, error: 'service not in registry' });
  if (!svc.dir || !fs.existsSync(svc.dir)) return res.json({ ok: false, error: 'service dir missing' });

  const newStage = path.join(DEPR_ROOT, 'new', svc.name);
  if (fs.existsSync(newStage)) return res.json({ ok: false, error: 'already in pipeline (new stage)' });

  let scriptOutput = '';
  try {
    // Prefer the script if it exists; otherwise do a safe rename.
    const script = path.join(DEPR_ROOT, 'deprecate.sh');
    if (fs.existsSync(script)) {
      // deprecate.sh takes <project-name> only — it derives SRC=/srv/<name> internally
      scriptOutput = execSync(`bash "${script}" "${svc.name}" 2>&1`, { encoding: 'utf8', timeout: 60000 });
    } else {
      fs.mkdirSync(path.join(DEPR_ROOT, 'new'), { recursive: true });
      fs.renameSync(svc.dir, newStage);
      fs.writeFileSync(path.join(newStage, '_receipt.json'), JSON.stringify({ deprecatedAt: new Date().toISOString(), original: svc.dir, service: svc }, null, 2));
      scriptOutput = `Moved ${svc.dir} → ${newStage}`;
    }
    try { logActivity({ action: `service '${svc.name}' deprecated → /srv/depricated/new`, category: 'admin_action', actor: { email: req.superAdmin?.email || 'system' } }); } catch {}
    res.json({ ok: true, name: svc.name, staged: newStage, output: scriptOutput });
  } catch (err) {
    res.json({ ok: false, error: err.message, output: scriptOutput || (err.stdout || '').toString() });
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

// ═══════════════════════════════════════════════════════════════════════════
// IMPERSONATE — Login as tenant admin (moved from /admin/super)
// ═══════════════════════════════════════════════════════════════════════════

export default router;
