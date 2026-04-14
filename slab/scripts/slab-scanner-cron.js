#!/usr/bin/env node
// slab-scanner-cron.js — Consolidated scan + report script
//
// Modes:
//   --scan     Run all 6 scanner modules, save results + tickets (every 6h)
//   --report   Email consolidated report with scan + Ollama health (every 24h)
//   --full     Both: scan then email (for testing)
//
// Ticket deduplication: findings with existing open/escalated ticket are skipped.

import { config } from '../config/config.js';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { runScan, findingsToTickets } from '../plugins/scanner.js';
import nodemailer from 'nodemailer';
import https from 'https';

const TO = 'scott@madladslab.com';
// Use internal LB directly when running on-server to avoid Apache/evasive
const OLLAMA_HEALTH_URL_INTERNAL = 'http://localhost:11400/health';
const OLLAMA_HEALTH_URL_EXTERNAL = 'https://ollama.madladslab.com/health';
// Try internal first (faster, no TLS, no rate limiting), fall back to external
const OLLAMA_HEALTH_URL = OLLAMA_HEALTH_URL_INTERNAL;

// ── Ollama health fetcher ───────────────────────────────────────────────────

async function fetchOllamaHealth() {
  const ollamaKey = config.OLLAMA_KEY || process.env.OLLAMA_KEY || '';
  const headers = {};
  if (ollamaKey) headers['Authorization'] = `Bearer ${ollamaKey}`;

  const r = await fetch(OLLAMA_HEALTH_URL, {
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} — ${body.slice(0, 120).replace(/<[^>]+>/g, '').trim() || 'no body'}`);
  }

  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON (status ${r.status}) — ${text.slice(0, 120).replace(/<[^>]+>/g, '').trim()}`);
  }
}

function statusIcon(s) { return s === 'up' ? '✅' : '🔴'; }

function buildOllamaHtml(h, fetchError) {
  if (fetchError) {
    return `
    <div style="border:2px solid #dc2626;border-radius:8px;padding:16px;margin:16px 0;">
      <h3 style="color:#dc2626;margin-top:0;">🔴 Ollama Health — Unreachable</h3>
      <p style="color:#666;">${fetchError}</p>
    </div>`;
  }

  const gpuRows = (h.gpus || []).map(g =>
    `<tr><td style="padding:6px 10px;">GPU ${g.gpu} (port ${g.port})</td><td style="padding:6px 10px;">${statusIcon(g.status)} ${g.status}</td><td style="padding:6px 10px;">${g.activeRequests || 0}</td><td style="padding:6px 10px;">${g.cold ? '❄️ cold' : 'warm'}</td></tr>`
  ).join('');

  return `
  <div style="border:2px solid #6366f1;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="color:#1C2B4A;margin-top:0;">Ollama Health</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#f0f0f0;"><th style="text-align:left;padding:6px 10px;">Component</th><th style="text-align:left;padding:6px 10px;">Status</th></tr>
      <tr><td style="padding:6px 10px;">Overall</td><td style="padding:6px 10px;">${statusIcon(h.status === 'ok' ? 'up' : 'down')} ${h.status || 'unknown'}</td></tr>
      <tr><td style="padding:6px 10px;">Tunnel</td><td style="padding:6px 10px;">${statusIcon(h.tunnel?.status)} ${h.tunnel?.status || 'unknown'}</td></tr>
      <tr><td style="padding:6px 10px;">Load Balancer</td><td style="padding:6px 10px;">${statusIcon(h.lb?.status)} ${h.lb?.status || 'unknown'}</td></tr>
      <tr><td style="padding:6px 10px;">Stable Diffusion</td><td style="padding:6px 10px;">${statusIcon(h.sd?.status)} ${h.sd?.status || 'unknown'}</td></tr>
    </table>
    ${(h.gpus || []).length > 0 ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;">
      <tr style="background:#f0f0f0;"><th style="text-align:left;padding:6px 10px;">GPU</th><th style="text-align:left;padding:6px 10px;">Status</th><th style="text-align:left;padding:6px 10px;">Active</th><th style="text-align:left;padding:6px 10px;">Temp</th></tr>
      ${gpuRows}
    </table>` : ''}
  </div>`;
}

// ── Scan all tenants ────────────────────────────────────────────────────────

async function scanAllTenants() {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] } })
    .toArray();

  console.log(`[scanner] Found ${tenants.length} tenant(s)`);
  const results = [];

  for (const tenant of tenants) {
    const label = tenant.brand?.name || tenant.domain;
    console.log(`[scanner] Scanning: ${label}`);

    try {
      const db = getTenantDb(tenant.db);
      const result = await runScan({
        tenant,
        adminCookie: '',
        modules: ['contrast', 'modals', 'modules', 'redundancy', 'security', 'routes', 'admin'],
        pages: ['/', '/admin/login'],
        db,
      });

      // Save to DB
      await db.collection('scan_results').insertOne({
        ...result,
        runBy: 'slab-scanner-cron',
        createdAt: new Date(),
      });

      // Create tickets (with deduplication)
      const tickets = await findingsToTickets(db, result.findings, tenant);
      const skipped = tickets.skipped || 0;
      console.log(`[scanner] ${label}: ${result.summary.total} findings, ${tickets.length} new tickets, ${skipped} skipped (dupes)`);

      results.push({ tenant: label, domain: tenant.domain, db: tenant.db, ...result, newTickets: tickets.length, skippedTickets: skipped });
    } catch (err) {
      console.error(`[scanner] ${label} ERROR:`, err.message);
      results.push({ tenant: label, domain: tenant.domain, error: err.message });
    }
  }

  return results;
}

// ── Build email HTML ────────────────────────────────────────────────────────

function buildReportHtml(scanResults, ollamaHtml) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  let html = `
  <div style="font-family:'Inter',system-ui,sans-serif;max-width:700px;margin:0 auto;padding:24px;">
    <h2 style="color:#1C2B4A;margin-bottom:4px;">Slab Platform Health Report</h2>
    <p style="color:#666;font-size:13px;margin-top:0;">${ts} ET</p>
    <hr style="border:none;border-top:2px solid #e5e7eb;margin:16px 0;">

    ${ollamaHtml}

    <h3 style="color:#1C2B4A;">Site Scanner Results</h3>`;

  let totalCritical = 0, totalHigh = 0, totalAll = 0, totalNew = 0, totalSkipped = 0;

  for (const r of scanResults) {
    if (r.error) {
      html += `
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:14px;margin:12px 0;">
        <strong>${r.tenant}</strong> — <span style="color:#dc2626;">Scan failed: ${r.error}</span>
      </div>`;
      continue;
    }

    const c = r.summary?.counts || {};
    totalCritical += c.critical || 0;
    totalHigh += c.high || 0;
    totalAll += r.summary?.total || 0;
    totalNew += r.newTickets || 0;
    totalSkipped += r.skippedTickets || 0;

    const borderColor = c.critical > 0 ? '#dc2626' : c.high > 0 ? '#ea580c' : '#16a34a';

    html += `
    <div style="border:2px solid ${borderColor};border-radius:8px;padding:16px;margin:14px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:15px;">${r.tenant}</strong>
        <span style="font-size:12px;color:#666;">${Math.round(r.summary.duration / 1000)}s</span>
      </div>
      <div style="margin:10px 0;display:flex;gap:10px;flex-wrap:wrap;">
        ${c.critical ? `<span style="background:#fef2f2;color:#dc2626;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:700;">${c.critical} critical</span>` : ''}
        ${c.high ? `<span style="background:#fff7ed;color:#ea580c;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:600;">${c.high} high</span>` : ''}
        ${c.medium ? `<span style="background:#fefce8;color:#ca8a04;padding:3px 8px;border-radius:4px;font-size:12px;">${c.medium} med</span>` : ''}
        ${c.low ? `<span style="background:#eff6ff;color:#2563eb;padding:3px 8px;border-radius:4px;font-size:12px;">${c.low} low</span>` : ''}
        ${r.summary.total === 0 ? `<span style="background:#f0fdf4;color:#16a34a;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:600;">ALL CLEAR</span>` : ''}
      </div>
      <div style="font-size:12px;color:#666;">
        ${r.newTickets || 0} new ticket(s)${r.skippedTickets ? ` | ${r.skippedTickets} skipped (already open)` : ''}
      </div>`;

    // Top critical/high findings
    const topFindings = (r.findings || []).filter(f => f.severity === 'critical' || f.severity === 'high').slice(0, 8);
    if (topFindings.length > 0) {
      html += `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px;">`;
      for (const f of topFindings) {
        const icon = f.severity === 'critical' ? '🔴' : '🟠';
        html += `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:3px 6px;width:24px;">${icon}</td>
          <td style="padding:3px 6px;font-weight:500;">${f.title}</td>
          <td style="padding:3px 6px;color:#888;max-width:250px;word-break:break-word;">${(f.detail || '').slice(0, 100)}</td>
        </tr>`;
      }
      html += `</table>`;
    }
    html += `</div>`;
  }

  // Grand total
  const totalColor = totalCritical > 0 ? '#dc2626' : totalHigh > 0 ? '#ea580c' : '#16a34a';
  html += `
    <div style="background:#f9fafb;border:2px solid ${totalColor};border-radius:8px;padding:14px;margin-top:20px;text-align:center;">
      <div style="font-weight:700;font-size:15px;color:${totalColor};">
        ${totalAll === 0 ? 'All Clear' : `${totalAll} Findings | ${totalNew} New Tickets | ${totalSkipped} Skipped`}
      </div>
      <div style="font-size:12px;color:#666;margin-top:4px;">
        ${totalCritical} critical | ${totalHigh} high | ${totalAll - totalCritical - totalHigh} other
      </div>
    </div>
  </div>`;

  return { html, totalCritical, totalHigh, totalAll, totalNew };
}

// ── Email sender ────────────────────────────────────────────────────────────

async function sendEmail(subject, html) {
  // Always use the platform account — load slab .env explicitly to ensure correct creds
  const dotenv = await import('dotenv');
  dotenv.config({ path: '/srv/slab/.env', override: true });

  const zohoUser = process.env.ZOHO_USER;
  const zohoPass = process.env.ZOHO_PASS;

  if (!zohoUser || !zohoPass) throw new Error('Missing ZOHO_USER/ZOHO_PASS in /srv/slab/.env');

  const transporter = nodemailer.createTransport({
    host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
    auth: { user: zohoUser, pass: zohoPass },
  });

  await transporter.sendMail({
    from: `"MadLadsLab Platform" <${zohoUser}>`,
    to: TO,
    subject,
    html,
  });
  console.log(`[scanner] Email sent from ${zohoUser}: ${subject}`);
}

// ── Modes ───────────────────────────────────────────────────────────────────

async function doScan() {
  console.log('[scanner] === SCAN MODE ===');
  const results = await scanAllTenants();
  console.log(`[scanner] Scan complete: ${results.length} tenants`);
  return results;
}

async function doReport(scanResults) {
  console.log('[scanner] === REPORT MODE ===');

  // If no scan results passed, load latest from DB
  if (!scanResults) {
    const slab = getSlabDb();
    const tenants = await slab.collection('tenants')
      .find({ status: { $in: ['active', 'preview'] } }).toArray();

    scanResults = [];
    for (const t of tenants) {
      const db = getTenantDb(t.db);
      const latest = await db.collection('scan_results')
        .find({}).sort({ 'summary.scannedAt': -1 }).limit(1).toArray();
      if (latest.length) {
        scanResults.push({
          tenant: t.brand?.name || t.domain,
          domain: t.domain,
          ...latest[0],
          newTickets: 0,
          skippedTickets: 0,
        });
      }
    }
  }

  // Fetch Ollama health
  let ollamaHtml;
  try {
    const h = await fetchOllamaHealth();
    ollamaHtml = buildOllamaHtml(h, null);
  } catch (err) {
    ollamaHtml = buildOllamaHtml(null, err.message);
  }

  const { html, totalCritical, totalHigh, totalAll, totalNew } = buildReportHtml(scanResults, ollamaHtml);

  const subject = totalCritical > 0
    ? `🔴 Slab Health Report — ${totalCritical} CRITICAL`
    : totalHigh > 0
    ? `🟠 Slab Health Report — ${totalHigh} HIGH findings`
    : totalAll > 0
    ? `🟡 Slab Health Report — ${totalAll} findings${totalNew > 0 ? `, ${totalNew} new tickets` : ''}`
    : `✅ Slab Health Report — All Clear`;

  await sendEmail(subject, html);
}

// ── Main ────────────────────────────────────────────────────────────────────

const mode = process.argv[2];

async function main() {
  await connectDB();

  if (mode === '--scan') {
    await doScan();
  } else if (mode === '--report') {
    await doReport();
  } else if (mode === '--full') {
    const results = await doScan();
    await doReport(results);
  } else {
    console.error('Usage: node slab-scanner-cron.js --scan|--report|--full');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[scanner] Fatal:', err);
  process.exit(1);
});
