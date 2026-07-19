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


// ═══════════════════════════════════════════════════════════════════════════
// LIVE REPORTING — crons, backend + front-end errors  (testing-phase observability)
// ═══════════════════════════════════════════════════════════════════════════

// ── Cron health: per-job last run / outcome / failure streak + recent runs ──
router.get('/api/crons', async (req, res) => {
  const slab = getSlabDb();
  const [state, recent] = await Promise.all([
    slab.collection('cron_state').find({}).toArray(),
    slab.collection('cron_runs').find({}).sort({ at: -1 }).limit(60).toArray(),
  ]);
  const now = Date.now();
  const jobs = state.map((s) => {
    const last = s.lastFinishedAt || s.lastRun || null;
    const ageMs = last ? now - new Date(last).getTime() : null;
    // Stale = a daily job silent >26h, or any job with no run recorded yet.
    const stale = ageMs != null && s.kind === 'daily' && ageMs > 26 * 3600 * 1000;
    const health = (s.consecutiveFailures > 0) ? 'fail' : (s.lastStatus === 'ok' ? 'ok' : (last ? 'ok' : 'unknown'));
    return {
      name: s._id, label: s.label || s._id, kind: s.kind || '—',
      lastRun: last, ageMs, stale,
      lastStatus: s.lastStatus || null, lastDurationMs: s.lastDurationMs || 0,
      lastError: s.lastError || null,
      runs: s.runs || 0, fails: s.fails || 0, consecutiveFailures: s.consecutiveFailures || 0,
      health,
    };
  }).sort((a, b) => (b.consecutiveFailures - a.consecutiveFailures) || String(a.name).localeCompare(b.name));
  res.json({ ok: true, jobs, recent });
});

// ── Errors: backend (error_logs) + front-end (client_errors), filterable ──
router.get('/api/errors', async (req, res) => {
  const slab = getSlabDb();
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const q = (req.query.q || '').trim();
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const serverFilter = rx ? { $or: [{ message: rx }, { route: rx }] } : {};
  const clientFilter = rx ? { $or: [{ message: rx }, { url: rx }] } : {};
  const [server, client, serverToday, clientToday] = await Promise.all([
    slab.collection('error_logs').find(serverFilter).sort({ at: -1 }).limit(limit).toArray(),
    slab.collection('client_errors').find(clientFilter).sort({ at: -1 }).limit(limit).toArray(),
    slab.collection('error_logs').countDocuments({ at: { $gte: since } }),
    slab.collection('client_errors').countDocuments({ at: { $gte: since } }),
  ]);
  res.json({ ok: true, server, client, counts: { serverToday, clientToday } });
});

// ── Reporting hub — one page linking every live feed ──
router.get('/reports', (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Live Reporting · sLab</title>
<style>
  body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:Inter,system-ui,sans-serif}
  header{padding:16px 24px;border-bottom:1px solid #222}header b{letter-spacing:.06em}
  .wrap{max-width:1000px;margin:0 auto;padding:32px 24px}
  h1{font-weight:600;font-size:1.4rem;margin:0 0 6px}.sub{color:#888;font-size:.9rem;margin-bottom:26px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
  a.card{display:block;background:#141414;border:1px solid #262626;border-radius:10px;padding:18px 20px;text-decoration:none;color:#e5e5e5;transition:border-color .15s}
  a.card:hover{border-color:#3b82f6}
  a.card .t{font-size:1.05rem;font-weight:600;margin-bottom:6px}
  a.card .d{color:#888;font-size:.82rem;line-height:1.5}
  a.card .e{font-size:1.3rem;margin-bottom:8px;display:block}
</style></head><body>
<header><b>sLab · LIVE REPORTING</b> &nbsp; <a href="/superadmin" style="color:#888;text-decoration:none;font-size:.85rem">← dashboard</a></header>
<div class="wrap">
  <h1>Live Reporting</h1>
  <div class="sub">Real-time health for the testing phase — traffic, jobs, and errors across the whole platform.</div>
  <div class="grid">
    <a class="card" href="/superadmin/crons"><span class="e">⏱️</span><div class="t">Cron Health</div><div class="d">Every scheduled job: last run, duration, and failure streaks.</div></a>
    <a class="card" href="/superadmin/errors"><span class="e">🚨</span><div class="t">Errors</div><div class="d">Backend crashes + front-end JS errors from real browsers.</div></a>
    <a class="card" href="/superadmin"><span class="e">📈</span><div class="t">Traffic</div><div class="d">Per-tenant route usage & endpoint popularity (dashboard).</div></a>
    <a class="card" href="/superadmin/comms"><span class="e">✉️</span><div class="t">Comms Ledger</div><div class="d">Every email send: sent / failed / skipped.</div></a>
    <a class="card" href="/superadmin/events"><span class="e">🔔</span><div class="t">Platform Events</div><div class="d">Signups, contacts, bookings across all apps.</div></a>
    <a class="card" href="/superadmin/security"><span class="e">🛡️</span><div class="t">Security</div><div class="d">Bans, probes, and system stats.</div></a>
  </div>
</div>
</body></html>`);
});

// ── Cron health page ──
router.get('/crons', (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Cron Health · sLab</title>
<style>
  body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:Inter,system-ui,sans-serif}
  header{padding:16px 24px;border-bottom:1px solid #222;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  header b{letter-spacing:.06em}header a{color:#888;text-decoration:none;font-size:.85rem}
  .wrap{max-width:1180px;margin:0 auto;padding:24px}
  table{width:100%;border-collapse:collapse;background:#111;border:1px solid #222;border-radius:8px;overflow:hidden;margin-bottom:26px}
  th,td{text-align:left;padding:9px 12px;font-size:.82rem;border-bottom:1px solid #1d1d1d;vertical-align:top}
  th{color:#888;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em}
  .pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.66rem;text-transform:uppercase;font-weight:600}
  .pill.ok{background:rgba(34,197,94,.15);color:#22c55e}.pill.fail{background:rgba(205,65,43,.2);color:#f0593f}
  .pill.unknown{background:rgba(160,160,160,.15);color:#aaa}.pill.stale{background:rgba(230,184,0,.15);color:#e6b800}
  .err{color:#f0593f;font-size:.74rem}.muted{color:#777}h2{font-weight:600;font-size:1rem;margin:0 0 12px}
</style></head><body>
<header><b>sLab · CRON HEALTH</b><a href="/superadmin/reports">← reports</a><a href="/superadmin/errors">errors</a><a href="/superadmin">dashboard</a></header>
<div class="wrap">
  <h2>Scheduled jobs</h2>
  <table><thead><tr><th>Job</th><th>Type</th><th>Health</th><th>Last run</th><th>Duration</th><th>Runs / Fails</th><th>Last error</th></tr></thead><tbody id="jobs"></tbody></table>
  <h2>Recent runs</h2>
  <table><thead><tr><th>When</th><th>Job</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead><tbody id="runs"></tbody></table>
</div>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString():'—';
const ago=ms=>{if(ms==null)return 'never';const s=Math.floor(ms/1000);if(s<60)return s+'s ago';const m=Math.floor(s/60);if(m<60)return m+'m ago';const h=Math.floor(m/60);if(h<48)return h+'h ago';return Math.floor(h/24)+'d ago';};
const dur=ms=>ms>=1000?(ms/1000).toFixed(1)+'s':ms+'ms';
async function load(){
  const d=await (await fetch('/superadmin/api/crons')).json();
  document.getElementById('jobs').innerHTML=(d.jobs||[]).map(j=>{
    let h=j.health;if(j.stale&&h==='ok')h='stale';
    return '<tr><td><b>'+esc(j.label)+'</b><div class="muted">'+esc(j.name)+'</div></td><td>'+esc(j.kind)+'</td><td><span class="pill '+h+'">'+h+'</span>'+(j.consecutiveFailures>0?' <span class="err">×'+j.consecutiveFailures+'</span>':'')+'</td><td>'+fmt(j.lastRun)+'<div class="muted">'+ago(j.ageMs)+'</div></td><td>'+dur(j.lastDurationMs||0)+'</td><td>'+j.runs+' / '+(j.fails||0)+'</td><td>'+(j.lastError?'<span class="err">'+esc(j.lastError)+'</span>':'<span class="muted">—</span>')+'</td></tr>';
  }).join('')||'<tr><td colspan="7" class="muted">No jobs have reported yet.</td></tr>';
  document.getElementById('runs').innerHTML=(d.recent||[]).map(r=>'<tr><td class="muted">'+fmt(r.at)+'</td><td>'+esc(r.label||r.name)+'</td><td><span class="pill '+(r.ok?'ok':'fail')+'">'+(r.ok?'ok':'fail')+'</span></td><td>'+dur(r.durationMs||0)+'</td><td>'+(r.error?'<span class="err">'+esc(r.error)+'</span>':'<span class="muted">—</span>')+'</td></tr>').join('')||'<tr><td colspan="5" class="muted">No runs recorded yet.</td></tr>';
}
load();setInterval(load,15000);
</script></body></html>`);
});

// ── Errors page (backend + front-end) ──
router.get('/errors', (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Errors · sLab</title>
<style>
  body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:Inter,system-ui,sans-serif}
  header{padding:16px 24px;border-bottom:1px solid #222;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  header b{letter-spacing:.06em}header a{color:#888;text-decoration:none;font-size:.85rem}
  .wrap{max-width:1180px;margin:0 auto;padding:24px}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center}
  .filters input{background:#141414;border:1px solid #262626;color:#e5e5e5;padding:7px 10px;border-radius:6px;font:inherit;font-size:.85rem}
  .filters button{background:#3b82f6;border:none;color:#fff;padding:7px 14px;border-radius:6px;cursor:pointer;font-weight:600}
  .tab{padding:7px 14px;border:1px solid #262626;border-radius:6px;cursor:pointer;font-size:.82rem;background:#141414}
  .tab.active{background:#3b82f6;color:#fff;border-color:#3b82f6}
  .stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
  .stat{background:#141414;border:1px solid #262626;border-radius:8px;padding:10px 16px;font-size:.8rem}
  table{width:100%;border-collapse:collapse;background:#111;border:1px solid #222;border-radius:8px;overflow:hidden}
  th,td{text-align:left;padding:8px 12px;font-size:.82rem;border-bottom:1px solid #1d1d1d;vertical-align:top}
  th{color:#888;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em}
  .msg{color:#f0593f;font-weight:500}.muted{color:#777}.mono{font-family:ui-monospace,monospace;font-size:.74rem}
  details summary{cursor:pointer;color:#888;font-size:.72rem}pre{white-space:pre-wrap;color:#aaa;font-size:.72rem;margin:6px 0 0;max-height:220px;overflow:auto}
</style></head><body>
<header><b>sLab · ERRORS</b><a href="/superadmin/reports">← reports</a><a href="/superadmin/crons">crons</a><a href="/superadmin">dashboard</a></header>
<div class="wrap">
  <div class="filters">
    <div class="tab active" id="tab-server" onclick="setTab('server')">Backend</div>
    <div class="tab" id="tab-client" onclick="setTab('client')">Front-end</div>
    <input id="q" placeholder="search message / route…" onkeydown="if(event.key==='Enter')load()">
    <button onclick="load()">search</button>
  </div>
  <div class="stats" id="stats"></div>
  <div id="table"></div>
</div>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString():'—';
let tab='server',data={server:[],client:[],counts:{}};
function setTab(t){tab=t;document.getElementById('tab-server').classList.toggle('active',t==='server');document.getElementById('tab-client').classList.toggle('active',t==='client');render();}
function stack(s){return s?'<details><summary>stack</summary><pre>'+esc(s)+'</pre></details>':'';}
function render(){
  document.getElementById('stats').innerHTML='<div class="stat">Backend (24h): <b>'+(data.counts.serverToday||0)+'</b></div><div class="stat">Front-end (24h): <b>'+(data.counts.clientToday||0)+'</b></div>';
  if(tab==='server'){
    document.getElementById('table').innerHTML='<table><thead><tr><th>When</th><th>Kind</th><th>Message</th><th>Route</th><th>Tenant</th></tr></thead><tbody>'+((data.server||[]).map(e=>'<tr><td class="muted">'+fmt(e.at)+'</td><td>'+esc(e.kind||'')+'</td><td><span class="msg">'+esc(e.message)+'</span>'+stack(e.stack)+'</td><td class="mono">'+esc((e.method||'')+' '+(e.route||''))+'</td><td class="muted">'+esc(e.tenantDomain||'—')+'</td></tr>').join('')||'<tr><td colspan="5" class="muted">No backend errors.</td></tr>')+'</tbody></table>';
  }else{
    document.getElementById('table').innerHTML='<table><thead><tr><th>When</th><th>Kind</th><th>Message</th><th>Source</th><th>Page</th></tr></thead><tbody>'+((data.client||[]).map(e=>'<tr><td class="muted">'+fmt(e.at)+'</td><td>'+esc(e.kind||'')+'</td><td><span class="msg">'+esc(e.message)+'</span>'+stack(e.stack)+'</td><td class="mono">'+esc((e.source||'')+(e.line?(':'+e.line):''))+'</td><td class="mono muted">'+esc(e.url||'')+'</td></tr>').join('')||'<tr><td colspan="5" class="muted">No front-end errors.</td></tr>')+'</tbody></table>';
  }
}
async function load(){const q=document.getElementById('q').value.trim();data=await (await fetch('/superadmin/api/errors?q='+encodeURIComponent(q))).json();render();}
load();setInterval(load,20000);
</script></body></html>`);
});

export default router;
