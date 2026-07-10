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

router.get("/security", async (req, res) => {
  const slab = getSlabDb();
  const [recentEvents, latestSnapshot, latestStats] = await Promise.all([
    slab.collection("security_events").find().sort({ timestamp: -1 }).limit(300).toArray(),
    slab.collection("security_snapshots").findOne({}, { sort: { createdAt: -1 } }),
    slab.collection("security_system_stats").findOne({}, { sort: { recordedAt: -1 } }),
  ]);
  const bans   = recentEvents.filter(e => e.action === "ban");
  const unbans = recentEvents.filter(e => e.action === "unban");
  const found  = recentEvents.filter(e => e.action === "found");
  const ipCount = {};
  for (const ev of recentEvents) if (ev.ip) ipCount[ev.ip] = (ipCount[ev.ip] || 0) + 1;
  const topIPs = Object.entries(ipCount).sort((a,b) => b[1]-a[1]).slice(0,10).map(([ip,count]) => ({ ip, count }));
  res.render("superadmin/security", {
    user: req.superAdmin,
    recentEvents,
    latestSnapshot,
    latestStats,
    summary: { bans: bans.length, unbans: unbans.length, found: found.length, total: recentEvents.length },
    topIPs,
    currentJails: latestSnapshot?.bans || [],
  });
});

router.get("/api/security/summary", async (req, res) => {
  const slab = getSlabDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [events, snapshot, stats] = await Promise.all([
    slab.collection("security_events").find({ timestamp: { $gte: since } }).sort({ timestamp: -1 }).toArray(),
    slab.collection("security_snapshots").findOne({}, { sort: { createdAt: -1 } }),
    slab.collection("security_system_stats").findOne({}, { sort: { recordedAt: -1 } }),
  ]);
  res.json({ ok: true, events: events.slice(0,50), jails: snapshot?.bans || [], stats,
    summary: { bans: events.filter(e=>e.action==="ban").length, unbans: events.filter(e=>e.action==="unban").length, found: events.filter(e=>e.action==="found").length } });
});


// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM EVENTS — signups, contacts, bookings across all apps
// ═══════════════════════════════════════════════════════════════════════════
router.get('/events', async (req, res) => {
  const slab = getSlabDb();

  const typeFilter = req.query.type || '';
  const appFilter  = req.query.app  || '';
  const limit = parseInt(req.query.limit) || 100;

  const query = {};
  if (typeFilter) query.type = typeFilter;
  if (appFilter)  query.app  = appFilter;

  const [events, total, stats] = await Promise.all([
    slab.collection('platform_events').find(query).sort({ createdAt: -1 }).limit(limit).toArray(),
    slab.collection('platform_events').countDocuments(),
    slab.collection('platform_events').aggregate([
      { $group: { _id: { type: '$type', app: '$app' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
  ]);

  // Tally by type for today
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayCounts = await slab.collection('platform_events').aggregate([
    { $match: { createdAt: { $gte: todayStart } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]).toArray();
  const today = {};
  todayCounts.forEach(t => { today[t._id] = t.count; });

  res.render('superadmin/events', {
    user: req.superAdmin,
    events,
    total,
    stats,
    today,
    filters: { type: typeFilter, app: appFilter },
  });
});

router.get('/api/events/stream', async (req, res) => {
  const slab = getSlabDb();
  const since = new Date(Date.now() - 5 * 60 * 1000); // last 5 min
  const events = await slab.collection('platform_events')
    .find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 }).limit(20).toArray();
  res.json({ events, count: events.length });
});

// ── Comms delivery ledger ─────────────────────────────────────────────────
// Cross-app per-user communications log (slab.comms_log). Every welcome /
// signup-alert / confirmation send across games, opsTrain, graffiti-tv, etc.
// records sent | failed | skipped here so a silent email death is visible.
router.get('/api/comms', async (req, res) => {
  const slab = getSlabDb();
  const { app = '', status = '', type = '', q = '' } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 150, 500);
  const filter = {};
  if (app) filter.app = app;
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (q) filter.to = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const [entries, byStatus] = await Promise.all([
    slab.collection('comms_log').find(filter).sort({ createdAt: -1 }).limit(limit).toArray(),
    slab.collection('comms_log').aggregate([
      { $group: { _id: { app: '$app', status: '$status' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
  ]);
  res.json({ ok: true, count: entries.length, entries, byStatus });
});

router.get('/comms', async (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comms Ledger · sLab Superadmin</title>
<style>
  body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:Inter,system-ui,sans-serif}
  header{padding:16px 24px;border-bottom:1px solid #222;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  header b{letter-spacing:.06em}header a{color:#888;text-decoration:none;font-size:.85rem}
  .wrap{max-width:1180px;margin:0 auto;padding:24px}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
  .filters input,.filters select{background:#141414;border:1px solid #262626;color:#e5e5e5;padding:7px 10px;border-radius:6px;font:inherit;font-size:.85rem}
  .filters button{background:#22c55e;border:none;color:#000;padding:7px 14px;border-radius:6px;cursor:pointer;font-weight:600}
  .stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
  .stat{background:#141414;border:1px solid #262626;border-radius:8px;padding:10px 16px;font-size:.8rem}
  table{width:100%;border-collapse:collapse;background:#111;border:1px solid #222;border-radius:8px;overflow:hidden}
  th,td{text-align:left;padding:8px 12px;font-size:.82rem;border-bottom:1px solid #1d1d1d;vertical-align:top}
  th{color:#888;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em}
  .pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.66rem;text-transform:uppercase}
  .pill.sent{background:rgba(34,197,94,.15);color:#22c55e}
  .pill.failed{background:rgba(205,65,43,.2);color:#f0593f}
  .pill.skipped{background:rgba(230,184,0,.15);color:#e6b800}
  .err{color:#f0593f;font-size:.74rem}.muted{color:#777}
</style></head><body>
<header><b>sLab · COMMS LEDGER</b><a href="/superadmin/events">← events</a><a href="/superadmin">dashboard</a></header>
<div class="wrap">
  <div class="filters">
    <input id="q" placeholder="search email…">
    <select id="app"><option value="">all apps</option><option>games</option><option>slab</option><option>opstrain</option><option>graffiti-tv</option><option>greealitytv</option><option>acm</option></select>
    <select id="status"><option value="">all status</option><option>sent</option><option>failed</option><option>skipped</option></select>
    <button onclick="load()">filter</button>
  </div>
  <div class="stats" id="stats"></div>
  <table><thead><tr><th>When</th><th>App</th><th>Type</th><th>To</th><th>Status</th><th>Reason / subject</th></tr></thead><tbody id="rows"></tbody></table>
</div>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString():'—';
const pill=s=>'<span class="pill '+esc(s)+'">'+esc(s)+'</span>';
async function load(){
  const p=new URLSearchParams();
  const q=document.getElementById('q').value.trim();if(q)p.set('q',q);
  const a=document.getElementById('app').value;if(a)p.set('app',a);
  const s=document.getElementById('status').value;if(s)p.set('status',s);
  const r=await fetch('/superadmin/api/comms?'+p.toString());const d=await r.json();
  document.getElementById('stats').innerHTML=(d.byStatus||[]).map(b=>'<div class="stat">'+esc(b._id.app)+' · '+pill(b._id.status)+' '+b.count+'</div>').join('');
  document.getElementById('rows').innerHTML=(d.entries||[]).map(e=>'<tr><td class="muted">'+fmt(e.createdAt)+'</td><td>'+esc(e.app)+'</td><td>'+esc(e.type)+'</td><td>'+esc(e.to)+'</td><td>'+pill(e.status)+'</td><td>'+(e.error?'<span class="err">'+esc(e.error)+'</span>':'<span class="muted">'+esc(e.subject||'')+'</span>')+'</td></tr>').join('')||'<tr><td colspan="6" class="muted">No entries.</td></tr>';
}
load();setInterval(load,30000);
</script></body></html>`);
});


export default router;
