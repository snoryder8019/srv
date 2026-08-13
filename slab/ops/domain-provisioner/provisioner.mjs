#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Slab domain-provisioner  —  runs on the VPS (the public Apache host).
//
// Reconciles tenant custom domains → Apache vhost .conf + Let's Encrypt cert.
// Zero npm dependencies (Node 18+ built-ins only). Idempotent: safe to run on a
// timer or as a long-lived service; every cycle brings Apache into agreement
// with Slab's /internal/verified-domains list.
//
// Per cycle:
//   1. GET verified domains from Slab (over the tunnel, secret-header auth).
//   2. For each domain missing a cert  → certbot certonly --webroot (HTTP-01).
//   3. For each domain missing/stale .conf → write tenant-<apex>.conf + a2ensite.
//   4. If anything changed → apachectl configtest && systemctl reload apache2.
//
// HTTP-01 is the ownership proof: issuance only succeeds if the domain's DNS
// already points at this VPS, so no separate DNS-TXT step is needed.
// Renewals are left to the system `certbot.timer`; this app only bootstraps.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import dns from 'node:dns/promises';

const env = (k, d) => (process.env[k] ?? d);

const CFG = {
  slabUrl:        env('SLAB_URL', 'http://127.0.0.1:3602'),
  slabHostHeader: env('SLAB_HOST_HEADER', 'slab.madladslab.com'),
  provisionKey:   env('SLAB_PROVISION_KEY', ''),
  tunnel:         env('TUNNEL', '127.0.0.1:3602'),           // where Apache proxies to
  acmeWebroot:    env('ACME_WEBROOT', '/var/www/acme'),
  certbotEmail:   env('CERTBOT_EMAIL', ''),
  sitesAvailable: env('APACHE_SITES_AVAILABLE', '/etc/apache2/sites-available'),
  expectedIp:     env('EXPECTED_IP', ''),                    // VPS public IP; gates issuance if set
  pollMs:         parseInt(env('POLL_INTERVAL_MS', '120000'), 10),
  once:           env('RUN_ONCE', '') === '1',
  dryRun:         env('DRY_RUN', '') === '1',
  prune:          env('PRUNE', '') === '1',                  // a2dissite for domains no longer listed
  // Comma-separated allowlist. When set, ONLY these apexes are acted on — a
  // safety valve for the first rollout so existing/already-served domains are
  // left untouched. Empty = act on every verified domain.
  onlyDomains:    env('ONLY_DOMAINS', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  templatePath:   env('TEMPLATE_PATH', path.join(path.dirname(new URL(import.meta.url).pathname), 'templates', 'tenant-vhost.conf.tmpl')),
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const warn = (...a) => console.warn(new Date().toISOString(), 'WARN', ...a);

function sh(cmd, args) {
  if (CFG.dryRun) { log('[dry-run]', cmd, args.join(' ')); return ''; }
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function fetchDomains() {
  const res = await fetch(`${CFG.slabUrl}/internal/verified-domains`, {
    headers: { 'X-Provision-Key': CFG.provisionKey, Host: CFG.slabHostHeader },
  });
  if (!res.ok) throw new Error(`verified-domains ${res.status}`);
  const body = await res.json();
  return Array.isArray(body.domains) ? body.domains : [];
}

// Keep only names whose A record points at this VPS. When EXPECTED_IP is unset
// we can't verify, so we optimistically keep the name and let certbot decide.
async function resolvesHere(name) {
  if (!CFG.expectedIp) return true;
  try {
    const ips = await dns.resolve4(name);
    return ips.includes(CFG.expectedIp);
  } catch { return false; }
}

const certLive = (apex) => `/etc/letsencrypt/live/${apex}/fullchain.pem`;
const hasCert = (apex) => fs.existsSync(certLive(apex));
const confPath = (apex) => path.join(CFG.sitesAvailable, `tenant-${apex}.conf`);

function issueCert(apex, names) {
  // Try apex + all resolvable aliases; on failure fall back to apex-only so one
  // missing www record can't block the whole cert.
  const base = [
    'certonly', '--webroot', '-w', CFG.acmeWebroot,
    '--non-interactive', '--agree-tos', '--keep-until-expiring',
    '-m', CFG.certbotEmail,
  ];
  const dArgs = (list) => list.flatMap((n) => ['-d', n]);
  try {
    log(`certbot issue: ${names.join(', ')}`);
    sh('certbot', [...base, ...dArgs(names)]);
    return true;
  } catch (e) {
    warn(`certbot failed for [${names.join(',')}]: ${e.message.split('\n').slice(-3).join(' ')}`);
    if (names.length > 1) {
      try { log(`certbot retry apex-only: ${apex}`); sh('certbot', [...base, ...dArgs([apex])]); return true; }
      catch (e2) { warn(`certbot apex-only failed for ${apex}: ${e2.message.split('\n').pop()}`); }
    }
    return false;
  }
}

function renderConf(template, { apex, aliases }) {
  const aliasList = aliases.join(' ');
  return template
    .replaceAll('{{APEX}}', apex)
    .replaceAll('{{ALIASES}}', aliasList)
    .replaceAll('{{ALIAS_DIRECTIVE}}', aliasList ? `ServerAlias ${aliasList}` : '')
    .replaceAll('{{TUNNEL}}', CFG.tunnel)
    .replaceAll('{{ACME_WEBROOT}}', CFG.acmeWebroot);
}

function ensureConf(apex, aliases, template) {
  const desired = renderConf(template, { apex, aliases });
  const p = confPath(apex);
  const current = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (current === desired) return false;
  if (CFG.dryRun) { log(`[dry-run] would write ${p}`); return true; }
  fs.writeFileSync(p, desired, 'utf8');
  log(`wrote ${p}`);
  sh('a2ensite', [`tenant-${apex}.conf`]);
  return true;
}

async function reconcile() {
  const template = fs.readFileSync(CFG.templatePath, 'utf8');
  const domains = await fetchDomains();
  log(`fetched ${domains.length} verified domain(s)`);

  let changed = false;
  const desiredApex = new Set();

  for (const d of domains) {
    const apex = String(d.apex || '').toLowerCase().trim();
    if (!apex) continue;
    if (CFG.onlyDomains.length && !CFG.onlyDomains.includes(apex)) continue;  // allowlist
    desiredApex.add(apex);

    // Build the name list: apex (must resolve here) + any resolvable aliases.
    const names = [apex];
    if (!(await resolvesHere(apex))) {
      warn(`${apex} does not resolve to ${CFG.expectedIp || 'this VPS'} yet — skipping (DNS not pointed)`);
      continue;
    }
    for (const a of (d.aliases || [])) {
      if (await resolvesHere(a)) names.push(a);
    }

    if (!hasCert(apex)) {
      if (!issueCert(apex, names)) continue;          // no cert → don't write an SSL vhost that won't load
    }
    // Only advertise aliases in the vhost that we actually got a cert for.
    const certAliases = names.filter((n) => n !== apex);
    if (ensureConf(apex, certAliases, template)) changed = true;
  }

  if (CFG.prune) changed = pruneStale(desiredApex) || changed;

  if (changed) {
    try {
      sh('apache2ctl', ['configtest']);
      sh('systemctl', ['reload', 'apache2']);
      log('apache reloaded');
    } catch (e) {
      warn(`apache reload/configtest failed — NOT reloaded: ${e.message}`);
    }
  } else {
    log('no changes');
  }
}

function pruneStale(desiredApex) {
  let changed = false;
  let files = [];
  try { files = fs.readdirSync(CFG.sitesAvailable); } catch { return false; }
  for (const f of files) {
    const m = /^tenant-(.+)\.conf$/.exec(f);
    if (!m) continue;
    if (desiredApex.has(m[1])) continue;
    warn(`pruning stale vhost for ${m[1]} (no longer a verified domain)`);
    try { sh('a2dissite', [f]); changed = true; } catch (e) { warn(`a2dissite ${f}: ${e.message}`); }
  }
  return changed;
}

async function main() {
  for (const k of ['provisionKey', 'certbotEmail']) {
    if (!CFG[k]) { console.error(`Missing required env for ${k}. See .env.example`); process.exit(2); }
  }
  log(`domain-provisioner starting (poll ${CFG.pollMs}ms, dryRun=${CFG.dryRun}, prune=${CFG.prune})`);
  const tick = async () => {
    try { await reconcile(); } catch (e) { warn(`cycle failed: ${e.message}`); }
  };
  await tick();
  if (CFG.once) return;
  setInterval(tick, CFG.pollMs);
}

main();
