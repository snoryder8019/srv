#!/usr/bin/env node
/**
 * ingest-security-logs.js
 * Reads fail2ban log + current jail status and writes into:
 *   slab.security_events       — individual ban/unban/found events
 *   slab.security_snapshots    — point-in-time jail state
 *   slab.security_system_stats — RAM/CPU/load
 *
 * Run via cron: * * * * * cd /srv/slab && node scripts/ingest-security-logs.js
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load slab .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI    = process.env.DB_URL;
const DB_NAME      = process.env.SLAB_DB || 'slab';
const FAIL2BAN_LOG = '/var/log/fail2ban.log';
const LOOKBACK_MIN = 60;

if (!MONGO_URI) { console.error('[security-ingest] DB_URL not set'); process.exit(1); }

function runCmd(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 8000 }).trim(); }
  catch { return ''; }
}

function parseTimestamp(str) {
  const d = new Date(str.replace(',', '.') + 'Z');
  return isNaN(d) ? new Date() : d;
}

function parseFail2banLog() {
  if (!existsSync(FAIL2BAN_LOG)) return [];
  const cutoff = new Date(Date.now() - LOOKBACK_MIN * 60 * 1000);
  const events = [];

  for (const line of readFileSync(FAIL2BAN_LOG, 'utf8').split('\n')) {
    const m = line.match(
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+)\s+fail2ban\.\w+\s+\[\d+\]:\s+(INFO|NOTICE|WARNING)\s+\[([^\]]+)\]\s+(.+)$/
    );
    if (!m) continue;
    const ts = parseTimestamp(m[1]);
    if (ts < cutoff) continue;

    const jail = m[3], msg = m[4].trim();
    let action = null, ip = null;
    if (msg.startsWith('Ban '))   { action = 'ban';   ip = msg.slice(4).trim(); }
    if (msg.startsWith('Unban ')) { action = 'unban'; ip = msg.slice(6).trim(); }
    if (msg.startsWith('Found ')) { action = 'found'; ip = msg.slice(6).split(' ')[0]; }

    events.push({ source: 'fail2ban', jail, action, ip, level: m[2], msg, timestamp: ts });
  }
  return events;
}

function getCurrentBans() {
  const raw = runCmd('fail2ban-client status 2>/dev/null');
  const jailMatch = raw.match(/Jail list:\s+(.+)/);
  if (!jailMatch) return [];

  return jailMatch[1].split(',').map(j => j.trim()).filter(Boolean).map(jail => {
    const s = runCmd(`fail2ban-client status ${jail} 2>/dev/null`);
    const g = rx => { const m = s.match(rx); return m ? parseInt(m[1]) : 0; };
    const ipMatch = s.match(/Banned IP list:\s+(.+)/);
    return {
      jail,
      currentlyBanned: g(/Currently banned:\s+(\d+)/),
      totalBanned:     g(/Total banned:\s+(\d+)/),
      currentlyFailed: g(/Currently failed:\s+(\d+)/),
      bannedIPs: ipMatch ? ipMatch[1].trim().split(/\s+/).filter(Boolean) : [],
      snapshotAt: new Date(),
    };
  });
}

function getSystemStats() {
  let memTotal=0, memUsed=0, memFree=0, swapTotal=0, swapUsed=0;
  for (const line of runCmd('free -b').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0]==='Mem:')  { memTotal=+p[1]; memUsed=+p[2]; memFree=+p[3]; }
    if (p[0]==='Swap:') { swapTotal=+p[1]; swapUsed=+p[2]; }
  }
  const uptimeSec = parseFloat(runCmd('cat /proc/uptime').split(' ')[0]) || 0;
  const lp = runCmd('cat /proc/loadavg').split(' ');
  return { memTotal, memUsed, memFree, swapTotal, swapUsed, uptimeSec,
    load: { '1m': +lp[0], '5m': +lp[1], '15m': +lp[2] }, recordedAt: new Date() };
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const evCol   = db.collection('security_events');
  const snapCol = db.collection('security_snapshots');
  const sysCol  = db.collection('security_system_stats');

  await evCol.createIndex({ timestamp: -1 });
  await evCol.createIndex({ ip: 1 });
  await snapCol.createIndex({ createdAt: -1 });
  await sysCol.createIndex({ recordedAt: -1 });

  // Ingest log events (dedupe)
  const logEvents = parseFail2banLog();
  let inserted = 0;
  for (const ev of logEvents) {
    if (ev.action && ev.ip) {
      const exists = await evCol.findOne({
        source: ev.source, jail: ev.jail, action: ev.action, ip: ev.ip, timestamp: ev.timestamp,
      });
      if (!exists) { await evCol.insertOne(ev); inserted++; }
    }
  }

  // Snapshot current bans
  const bans = getCurrentBans();
  if (bans.length) await snapCol.insertOne({ bans, createdAt: new Date() });

  // System stats
  await sysCol.insertOne(getSystemStats());

  // Prune > 30 days
  const prune = new Date(Date.now() - 30*24*60*60*1000);
  await evCol.deleteMany({ timestamp: { $lt: prune } });
  await snapCol.deleteMany({ createdAt: { $lt: prune } });
  await sysCol.deleteMany({ recordedAt: { $lt: prune } });

  console.log(`[security-ingest] ${new Date().toISOString()} — ${inserted} new events, ${bans.length} jails`);
  await client.close();
}

main().catch(err => { console.error('[security-ingest] ERROR:', err.message); process.exit(1); });
