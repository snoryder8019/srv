#!/usr/bin/env node
/**
 * Full scanner test — runs all 6 modules against all active tenants,
 * saves results to DB, and emails a consolidated report.
 *
 * Usage: node scripts/run-scan-test.js
 */

import { config } from '../config/config.js';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { runScan, findingsToTickets } from '../plugins/scanner.js';
import nodemailer from 'nodemailer';

const TO = 'scott@madladslab.com';

async function main() {
  console.log('=== Slab Site Scanner — Full Test ===\n');

  await connectDB();
  const slab = getSlabDb();

  const tenants = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] } })
    .toArray();

  console.log(`Found ${tenants.length} active tenant(s)\n`);

  const allResults = [];

  for (const tenant of tenants) {
    const label = tenant.brand?.name || tenant.domain;
    console.log(`\n── Scanning: ${label} (${tenant.domain}) ──`);

    try {
      const result = await runScan({
        tenant,
        adminCookie: '',  // no admin auth for this test — security scanner will test unauthed access
        modules: ['contrast', 'modals', 'modules', 'redundancy', 'security', 'routes'],
        pages: ['/', '/admin/login'],
      });

      console.log(`  Done in ${Math.round(result.summary.duration / 1000)}s — ${result.summary.total} findings`);
      console.log(`  Critical: ${result.summary.counts.critical}, High: ${result.summary.counts.high}, Medium: ${result.summary.counts.medium}, Low: ${result.summary.counts.low}`);

      // Save to tenant DB
      const db = getTenantDb(tenant.db);
      const doc = {
        ...result,
        runBy: 'scanner-test-script',
        createdAt: new Date(),
      };
      await db.collection('scan_results').insertOne(doc);
      console.log(`  Saved to ${tenant.db}.scan_results`);

      // Create tickets for critical/high
      const critHigh = result.findings.filter(f => f.severity === 'critical' || f.severity === 'high');
      if (critHigh.length > 0) {
        const tickets = await findingsToTickets(db, result.findings, tenant);
        console.log(`  Created ${tickets.length} ticket(s)`);
      }

      allResults.push({ tenant: label, domain: tenant.domain, ...result });
    } catch (err) {
      console.error(`  ERROR scanning ${label}:`, err.message);
      allResults.push({ tenant: label, domain: tenant.domain, error: err.message });
    }
  }

  // ── Build and send email ────────────────────────────────────────────────────
  console.log('\n── Sending email report ──');

  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  let html = `
  <div style="font-family:'Inter',system-ui,monospace;max-width:700px;margin:0 auto;padding:24px;">
    <h2 style="color:#1C2B4A;margin-bottom:4px;">Slab Site Scanner — Full Report</h2>
    <p style="color:#666;font-size:13px;margin-top:0;">${ts} ET | ${allResults.length} tenant(s) scanned</p>
    <hr style="border:none;border-top:2px solid #e5e7eb;margin:16px 0;">`;

  let totalCritical = 0, totalHigh = 0, totalAll = 0;

  for (const r of allResults) {
    if (r.error) {
      html += `
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:16px;margin:12px 0;">
        <div style="font-weight:700;font-size:15px;">${r.tenant}</div>
        <div style="font-size:12px;color:#dc2626;margin-top:4px;">Scan failed: ${r.error}</div>
      </div>`;
      continue;
    }

    const c = r.summary?.counts || {};
    totalCritical += c.critical || 0;
    totalHigh += c.high || 0;
    totalAll += r.summary?.total || 0;

    const borderColor = c.critical > 0 ? '#dc2626' : c.high > 0 ? '#ea580c' : '#16a34a';

    html += `
    <div style="border:2px solid ${borderColor};border-radius:8px;padding:16px;margin:16px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700;font-size:15px;">${r.tenant}</div>
        <div style="font-size:12px;color:#666;">https://${r.domain} | ${Math.round(r.summary.duration / 1000)}s</div>
      </div>

      <div style="display:flex;gap:16px;margin:12px 0;flex-wrap:wrap;">
        ${c.critical ? `<span style="background:#fef2f2;color:#dc2626;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;">${c.critical} CRITICAL</span>` : ''}
        ${c.high ? `<span style="background:#fff7ed;color:#ea580c;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;">${c.high} HIGH</span>` : ''}
        ${c.medium ? `<span style="background:#fefce8;color:#ca8a04;padding:4px 10px;border-radius:4px;font-size:12px;">${c.medium} MEDIUM</span>` : ''}
        ${c.low ? `<span style="background:#eff6ff;color:#2563eb;padding:4px 10px;border-radius:4px;font-size:12px;">${c.low} LOW</span>` : ''}
        ${r.summary.total === 0 ? `<span style="background:#f0fdf4;color:#16a34a;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;">ALL CLEAR</span>` : ''}
      </div>`;

    // Show all findings grouped by severity
    const bySev = {};
    for (const f of (r.findings || [])) {
      if (!bySev[f.severity]) bySev[f.severity] = [];
      bySev[f.severity].push(f);
    }

    for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
      const items = bySev[sev];
      if (!items) continue;

      const colors = { critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#2563eb', info: '#16a34a' };
      const icons = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '🟢' };

      html += `<div style="margin-top:10px;"><strong style="color:${colors[sev]};font-size:12px;text-transform:uppercase;">${icons[sev]} ${sev} (${items.length})</strong>`;
      html += `<table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:12px;">`;

      for (const f of items.slice(0, 20)) {
        html += `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:4px 8px;font-weight:500;width:40%;vertical-align:top;">${f.title}</td>
          <td style="padding:4px 8px;color:#666;word-break:break-word;">${f.detail?.slice(0, 150) || ''}</td>
        </tr>`;
      }
      if (items.length > 20) {
        html += `<tr><td colspan="2" style="padding:4px 8px;color:#999;font-style:italic;">...and ${items.length - 20} more</td></tr>`;
      }
      html += `</table></div>`;
    }

    html += `</div>`;
  }

  // Summary bar
  const summaryColor = totalCritical > 0 ? '#dc2626' : totalHigh > 0 ? '#ea580c' : '#16a34a';
  html += `
    <div style="background:#f9fafb;border:2px solid ${summaryColor};border-radius:8px;padding:16px;margin-top:20px;text-align:center;">
      <div style="font-weight:700;font-size:16px;color:${summaryColor};">
        ${totalAll === 0 ? 'All Clear — No Issues Found' : `${totalAll} Total Finding${totalAll > 1 ? 's' : ''}`}
      </div>
      <div style="font-size:13px;color:#666;margin-top:4px;">
        ${totalCritical} critical | ${totalHigh} high | ${totalAll - totalCritical - totalHigh} other
      </div>
    </div>
  </div>`;

  // Send email
  try {
    const zohoUser = process.env.ZOHO_USER;
    const zohoPass = process.env.ZOHO_PASS;
    if (!zohoUser || !zohoPass) {
      console.error('  Missing ZOHO_USER/ZOHO_PASS �� checking madladslab .env');
      const dotenv = await import('dotenv');
      dotenv.config({ path: '/srv/madladslab/.env' });
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });

    const subjectLine = totalCritical > 0
      ? `🔴 Scanner Report — ${totalCritical} CRITICAL findings`
      : totalHigh > 0
      ? `🟠 Scanner Report — ${totalHigh} HIGH findings`
      : totalAll > 0
      ? `🟡 Scanner Report — ${totalAll} findings`
      : `✅ Scanner Report — All Clear`;

    await transporter.sendMail({
      from: process.env.ZOHO_USER,
      to: TO,
      subject: subjectLine,
      html,
    });

    console.log(`  Email sent to ${TO}: ${subjectLine}`);
  } catch (err) {
    console.error('  Email send failed:', err.message);
  }

  console.log('\n=== Scan complete ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
