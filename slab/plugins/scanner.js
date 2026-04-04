/**
 * Slab — Site Scanner Engine
 *
 * Puppeteer-based scanner with 6 modules:
 *   1. Contrast   — WCAG AA color contrast audit on rendered pages
 *   2. Modals     — verify modals open/close, no dead triggers
 *   3. Modules    — check page sections/components render without errors
 *   4. Redundancy — duplicate IDs, broken links, dead elements
 *   5. Security   — brute force detection, auth bypass, exposed endpoints
 *   6. Routes     — HTTP health check on all routes/EPs/MCP/Ollama
 *
 * Each module returns an array of findings: { severity, title, detail, url }
 * severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
 */

import puppeteer from 'puppeteer';
import { config } from '../config/config.js';
import { getSlabDb } from './mongo.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function baseUrl(tenant) {
  const domain = tenant?.domain;
  if (!domain) return `http://localhost:${config.PORT}`;
  return `https://${domain}`;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
}

// ── 1. Contrast Scanner ─────────────────────────────────────────────────────

async function scanContrast(page, url) {
  const findings = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    const issues = await page.evaluate(() => {
      const results = [];

      function luminance(r, g, b) {
        const [rs, gs, bs] = [r, g, b].map(c => {
          c /= 255;
          return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      }

      function contrast(rgb1, rgb2) {
        const l1 = luminance(rgb1[0], rgb1[1], rgb1[2]);
        const l2 = luminance(rgb2[0], rgb2[1], rgb2[2]);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
      }

      function parseColor(str) {
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return null;
        return [+m[1], +m[2], +m[3]];
      }

      const els = document.querySelectorAll('body *');
      for (const el of els) {
        const text = el.textContent?.trim();
        if (!text || text.length > 200) continue;
        // Skip hidden/empty elements
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const fg = parseColor(style.color);
        const bg = parseColor(style.backgroundColor);
        if (!fg || !bg) continue;
        // Skip transparent backgrounds (alpha check via rgba)
        if (style.backgroundColor.includes('0)')) continue;

        const ratio = contrast(fg, bg);
        const fontSize = parseFloat(style.fontSize);
        const isBold = parseInt(style.fontWeight) >= 700 || style.fontWeight === 'bold';
        const isLarge = fontSize >= 18 || (fontSize >= 14 && isBold);
        const threshold = isLarge ? 3 : 4.5;

        if (ratio < threshold) {
          results.push({
            tag: el.tagName.toLowerCase(),
            text: text.slice(0, 60),
            fg: style.color,
            bg: style.backgroundColor,
            ratio: Math.round(ratio * 100) / 100,
            needed: threshold,
            selector: el.id ? `#${el.id}` : el.className ? `.${el.className.split(' ')[0]}` : el.tagName.toLowerCase(),
          });
        }
      }
      // Dedupe by selector, keep worst ratio
      const map = new Map();
      for (const r of results) {
        const key = r.selector;
        if (!map.has(key) || map.get(key).ratio > r.ratio) map.set(key, r);
      }
      return [...map.values()].slice(0, 50);
    });

    for (const issue of issues) {
      findings.push({
        severity: issue.ratio < 2 ? 'critical' : issue.ratio < 3 ? 'high' : 'medium',
        title: `Low contrast: ${issue.tag} "${issue.text}"`,
        detail: `Ratio ${issue.ratio}:1 (need ${issue.needed}:1) — fg: ${issue.fg}, bg: ${issue.bg} — selector: ${issue.selector}`,
        url,
      });
    }
  } catch (err) {
    findings.push({ severity: 'high', title: 'Contrast scan failed', detail: err.message, url });
  }
  return findings;
}

// ── 2. Modal Scanner ────────────────────────────────────────────────────────

async function scanModals(page, url) {
  const findings = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    const modalIssues = await page.evaluate(() => {
      const results = [];
      // Find all modal triggers (buttons/links with data-bs-toggle="modal", data-toggle="modal", onclick with modal)
      const triggers = document.querySelectorAll(
        '[data-bs-toggle="modal"], [data-toggle="modal"], [data-modal], [onclick*="modal"], [onclick*="Modal"]'
      );

      for (const trigger of triggers) {
        const targetId = trigger.getAttribute('data-bs-target') ||
                         trigger.getAttribute('data-target') ||
                         trigger.getAttribute('href');
        const label = trigger.textContent?.trim().slice(0, 40) || trigger.getAttribute('aria-label') || 'unnamed';

        if (targetId && targetId.startsWith('#')) {
          const modal = document.querySelector(targetId);
          if (!modal) {
            results.push({ type: 'missing_target', trigger: label, target: targetId });
          } else {
            // Check modal has close mechanism
            const closeBtn = modal.querySelector('[data-bs-dismiss="modal"], [data-dismiss="modal"], .close, .btn-close');
            if (!closeBtn) {
              results.push({ type: 'no_close', trigger: label, target: targetId });
            }
            // Check modal has content
            const body = modal.querySelector('.modal-body');
            if (body && !body.textContent?.trim() && !body.querySelector('form, img, input')) {
              results.push({ type: 'empty_modal', trigger: label, target: targetId });
            }
          }
        }
      }

      // Find modals without triggers (orphaned)
      const allModals = document.querySelectorAll('.modal');
      for (const modal of allModals) {
        const id = modal.id;
        if (!id) {
          results.push({ type: 'no_id', trigger: 'n/a', target: modal.className });
          continue;
        }
        const hasTrigger = document.querySelector(`[data-bs-target="#${id}"], [data-target="#${id}"], [href="#${id}"]`);
        if (!hasTrigger) {
          results.push({ type: 'orphaned', trigger: 'none', target: `#${id}` });
        }
      }

      return results;
    });

    for (const issue of modalIssues) {
      const sevMap = { missing_target: 'critical', no_close: 'high', empty_modal: 'medium', no_id: 'medium', orphaned: 'low' };
      const titleMap = {
        missing_target: `Modal target missing: ${issue.target}`,
        no_close: `Modal has no close button: ${issue.target}`,
        empty_modal: `Empty modal body: ${issue.target}`,
        no_id: `Modal without ID: ${issue.target}`,
        orphaned: `Orphaned modal (no trigger): ${issue.target}`,
      };
      findings.push({
        severity: sevMap[issue.type] || 'medium',
        title: titleMap[issue.type],
        detail: `Trigger: "${issue.trigger}" → Target: ${issue.target}`,
        url,
      });
    }
  } catch (err) {
    findings.push({ severity: 'high', title: 'Modal scan failed', detail: err.message, url });
  }
  return findings;
}

// ── 3. Module/Component Scanner ─────────────────────────────────────────────

async function scanModules(page, url) {
  const findings = [];
  const consoleErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    if (!response || response.status() >= 400) {
      findings.push({
        severity: 'critical',
        title: `Page returned ${response?.status() || 'no response'}`,
        detail: `HTTP ${response?.status()} ${response?.statusText()}`,
        url,
      });
    }

    // Check for broken images
    const brokenImages = await page.evaluate(() => {
      return [...document.querySelectorAll('img')].filter(img => {
        return !img.complete || img.naturalWidth === 0;
      }).map(img => ({ src: img.src, alt: img.alt })).slice(0, 20);
    });

    for (const img of brokenImages) {
      findings.push({
        severity: 'medium',
        title: `Broken image: ${img.alt || 'no alt'}`,
        detail: `src: ${img.src}`,
        url,
      });
    }

    // Check for empty sections/containers
    const emptySections = await page.evaluate(() => {
      const sections = document.querySelectorAll('section, [class*="section"], .card-body, .container > div');
      return [...sections].filter(s => {
        const rect = s.getBoundingClientRect();
        return rect.height < 5 && s.children.length > 0;
      }).map(s => ({
        tag: s.tagName,
        id: s.id || '',
        cls: s.className?.split?.(' ')[0] || '',
      })).slice(0, 20);
    });

    for (const s of emptySections) {
      findings.push({
        severity: 'low',
        title: `Collapsed section: ${s.tag}`,
        detail: `id="${s.id}" class="${s.cls}" — may be rendering with 0 height`,
        url,
      });
    }

    // Console JS errors
    for (const err of consoleErrors.slice(0, 15)) {
      findings.push({
        severity: 'high',
        title: 'JS console error',
        detail: err.slice(0, 200),
        url,
      });
    }
  } catch (err) {
    findings.push({ severity: 'critical', title: 'Module scan failed', detail: err.message, url });
  }
  return findings;
}

// ── 4. Redundancy Scanner ───────────────────────────────────────────────────

async function scanRedundancy(page, url) {
  const findings = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    const issues = await page.evaluate(() => {
      const results = [];

      // Duplicate IDs
      const ids = {};
      document.querySelectorAll('[id]').forEach(el => {
        const id = el.id;
        ids[id] = (ids[id] || 0) + 1;
      });
      for (const [id, count] of Object.entries(ids)) {
        if (count > 1) results.push({ type: 'dup_id', detail: `#${id} appears ${count} times` });
      }

      // Broken internal links
      const links = document.querySelectorAll('a[href]');
      for (const a of links) {
        const href = a.getAttribute('href');
        // Anchor links that point nowhere
        if (href.startsWith('#') && href.length > 1) {
          if (!document.querySelector(href)) {
            results.push({ type: 'broken_anchor', detail: `${href} (text: "${a.textContent?.trim().slice(0, 30)}")` });
          }
        }
        // Empty hrefs
        if (href === '' || href === '#') {
          const text = a.textContent?.trim().slice(0, 30);
          if (text && text !== '#') {
            results.push({ type: 'empty_href', detail: `"${text}" has href="${href}"` });
          }
        }
      }

      // Duplicate class combinations on siblings (exact same element repeated)
      // This catches copy-paste redundancy
      const containers = document.querySelectorAll('.row, .list-group, ul, ol, .grid');
      for (const c of containers) {
        const seen = new Map();
        for (const child of c.children) {
          const key = child.tagName + '|' + child.className + '|' + (child.textContent?.trim().slice(0, 50) || '');
          seen.set(key, (seen.get(key) || 0) + 1);
        }
        for (const [key, count] of seen) {
          if (count > 2) {
            const parts = key.split('|');
            results.push({
              type: 'dup_element',
              detail: `${parts[0]} with class="${parts[1]}" repeated ${count}x (text: "${parts[2]?.slice(0, 30)}")`,
            });
          }
        }
      }

      return results.slice(0, 50);
    });

    const sevMap = { dup_id: 'high', broken_anchor: 'medium', empty_href: 'low', dup_element: 'low' };
    const titleMap = {
      dup_id: 'Duplicate ID',
      broken_anchor: 'Broken anchor link',
      empty_href: 'Empty href',
      dup_element: 'Duplicate element (possible copy-paste)',
    };

    for (const issue of issues) {
      findings.push({
        severity: sevMap[issue.type] || 'low',
        title: titleMap[issue.type],
        detail: issue.detail,
        url,
      });
    }
  } catch (err) {
    findings.push({ severity: 'high', title: 'Redundancy scan failed', detail: err.message, url });
  }
  return findings;
}

// ── 5. Security Scanner ─────────────────────────────────────────────────────

async function scanSecurity(base, adminCookie) {
  const findings = [];

  // ── 5a. Comprehensive Auth Gateway Testing ────────────────────────────────
  // Test every protected route at 3 auth levels: unauthenticated, regular admin, superadmin
  // Ensure each route properly enforces its required auth level.

  const authLevels = {
    none:  {},                                                    // no auth
    admin: adminCookie ? { 'Cookie': adminCookie } : {},          // admin JWT
  };

  // Routes that MUST require admin auth (should reject unauthenticated)
  const adminProtected = [
    { method: 'GET',  path: '/admin' },
    { method: 'GET',  path: '/admin/portfolio' },
    { method: 'GET',  path: '/admin/clients' },
    { method: 'GET',  path: '/admin/copy' },
    { method: 'GET',  path: '/admin/design' },
    { method: 'GET',  path: '/admin/blog' },
    { method: 'GET',  path: '/admin/pages' },
    { method: 'GET',  path: '/admin/sections' },
    { method: 'GET',  path: '/admin/assets' },
    { method: 'GET',  path: '/admin/meetings' },
    { method: 'GET',  path: '/admin/bookkeeping' },
    { method: 'GET',  path: '/admin/email-marketing' },
    { method: 'GET',  path: '/admin/users' },
    { method: 'GET',  path: '/admin/tickets' },
    { method: 'GET',  path: '/admin/settings' },
    { method: 'GET',  path: '/admin/profile' },
    { method: 'GET',  path: '/admin/docs' },
    { method: 'GET',  path: '/admin/huginn' },
    { method: 'GET',  path: '/admin/master-agent' },
    { method: 'GET',  path: '/admin/tts' },
    { method: 'GET',  path: '/admin/brand-builder' },
    { method: 'GET',  path: '/admin/onboarding' },
    { method: 'GET',  path: '/admin/ai-health' },
    { method: 'GET',  path: '/admin/api/my-slabs' },
    { method: 'POST', path: '/admin/master-agent/mcp' },
  ];

  // Routes that MUST require superadmin (should reject regular admin AND unauthed)
  const superadminProtected = [
    { method: 'GET',  path: '/admin/super' },
    { method: 'GET',  path: '/superadmin' },
    { method: 'GET',  path: '/superadmin/tenants' },
  ];

  // Routes that should be PUBLIC (login, register)
  const publicAllowed = [
    { method: 'GET', path: '/admin/login' },
    { method: 'GET', path: '/admin/register' },
    { method: 'GET', path: '/' },
  ];

  // Sensitive API endpoints that need auth
  const sensitiveApis = [
    { method: 'POST', path: '/api/tickets/debug-capture', desc: 'Debug capture (admin only)' },
    { method: 'GET',  path: '/api/tickets/mine', desc: 'List own tickets (auth required)' },
    { method: 'POST', path: '/admin/master-agent', desc: 'Master agent execute' },
    { method: 'POST', path: '/admin/master-agent/research', desc: 'Agent research' },
    { method: 'POST', path: '/admin/settings', desc: 'Save settings' },
    { method: 'POST', path: '/admin/users', desc: 'Create user' },
  ];

  // Helper: check if response indicates "blocked" (redirect to login, 401, 403)
  function isBlocked(status, body) {
    if (status === 302 || status === 301 || status === 401 || status === 403) return true;
    if (status === 200 && body && (body.includes('/admin/login') || body.includes('login') || body.includes('Authentication required'))) return true;
    return false;
  }

  // Test admin routes without auth — must be blocked
  for (const route of adminProtected) {
    try {
      const r = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: { 'Accept': 'text/html,application/json', ...authLevels.none },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        ...(route.method === 'POST' ? { body: '{}' } : {}),
      });
      const body = r.status === 200 ? await r.text() : '';
      if (!isBlocked(r.status, body)) {
        findings.push({
          severity: 'critical',
          title: `AUTH BYPASS (unauthed): ${route.method} ${route.path}`,
          detail: `No auth → ${r.status}. Expected redirect/401/403 but got accessible content.`,
          url: `${base}${route.path}`,
        });
      }
    } catch { /* timeout/network = protected */ }
  }

  // Test superadmin routes without auth — must be blocked
  for (const route of superadminProtected) {
    try {
      const r = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: { 'Accept': 'text/html,application/json', ...authLevels.none },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      const body = r.status === 200 ? await r.text() : '';
      if (!isBlocked(r.status, body)) {
        findings.push({
          severity: 'critical',
          title: `AUTH BYPASS (unauthed→super): ${route.method} ${route.path}`,
          detail: `No auth on superadmin route → ${r.status}. This is a critical exposure.`,
          url: `${base}${route.path}`,
        });
      }
    } catch { /* fine */ }
  }

  // Test superadmin routes WITH regular admin auth — should still be blocked
  if (adminCookie) {
    for (const route of superadminProtected) {
      try {
        const r = await fetch(`${base}${route.path}`, {
          method: route.method,
          headers: { 'Accept': 'text/html,application/json', ...authLevels.admin },
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
        });
        const body = r.status === 200 ? await r.text() : '';
        // If a regular admin can access superadmin routes, that's privilege escalation
        if (r.status === 200 && !body.includes('Access denied') && !body.includes('Superadmin') && body.length > 500) {
          findings.push({
            severity: 'critical',
            title: `PRIVILEGE ESCALATION: admin→superadmin ${route.path}`,
            detail: `Regular admin JWT accessed superadmin route → 200 with ${body.length} bytes content`,
            url: `${base}${route.path}`,
          });
        }
      } catch { /* fine */ }
    }
  }

  // Test sensitive API endpoints without auth
  for (const ep of sensitiveApis) {
    try {
      const opts = {
        method: ep.method,
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      };
      if (ep.method === 'POST') opts.body = JSON.stringify({ subject: 'test', description: 'test' });
      const r = await fetch(`${base}${ep.path}`, opts);
      if (r.status === 200) {
        const data = await r.text();
        if (!data.includes('error') && !data.includes('required') && !data.includes('denied')) {
          findings.push({
            severity: 'critical',
            title: `API auth bypass: ${ep.method} ${ep.path}`,
            detail: `${ep.desc} — accessible without auth → ${r.status}`,
            url: `${base}${ep.path}`,
          });
        }
      }
    } catch { /* fine */ }
  }

  // Test public routes ARE accessible (availability check)
  for (const route of publicAllowed) {
    try {
      const r = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: { 'Accept': 'text/html' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      if (r.status >= 500) {
        findings.push({
          severity: 'high',
          title: `Public route broken: ${route.path}`,
          detail: `Expected 200/302, got ${r.status}`,
          url: `${base}${route.path}`,
        });
      }
    } catch (err) {
      findings.push({
        severity: 'high',
        title: `Public route unreachable: ${route.path}`,
        detail: err.message,
        url: `${base}${route.path}`,
      });
    }
  }

  // ── 5b. Brute force — check if login has rate limiting ────────────────────
  try {
    const loginUrl = `${base}/admin/login`;
    const attempts = [];
    for (let i = 0; i < 8; i++) {
      const r = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'email=test@test.com&password=wrongpassword' + i,
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      attempts.push(r.status);
    }
    const allRedirects = attempts.every(s => s === 302 || s === 200);
    if (allRedirects) {
      findings.push({
        severity: 'high',
        title: 'No rate limiting on login',
        detail: `8 rapid login attempts all returned ${[...new Set(attempts)].join('/')} — no 429 or lockout detected. Vulnerable to brute force.`,
        url: loginUrl,
      });
    }
  } catch (err) {
    findings.push({ severity: 'low', title: 'Rate limit check failed', detail: err.message, url: `${base}/admin/login` });
  }

  // Also test registration endpoint for rate limiting
  try {
    const regUrl = `${base}/admin/register`;
    const attempts = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(regUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `email=fakebot${i}@test.com&password=Fake1234!@%23pass&password_confirm=Fake1234!@%23pass&displayName=bot`,
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      attempts.push(r.status);
    }
    const noBlock = attempts.every(s => s !== 429);
    if (noBlock) {
      findings.push({
        severity: 'medium',
        title: 'No rate limiting on registration',
        detail: `6 rapid registration attempts — no 429 detected. Possible spam vector.`,
        url: regUrl,
      });
    }
  } catch { /* fine */ }

  // ── 5c. Sensitive file exposure ───────────────────────────────────────────
  const sensitiveFiles = [
    { path: '/.env', desc: 'Environment file' },
    { path: '/config/config.js', desc: 'Config source' },
    { path: '/package.json', desc: 'Package manifest' },
    { path: '/.git/config', desc: 'Git config' },
    { path: '/.git/HEAD', desc: 'Git HEAD' },
    { path: '/node_modules/.package-lock.json', desc: 'Node modules lock' },
    { path: '/plugins/crypto.js', desc: 'Encryption source' },
    { path: '/middleware/jwtAuth.js', desc: 'JWT auth source' },
    { path: '/.ssh/authorized_keys', desc: 'SSH keys' },
    { path: '/app.js', desc: 'Application entry point source' },
  ];

  for (const ep of sensitiveFiles) {
    try {
      const r = await fetch(`${base}${ep.path}`, {
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
      });
      if (r.status === 200) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json') || ct.includes('javascript') || ct.includes('text/plain') || ct.includes('octet-stream')) {
          findings.push({
            severity: 'critical',
            title: `EXPOSED FILE: ${ep.desc}`,
            detail: `GET ${ep.path} → 200 (${ct}). Source code or secrets may be leaking.`,
            url: `${base}${ep.path}`,
          });
        }
      }
    } catch { /* fine */ }
  }

  // ── 5d. Security headers ──────────────────────────────────────────────────
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(5000) });
    const headers = Object.fromEntries(r.headers.entries());
    const missing = [];
    if (!headers['x-frame-options'] && !headers['content-security-policy']?.includes('frame-ancestors')) {
      missing.push('X-Frame-Options (clickjacking protection)');
    }
    if (!headers['x-content-type-options']) missing.push('X-Content-Type-Options');
    if (!headers['strict-transport-security']) missing.push('Strict-Transport-Security (HSTS)');
    if (!headers['x-xss-protection'] && !headers['content-security-policy']) {
      missing.push('XSS protection header');
    }

    if (missing.length > 0) {
      findings.push({
        severity: 'medium',
        title: `Missing security headers (${missing.length})`,
        detail: missing.join(', '),
        url: base,
      });
    }
  } catch { /* fine */ }

  // ── 5e. Cookie security ───────────────────────────────────────────────────
  try {
    const r = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=test@test.com&password=wrongpassword',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const cookies = r.headers.getSetCookie?.() || [];
    for (const c of cookies) {
      if (c.includes('slab_token') || c.includes('slab_portal') || c.includes('connect.sid')) {
        if (!c.includes('HttpOnly')) {
          findings.push({
            severity: 'high',
            title: `Cookie missing HttpOnly: ${c.split('=')[0]}`,
            detail: 'Session/auth cookies must be HttpOnly to prevent XSS theft',
            url: `${base}/admin/login`,
          });
        }
        if (!c.includes('Secure') && base.startsWith('https')) {
          findings.push({
            severity: 'high',
            title: `Cookie missing Secure flag: ${c.split('=')[0]}`,
            detail: 'Auth cookies on HTTPS must have Secure flag',
            url: `${base}/admin/login`,
          });
        }
        if (!c.includes('SameSite')) {
          findings.push({
            severity: 'medium',
            title: `Cookie missing SameSite: ${c.split('=')[0]}`,
            detail: 'SameSite attribute recommended for CSRF protection',
            url: `${base}/admin/login`,
          });
        }
      }
    }
  } catch { /* fine */ }

  return findings;
}

// ── 6. Route Health Scanner ─────────────────────────────────────────────────

async function scanRoutes(base, adminCookie) {
  const findings = [];

  // Public routes — should return 200 or 302
  const publicRoutes = [
    { method: 'GET', path: '/', expect: [200, 302] },
    { method: 'GET', path: '/admin/login', expect: [200] },
    { method: 'GET', path: '/admin/register', expect: [200] },
    { method: 'GET', path: '/auth/login', expect: [200, 302] },
  ];

  // Admin routes — need auth cookie
  const adminRoutes = [
    { method: 'GET', path: '/admin', expect: [200, 302] },
    { method: 'GET', path: '/admin/portfolio', expect: [200] },
    { method: 'GET', path: '/admin/clients', expect: [200] },
    { method: 'GET', path: '/admin/copy', expect: [200] },
    { method: 'GET', path: '/admin/design', expect: [200] },
    { method: 'GET', path: '/admin/blog', expect: [200] },
    { method: 'GET', path: '/admin/pages', expect: [200] },
    { method: 'GET', path: '/admin/sections', expect: [200] },
    { method: 'GET', path: '/admin/assets', expect: [200] },
    { method: 'GET', path: '/admin/meetings', expect: [200] },
    { method: 'GET', path: '/admin/bookkeeping', expect: [200] },
    { method: 'GET', path: '/admin/email-marketing', expect: [200] },
    { method: 'GET', path: '/admin/users', expect: [200] },
    { method: 'GET', path: '/admin/tickets', expect: [200] },
    { method: 'GET', path: '/admin/settings', expect: [200] },
    { method: 'GET', path: '/admin/docs', expect: [200] },
    { method: 'GET', path: '/admin/profile', expect: [200] },
    { method: 'GET', path: '/admin/huginn', expect: [200] },
    { method: 'GET', path: '/admin/brand-builder', expect: [200, 302] },
  ];

  // API routes
  const apiRoutes = [
    { method: 'GET', path: '/admin/ai-health', expect: [200], auth: true },
    { method: 'GET', path: '/admin/api/my-slabs', expect: [200], auth: true },
  ];

  async function checkRoute(route, useAuth) {
    try {
      const headers = { 'Accept': 'text/html,application/json' };
      if (useAuth && adminCookie) {
        headers['Cookie'] = adminCookie;
      }
      const r = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      if (!route.expect.includes(r.status)) {
        findings.push({
          severity: r.status >= 500 ? 'critical' : r.status === 404 ? 'high' : 'medium',
          title: `Route unhealthy: ${route.method} ${route.path}`,
          detail: `Expected ${route.expect.join('/')}, got ${r.status}`,
          url: `${base}${route.path}`,
        });
      }
    } catch (err) {
      findings.push({
        severity: 'critical',
        title: `Route unreachable: ${route.method} ${route.path}`,
        detail: err.message,
        url: `${base}${route.path}`,
      });
    }
  }

  // Run public routes (no auth)
  for (const r of publicRoutes) await checkRoute(r, false);
  // Run admin routes (with auth)
  for (const r of adminRoutes) await checkRoute(r, true);
  // Run API routes
  for (const r of apiRoutes) await checkRoute(r, true);

  // Ollama health check
  try {
    const ollamaBase = config.OLLAMA_URL.replace(/\/v1\/chat\/completions$/, '');
    const r = await fetch(`${ollamaBase}/health`, {
      headers: { 'Authorization': `Bearer ${config.OLLAMA_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      findings.push({
        severity: 'high',
        title: 'Ollama health check failed',
        detail: `GET /health → ${r.status}`,
        url: `${ollamaBase}/health`,
      });
    } else {
      const data = await r.json();
      const gpusUp = (data.gpus || []).filter(g => g.status === 'up');
      if (gpusUp.length === 0) {
        findings.push({
          severity: 'high',
          title: 'Ollama: no GPUs available',
          detail: `All GPUs down — ${JSON.stringify(data.gpus?.map(g => `${g.gpu}:${g.status}`))}`,
          url: `${ollamaBase}/health`,
        });
      }
      if (data.sd?.status !== 'up') {
        findings.push({
          severity: 'medium',
          title: 'Stable Diffusion unavailable',
          detail: `SD status: ${data.sd?.status || 'unknown'}`,
          url: `${ollamaBase}/health`,
        });
      }
    }
  } catch (err) {
    findings.push({
      severity: 'high',
      title: 'Ollama unreachable',
      detail: err.message,
      url: config.OLLAMA_URL,
    });
  }

  // MCP endpoint check
  try {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (adminCookie) headers['Cookie'] = adminCookie;
    const r = await fetch(`${base}/admin/master-agent/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      findings.push({
        severity: 'medium',
        title: 'MCP endpoint unhealthy',
        detail: `POST /admin/master-agent/mcp → ${r.status}`,
        url: `${base}/admin/master-agent/mcp`,
      });
    }
  } catch (err) {
    findings.push({
      severity: 'medium',
      title: 'MCP endpoint unreachable',
      detail: err.message,
      url: `${base}/admin/master-agent/mcp`,
    });
  }

  return findings;
}

// ── Main Scanner ────────────────────────────────────────────────────────────

/**
 * Run a full site scan.
 *
 * @param {object} opts
 * @param {object} opts.tenant   — tenant doc from slab.tenants
 * @param {string} opts.adminCookie — slab_token cookie string for auth routes
 * @param {string[]} opts.modules — which modules to run (default: all)
 * @param {string[]} opts.pages  — specific page paths to scan (default: key pages)
 * @returns {{ summary, findings, duration }}
 */
export async function runScan(opts = {}) {
  const start = Date.now();
  const {
    tenant,
    adminCookie = '',
    modules = ['contrast', 'modals', 'modules', 'redundancy', 'security', 'routes'],
    pages = ['/', '/admin/login', '/admin'],
  } = opts;

  const base = baseUrl(tenant);
  const cookie = adminCookie ? `slab_token=${adminCookie}` : '';
  const allFindings = [];
  let browser;

  try {
    // Puppeteer scans (contrast, modals, modules, redundancy)
    const needsBrowser = ['contrast', 'modals', 'modules', 'redundancy'].some(m => modules.includes(m));

    if (needsBrowser) {
      browser = await launchBrowser();

      for (const pagePath of pages) {
        const url = `${base}${pagePath}`;
        const page = await browser.newPage();
        if (cookie) await page.setExtraHTTPHeaders({ 'Cookie': cookie });
        page.setDefaultTimeout(15000);

        if (modules.includes('contrast'))   allFindings.push(...await scanContrast(page, url));
        if (modules.includes('modals'))     allFindings.push(...await scanModals(page, url));
        if (modules.includes('modules'))    allFindings.push(...await scanModules(page, url));
        if (modules.includes('redundancy')) allFindings.push(...await scanRedundancy(page, url));

        await page.close();
      }
    }

    // Network scans (security, routes) — no browser needed
    if (modules.includes('security')) allFindings.push(...await scanSecurity(base, cookie));
    if (modules.includes('routes'))   allFindings.push(...await scanRoutes(base, cookie));

  } finally {
    if (browser) await browser.close();
  }

  // Sort by severity
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  allFindings.sort((a, b) => (sevOrder[a.severity] ?? 5) - (sevOrder[b.severity] ?? 5));

  const duration = Date.now() - start;
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of allFindings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  return {
    summary: {
      scannedAt: new Date(),
      base,
      modules,
      pages,
      duration,
      total: allFindings.length,
      counts,
    },
    findings: allFindings,
  };
}

/**
 * Convert scan findings to tickets in the tenant DB.
 * Groups findings by severity — critical/high get individual tickets,
 * medium/low/info get batched by module.
 *
 * DEDUPLICATION: skips any finding that already has an open/escalated
 * scanner ticket with the same subject. Resolved/closed tickets are
 * ignored so re-opened issues get new tickets.
 */
export async function findingsToTickets(db, findings, tenant) {
  const tickets = [];

  // ── Deduplication: load existing open scanner ticket subjects ──────────
  const existingTickets = await db.collection('tickets').find(
    {
      'submittedBy.email': 'scanner@slab.system',
      status: { $in: ['open', 'in-progress', 'escalated'] },
    },
    { projection: { subject: 1 } },
  ).toArray();
  const existingSubjects = new Set(existingTickets.map(t => t.subject));

  // Critical and high findings each get their own ticket
  const individual = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
  const batched = findings.filter(f => f.severity !== 'critical' && f.severity !== 'high');

  // Helper: get next ticket number
  async function nextNum() {
    const result = await db.collection('ticket_counter').findOneAndUpdate(
      { _id: 'ticket_seq' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    const seq = result.seq || result.value?.seq || 1;
    return `T-${String(seq).padStart(6, '0')}`;
  }

  const now = new Date();
  const submittedBy = {
    type: 'admin',
    userId: null,
    email: 'scanner@slab.system',
    displayName: 'Site Scanner',
    clientId: null,
  };

  let skipped = 0;

  for (const f of individual) {
    const subject = `[Scanner] ${f.title}`;
    if (existingSubjects.has(subject)) { skipped++; continue; }

    const doc = {
      ticketNumber: await nextNum(),
      subject,
      description: `**Severity:** ${f.severity}\n**URL:** ${f.url}\n\n${f.detail}`,
      category: f.severity === 'critical' ? 'bug' : 'improvement',
      priority: f.severity === 'critical' ? 'urgent' : 'high',
      status: 'open',
      submittedBy,
      escalated: false, escalatedAt: null, escalatedBy: null, escalationNotes: null,
      tenantDomain: tenant?.domain || '',
      tenantDbName: tenant?.db || '',
      tenantBrandName: tenant?.brand?.name || '',
      attachments: [],
      debugData: { scanner: true, finding: f },
      replies: [],
      assignedTo: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    tickets.push(doc);
  }

  // Batch lower-severity by title prefix (module type)
  if (batched.length > 0) {
    const groups = {};
    for (const f of batched) {
      const module = f.title.split(':')[0] || 'General';
      if (!groups[module]) groups[module] = [];
      groups[module].push(f);
    }

    for (const [module, items] of Object.entries(groups)) {
      const subject = `[Scanner] ${module} — ${items.length} issue${items.length > 1 ? 's' : ''}`;
      if (existingSubjects.has(subject)) { skipped++; continue; }

      const lines = items.map(f => `- **[${f.severity}]** ${f.title}\n  ${f.detail}\n  URL: ${f.url}`);
      const doc = {
        ticketNumber: await nextNum(),
        subject,
        description: `**Module:** ${module}\n**Issues found:** ${items.length}\n\n${lines.join('\n\n')}`,
        category: 'improvement',
        priority: 'medium',
        status: 'open',
        submittedBy,
        escalated: false, escalatedAt: null, escalatedBy: null, escalationNotes: null,
        tenantDomain: tenant?.domain || '',
        tenantDbName: tenant?.db || '',
        tenantBrandName: tenant?.brand?.name || '',
        attachments: [],
        debugData: { scanner: true, findings: items },
        replies: [],
        assignedTo: null,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      };
      tickets.push(doc);
    }
  }

  // Insert all tickets
  if (tickets.length > 0) {
    const inserted = await db.collection('tickets').insertMany(tickets);

    // Auto-escalate critical/high tickets to superadmin registry
    try {
      const slab = getSlabDb();
      // Find original indices of urgent/high tickets in the full tickets array
      const escalateIndices = [];
      for (let i = 0; i < tickets.length; i++) {
        if (tickets[i].priority === 'urgent' || tickets[i].priority === 'high') {
          escalateIndices.push(i);
        }
      }

      if (escalateIndices.length > 0) {
        const escalatedDocs = escalateIndices.map(idx => {
          const t = tickets[idx];
          return {
            ticketId: inserted.insertedIds[idx]?.toString() || '',
            tenantDomain: t.tenantDomain,
            tenantDbName: t.tenantDbName,
            tenantBrandName: t.tenantBrandName,
            ticketNumber: t.ticketNumber,
            subject: t.subject,
            status: 'escalated',
            priority: t.priority,
            category: t.category,
            submittedByEmail: t.submittedBy?.email || 'scanner@slab.system',
            escalatedAt: now,
            escalatedBy: 'scanner@slab.system',
            resolvedAt: null,
          };
        });
        await slab.collection('escalated_tickets').insertMany(escalatedDocs);

        // Also mark them escalated in tenant DB
        const escalatedIds = escalateIndices.map(idx => inserted.insertedIds[idx]).filter(Boolean);
        if (escalatedIds.length > 0) {
          await db.collection('tickets').updateMany(
            { _id: { $in: escalatedIds } },
            { $set: { escalated: true, escalatedAt: now, escalatedBy: 'scanner@slab.system', status: 'escalated' } },
          );
        }
      }
    } catch (err) {
      console.error('[scanner] auto-escalate error:', err.message);
    }
  }

  tickets.skipped = skipped;
  return tickets;
}
