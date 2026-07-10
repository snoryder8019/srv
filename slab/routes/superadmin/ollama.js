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
        const h = await ollamaHealth();
        output = JSON.stringify(h, null, 2);
        if (h.llm?.ok || h.sd?.ok) return res.json({ ok: true, tool, output, models: h.llm?.models || [], llm: h.llm, sd: h.sd });
        return res.json({ ok: false, tool, output, error: h.error || 'unreachable' });
      }
      default:
        output = 'Unknown tool: ' + tool;
    }
    res.json({ ok: true, tool, output });
  } catch (err) {
    res.json({ ok: false, tool, output: 'Error: ' + err.message });
  }
});

// ── Ollama tunnel analytics (proxy to ollama.madladslab.com) ────────────────
router.get('/api/ollama/health', async (req, res) => {
  res.json(await ollamaHealth());
});

router.get('/api/ollama/keys', async (req, res) => {
  const r = await ollamaFetch('/analytics/keys');
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.get('/api/ollama/rate', async (req, res) => {
  const r = await ollamaFetch('/analytics/rate');
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.get('/api/ollama/analytics', async (req, res) => {
  const qs = new URLSearchParams();
  if (req.query.since) qs.set('since', String(req.query.since));
  if (req.query.until) qs.set('until', String(req.query.until));
  if (req.query.key)   qs.set('key',   String(req.query.key));
  const path = '/analytics' + (qs.toString() ? '?' + qs.toString() : '');
  const r = await ollamaFetch(path, { timeoutMs: 10000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

// Consolidated cluster snapshot — services, gpus, sd, tier, keys (w/ analytics), totals
// Generous timeout: cold cluster wake from DARK/COLD tier can take 10–20s on the first request.
router.get('/api/ollama/overview', async (req, res) => {
  const r = await ollamaFetch('/admin/overview', { timeoutMs: 12000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

// Temporary diagnostic — probes each admin endpoint with a short timeout to see what's reachable
router.get('/api/ollama/_probe', async (req, res) => {
  const paths = ['/health', '/status', '/admin/services', '/admin/gpus', '/admin/keys', '/admin/models', '/admin/overview', '/analytics/keys', '/analytics/rate'];
  const out = {};
  await Promise.all(paths.map(async p => {
    const t0 = Date.now();
    const r = await ollamaFetch(p, { timeoutMs: 6000, auth: !p.startsWith('/health') && !p.startsWith('/status') ? true : true });
    out[p] = { status: r.status, ok: r.ok, ms: Date.now() - t0, err: r.error || null, sample: typeof r.body === 'string' ? r.body.slice(0, 120) : (r.body ? Object.keys(r.body).slice(0, 6) : null) };
  }));
  res.json(out);
});

// ── Cluster control surface (Bearer with `analytics` or `*` scope) ──
// Whitelist matches handoff: OllamaCluster | OllamaClusterTunnel | OllamaSD | OllamaWatchdog | OllamaClusterBenchmark | OllamaMCP
router.post('/api/ollama/services/:name/restart', async (req, res) => {
  const name = String(req.params.name);
  if (!OLLAMA_SERVICE_NAMES.has(name)) {
    return res.status(400).json({ ok: false, error: 'unknown_service', name });
  }
  const r = await ollamaFetch(`/admin/services/${encodeURIComponent(name)}/restart`, { method: 'POST', timeoutMs: 15000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.post('/api/ollama/watchdog/pause', async (req, res) => {
  const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason : 'paused from superadmin';
  const r = await ollamaFetch('/admin/watchdog/pause', { method: 'POST', body: { reason }, timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.post('/api/ollama/watchdog/resume', async (req, res) => {
  const r = await ollamaFetch('/admin/watchdog/resume', { method: 'POST', timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.post('/api/ollama/benchmark/run', async (req, res) => {
  const r = await ollamaFetch('/admin/benchmark/run', { method: 'POST', timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

// Key management — mint returns a one-time secret; callers must surface it to the user immediately.
router.post('/api/ollama/keys/mint', async (req, res) => {
  const b = req.body || {};
  if (!b.label || !/^[A-Za-z0-9._-]+$/.test(String(b.label))) {
    return res.status(400).json({ ok: false, error: 'invalid_label' });
  }
  const payload = {
    label:   String(b.label),
    scopes:  Array.isArray(b.scopes) ? b.scopes : [],
    limits:  b.limits && typeof b.limits === 'object' ? b.limits : {},
    expires: b.expires ?? null,
    notes:   typeof b.notes === 'string' ? b.notes : undefined,
  };
  const r = await ollamaFetch('/admin/keys/mint', { method: 'POST', body: payload, timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.post('/api/ollama/keys/:label/assign', async (req, res) => {
  const label = encodeURIComponent(String(req.params.label));
  const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
  const r = await ollamaFetch(`/admin/keys/${label}/assign`, { method: 'POST', body: { scopes }, timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.post('/api/ollama/keys/:label/expire', async (req, res) => {
  const label = encodeURIComponent(String(req.params.label));
  const when = req.body?.when ?? null;
  const r = await ollamaFetch(`/admin/keys/${label}/expire`, { method: 'POST', body: { when }, timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.post('/api/ollama/keys/:label/revoke', async (req, res) => {
  const label = encodeURIComponent(String(req.params.label));
  const r = await ollamaFetch(`/admin/keys/${label}/revoke`, { method: 'POST', timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.post('/api/ollama/keys/:label/enable', async (req, res) => {
  const label = encodeURIComponent(String(req.params.label));
  const r = await ollamaFetch(`/admin/keys/${label}/enable`, { method: 'POST', timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.post('/api/ollama/keys/:label/limits', async (req, res) => {
  const label = encodeURIComponent(String(req.params.label));
  const b = req.body || {};
  const body = {
    rpm: Number.isFinite(+b.rpm) ? +b.rpm : 0,
    rpd: Number.isFinite(+b.rpd) ? +b.rpd : 0,
    concurrent: Number.isFinite(+b.concurrent) ? +b.concurrent : 0,
  };
  const r = await ollamaFetch(`/admin/keys/${label}/limits`, { method: 'POST', body, timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

router.delete('/api/ollama/keys/:label', async (req, res) => {
  const label = encodeURIComponent(String(req.params.label));
  const r = await ollamaFetch(`/admin/keys/${label}`, { method: 'DELETE', timeoutMs: 8000 });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, error: r.error, data: r.body });
});

// ── GPU box bucket (MinIO) + database (Mongo) health — proxied via cluster.js scopes ──
// snory-admin token has `*` scope so it satisfies both `bucket` and `database`.
// Returns a normalized shape that mirrors `pingBucket()` / `pingMongo()` so the client
// can render either source through the same UI slots.

router.get('/api/gpu/bucket', async (req, res) => {
  const t0 = Date.now();
  // GET /s3/ on cluster.js returns the MinIO bucket list (LB strips the Bearer and re-signs with root creds)
  const r = await ollamaFetch('/s3/', { timeoutMs: 8000 });
  const latencyMs = Date.now() - t0;
  if (!r.ok) {
    return res.status(502).json({ ok: false, latencyMs, error: r.error || ('upstream ' + r.status), status: r.status });
  }
  // MinIO ListBuckets returns XML by default; cluster.js does NOT transform it. Try to extract bucket names.
  const xml = typeof r.body === 'string' ? r.body : (r.body && typeof r.body === 'object' ? JSON.stringify(r.body) : '');
  const names = Array.from(xml.matchAll(/<Name>([^<]+)<\/Name>/g)).map(m => m[1]).filter(n => n && n !== 'minio');
  res.json({
    ok: true,
    latencyMs,
    endpoint: 'gpu-box:9000 (MinIO)',
    region: 'on-prem',
    bucketCount: names.length,
    buckets: names.slice(0, 12),
    bucket: names[0] || '(none)',
    sampleKey: null,
    note: 'G:\\application_Data\\minio\\data (8TB HDD)',
  });
});

router.get('/api/gpu/db', async (req, res) => {
  const t0 = Date.now();
  // GET /db on cluster.js returns the database list (Mongo root proxy)
  const r = await ollamaFetch('/db', { timeoutMs: 8000 });
  const latencyMs = Date.now() - t0;
  if (!r.ok) {
    return res.status(502).json({ ok: false, latencyMs, error: r.error || ('upstream ' + r.status), status: r.status });
  }
  // Response shape from cluster.js typically: { databases: [{name, sizeOnDisk}, ...] } OR a raw array
  const body = r.body;
  let databases = [];
  if (Array.isArray(body)) databases = body;
  else if (body && Array.isArray(body.databases)) databases = body.databases;
  else if (body && Array.isArray(body.dbs)) databases = body.dbs;
  // Normalize entries to { name, sizeOnDisk }
  databases = databases.map(d => typeof d === 'string'
    ? { name: d, sizeOnDisk: null }
    : { name: d.name || d.db || '(unknown)', sizeOnDisk: d.sizeOnDisk ?? d.size ?? null }
  );
  const totalSize = databases.reduce((s, d) => s + (d.sizeOnDisk || 0), 0);
  res.json({
    ok: true,
    latencyMs,
    endpoint: 'gpu-box:27017 (MongoDB)',
    version: body?.version || null,
    uptimeSec: body?.uptimeSec || null,
    connections: body?.connections || null,
    dbCount: databases.length,
    totalSizeBytes: totalSize || null,
    databases: databases.slice(0, 16),
    note: 'C:\\application_Data\\mongo\\data (SSD)',
  });
});

// ── Infrastructure ping (ollama, sd, mongo, bucket) — cached so /api/ops/pulse can include
// external nodes in the Harmony scene without paying ping costs every 2-second tick.

export default router;
