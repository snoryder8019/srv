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

  // Watchdog
  const wd = h.watchdog || {};
  const wdDown = !wd.lastRun || wd.lastRun === null;
  if (wdDown)
    issues.push({ component: 'Watchdog', status: 'no recent run' });

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
      <tr><td style="padding:8px;">Watchdog</td><td style="padding:8px;">${h.watchdog?.lastRun ? '✅ last: ' + h.watchdog.lastRun : '🔴 no recent run'}</td></tr>
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

  const allGood = issues.length === 0;
  const subject = allGood
    ? '✅ Ollama Health Report — All Systems OK'
    : `⚠️ Ollama Health Report — ${issues.length} issue(s)`;

  await sendEmail(subject, buildSummaryHtml(h, issues));
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
