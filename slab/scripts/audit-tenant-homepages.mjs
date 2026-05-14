/**
 * Smoke-test every tenant's homepage. Loops slab.tenants, requests `/` against
 * localhost:3602 with each tenant's primary Host header, reports failures.
 *
 * Run from /srv/slab:
 *   node scripts/audit-tenant-homepages.mjs
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import http from 'node:http';

const PORT = 3602;
const SLAB_PORT = process.env.PORT || PORT;
const REQUEST_TIMEOUT = 10000;

function fetchHome(host) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request({
      host: '127.0.0.1', port: SLAB_PORT, method: 'GET', path: '/',
      headers: { Host: host, 'User-Agent': 'slab-tenant-audit' },
      timeout: REQUEST_TIMEOUT,
    }, (res) => {
      let bytes = 0;
      res.on('data', (chunk) => { bytes += chunk.length; });
      res.on('end', () => resolve({ status: res.statusCode, bytes, ms: Date.now() - start, location: res.headers.location || '' }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, bytes: 0, ms: REQUEST_TIMEOUT, error: 'timeout' }); });
    req.on('error', (err) => resolve({ status: 0, bytes: 0, ms: Date.now() - start, error: err.message }));
    req.end();
  });
}

const cli = new MongoClient(process.env.DB_URL);
await cli.connect();
const slab = cli.db('slab');
const tenants = await slab.collection('tenants').find({}).sort({ 'meta.subdomain': 1 }).toArray();
await cli.close();

console.log(`[audit] ${tenants.length} tenants to check\n`);

const results = [];
for (const t of tenants) {
  const sub = t.meta?.subdomain || '(no-subdomain)';
  const customDomain = t.meta?.customDomain || '';
  const fallbackHost = `${sub}.madladslab.com`;
  const hosts = [];
  if (customDomain) hosts.push(customDomain);
  hosts.push(fallbackHost);

  for (const host of hosts) {
    const r = await fetchHome(host);
    results.push({ sub, host, db: t.db, status: r.status, bytes: r.bytes, ms: r.ms, error: r.error, location: r.location });
  }
}

// Sort: failures first, then by status, then by bytes
results.sort((a, b) => {
  const aBad = a.status !== 200;
  const bBad = b.status !== 200;
  if (aBad !== bBad) return aBad ? -1 : 1;
  if (a.status !== b.status) return a.status - b.status;
  return a.bytes - b.bytes;
});

console.log('Sub'.padEnd(20) + ' Host'.padEnd(40) + ' Status   Bytes    Time   Notes');
console.log('─'.repeat(110));
for (const r of results) {
  const status = String(r.status || 'ERR').padStart(6);
  const bytes = String(r.bytes).padStart(7);
  const ms = (r.ms + 'ms').padStart(6);
  const notes = r.error ? `error: ${r.error}`
              : r.status >= 300 && r.status < 400 ? `→ ${r.location}`
              : r.bytes < 1000 ? '⚠ suspiciously small body'
              : '';
  console.log(r.sub.padEnd(20) + ' ' + r.host.padEnd(40) + ' ' + status + ' ' + bytes + ' ' + ms + '  ' + notes);
}

const failures = results.filter(r => r.status !== 200);
const tiny = results.filter(r => r.status === 200 && r.bytes < 1000);
console.log('');
console.log(`[summary] ${results.length} hosts checked · ${failures.length} failed · ${tiny.length} suspiciously small`);
if (failures.length || tiny.length) process.exit(2);
