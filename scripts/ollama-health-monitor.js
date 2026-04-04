#!/usr/bin/env node
/**
 * ollama-health-monitor.js
 *
 * Modes:
 *   --report   6-hour status summary email
 *   --alert    30-min urgent check — emails only when something is down
 */

const https = require('https');
const nodemailer = require('/srv/madladslab/node_modules/nodemailer');
require('/srv/madladslab/node_modules/dotenv').config({ path: '/srv/madladslab/.env' });
require('/srv/madladslab/node_modules/dotenv').config({ path: '/srv/slab/.env' }); // picks up SLAB_DB if missing

const { MongoClient } = require('/srv/madladslab/node_modules/mongodb');

const HEALTH_URL = 'https://ollama.madladslab.com/health';
const TO = 'scott@madladslab.com';
const FROM = process.env.ZOHO_USER;

function getTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
  });
}

function fetchHealth() {
  return new Promise((resolve, reject) => {
    const req = https.get(HEALTH_URL, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Bad JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function statusIcon(s) { return s === 'up' ? '✅' : '🔴'; }

function evaluateHealth(h) {
  const issues = [];

  // Tunnel
  if (!h.tunnel || h.tunnel.status !== 'up')
    issues.push({ component: 'Tunnel', status: h.tunnel?.status || 'unknown' });

  // LLMs (GPUs) — flag if ALL are down or none present
  const gpus = h.gpus || [];
  const gpusUp = gpus.filter(g => g.status === 'up');
  if (gpus.length === 0 || gpusUp.length === 0)
    issues.push({ component: 'LLMs (all GPUs)', status: 'down' });
  else {
    // also flag individual down GPUs
    gpus.filter(g => g.status !== 'up').forEach(g => {
      issues.push({ component: `GPU ${g.gpu}`, status: g.status || 'down' });
    });
  }

  // SD
  if (!h.sd || h.sd.status !== 'up')
    issues.push({ component: 'Stable Diffusion', status: h.sd?.status || 'unknown' });

  // Watchdog — removed: not running is expected / normal state

  return issues;
}

function buildSummaryHtml(h, issues) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const gpuRows = (h.gpus || []).map(g =>
    `<tr><td>GPU ${g.gpu} (port ${g.port})</td><td>${statusIcon(g.status)} ${g.status}</td><td>${g.activeRequests}</td></tr>`
  ).join('');

  return `
  <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
    <h2 style="color:#1a1a2e;">Ollama Health Report</h2>
    <p style="color:#666;">${ts} ET</p>

    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr style="background:#f0f0f0;"><th style="text-align:left;padding:8px;">Component</th><th style="text-align:left;padding:8px;">Status</th></tr>
      <tr><td style="padding:8px;">Overall</td><td style="padding:8px;">${statusIcon(h.status === 'ok' ? 'up' : 'down')} ${h.status || 'unknown'}</td></tr>
      <tr><td style="padding:8px;">Tunnel</td><td style="padding:8px;">${statusIcon(h.tunnel?.status)} ${h.tunnel?.status || 'unknown'}</td></tr>
      <tr><td style="padding:8px;">Load Balancer</td><td style="padding:8px;">${statusIcon(h.lb?.status)} ${h.lb?.status || 'unknown'} (port ${h.lb?.port || '?'})</td></tr>
      <tr><td style="padding:8px;">Stable Diffusion</td><td style="padding:8px;">${statusIcon(h.sd?.status)} ${h.sd?.status || 'unknown'} (port ${h.sd?.port || '?'})</td></tr>
      <tr><td style="padding:8px;">Watchdog</td><td style="padding:8px;">N/A (retired)</td></tr>
    </table>

    <h3>GPU Status</h3>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr style="background:#f0f0f0;"><th style="text-align:left;padding:8px;">GPU</th><th style="text-align:left;padding:8px;">Status</th><th style="text-align:left;padding:8px;">Active Reqs</th></tr>
      ${gpuRows || '<tr><td colspan="3" style="padding:8px;">No GPUs reported</td></tr>'}
    </table>

    ${issues.length > 0 ? `
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px;margin:16px 0;">
      <strong>⚠️ Issues Detected:</strong>
      <ul>${issues.map(i => `<li><strong>${i.component}</strong>: ${i.status}</li>`).join('')}</ul>
    </div>` : '<p style="color:green;font-weight:bold;">All systems operational.</p>'}
  </div>`;
}

function buildUrgentHtml(issues, h, fetchError) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const issueList = issues.map(i => `<li><strong>${i.component}</strong>: ${i.status}</li>`).join('');

  return `
  <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;border:3px solid #dc3545;border-radius:8px;">
    <h2 style="color:#dc3545;">🚨 URGENT: Ollama Service Alert</h2>
    <p style="color:#666;">${ts} ET</p>
    ${fetchError ? `<p style="color:#dc3545;font-weight:bold;">Health endpoint unreachable: ${fetchError}</p>` : ''}
    <div style="background:#f8d7da;border:1px solid #dc3545;border-radius:6px;padding:12px;margin:16px 0;">
      <strong>Components DOWN:</strong>
      <ul>${issueList}</ul>
    </div>
    <p style="color:#666;font-size:12px;">This alert repeats every 30 minutes while issues persist.</p>
  </div>`;
}

async function sendEmail(subject, html) {
  const t = getTransporter();
  await t.sendMail({ from: FROM, to: TO, subject, html });
  console.log(`Email sent: ${subject}`);
}

// ── Scan report fetcher ─────────────────────────────────────────────────────
async function fetchLatestScanReport() {
  if (!process.env.DB_URL) return null;
  let client;
  try {
    client = new MongoClient(process.env.DB_URL);
    await client.connect();
    // Check all tenant DBs for recent scan results (last 24h)
    const slab = client.db(process.env.SLAB_DB || 'slab');
    const tenants = await slab.collection('tenants').find({ status: { $in: ['active', 'preview'] } }).toArray();

    const allScans = [];
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const t of tenants) {
      try {
        const tdb = client.db(t.db);
        const scans = await tdb.collection('scan_results')
          .find({ 'summary.scannedAt': { $gte: cutoff } })
          .sort({ 'summary.scannedAt': -1 })
          .limit(1)
          .toArray();
        if (scans.length > 0) {
          allScans.push({ tenant: t.brand?.name || t.domain, ...scans[0] });
        }
      } catch { /* skip */ }
    }
    return allScans;
  } catch (e) {
    console.error('Scan report fetch error:', e.message);
    return null;
  } finally {
    if (client) await client.close();
  }
}

function buildScanReportHtml(scans) {
  if (!scans || scans.length === 0) return '';

  let html = `
  <div style="margin-top:24px;border-top:2px solid #e5e7eb;padding-top:20px;">
    <h3 style="color:#1a1a2e;">Site Scanner Report (last 24h)</h3>`;

  for (const scan of scans) {
    const c = scan.summary?.counts || {};
    const total = scan.summary?.total || 0;
    const badgeColor = c.critical > 0 ? '#dc2626' : c.high > 0 ? '#ea580c' : '#16a34a';

    html += `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px;margin:10px 0;">
      <div style="font-weight:600;font-size:14px;">${scan.tenant}</div>
      <div style="font-size:12px;color:#666;margin-top:4px;">
        Scanned: ${scan.summary?.scannedAt ? new Date(scan.summary.scannedAt).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'unknown'} |
        Duration: ${scan.summary?.duration ? Math.round(scan.summary.duration / 1000) + 's' : '?'}
      </div>
      <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;">
        <span style="font-size:12px;"><strong style="color:${badgeColor};">${total}</strong> total</span>
        ${c.critical ? `<span style="font-size:12px;color:#dc2626;font-weight:600;">${c.critical} critical</span>` : ''}
        ${c.high ? `<span style="font-size:12px;color:#ea580c;">${c.high} high</span>` : ''}
        ${c.medium ? `<span style="font-size:12px;color:#ca8a04;">${c.medium} medium</span>` : ''}
        ${c.low ? `<span style="font-size:12px;color:#2563eb;">${c.low} low</span>` : ''}
      </div>`;

    // Show top critical/high findings inline
    const topFindings = (scan.findings || []).filter(f => f.severity === 'critical' || f.severity === 'high').slice(0, 5);
    if (topFindings.length > 0) {
      html += `<div style="margin-top:8px;font-size:11px;"><strong>Top issues:</strong><ul style="margin:4px 0;padding-left:16px;">`;
      for (const f of topFindings) {
        const icon = f.severity === 'critical' ? '🔴' : '🟠';
        html += `<li>${icon} ${f.title}</li>`;
      }
      html += `</ul></div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

async function runReport() {
  let h, issues = [], fetchError = null;
  try {
    h = await fetchHealth();
    issues = evaluateHealth(h);
  } catch (e) {
    fetchError = e.message;
    h = {};
    issues = [{ component: 'Health Endpoint', status: 'unreachable: ' + e.message }];
  }

  // Fetch latest scan reports to attach
  const scans = await fetchLatestScanReport();
  const scanHtml = buildScanReportHtml(scans);

  const allGood = issues.length === 0;
  const hasScanIssues = scans && scans.some(s => (s.summary?.counts?.critical || 0) > 0 || (s.summary?.counts?.high || 0) > 0);
  const subject = allGood && !hasScanIssues
    ? '✅ Ollama Health Report — All Systems OK'
    : allGood && hasScanIssues
    ? `⚠️ Ollama Health Report — OK + Scanner Findings`
    : `⚠️ Ollama Health Report — ${issues.length} issue(s)`;

  await sendEmail(subject, buildSummaryHtml(h, issues) + scanHtml);
}

async function runAlert() {
  let h, issues = [], fetchError = null;
  try {
    h = await fetchHealth();
    issues = evaluateHealth(h);
  } catch (e) {
    fetchError = e.message;
    issues = [{ component: 'Health Endpoint', status: 'unreachable: ' + e.message }];
  }

  if (issues.length === 0) {
    console.log('All clear — no alert email needed.');
    return;
  }

  const subject = `🚨 URGENT: Ollama — ${issues.map(i => i.component).join(', ')} DOWN`;
  await sendEmail(subject, buildUrgentHtml(issues, h, fetchError));
}

// Main
const mode = process.argv[2];
if (mode === '--report') {
  runReport().catch(e => { console.error('Report failed:', e); process.exit(1); });
} else if (mode === '--alert') {
  runAlert().catch(e => { console.error('Alert failed:', e); process.exit(1); });
} else {
  console.error('Usage: node ollama-health-monitor.js --report|--alert');
  process.exit(1);
}
