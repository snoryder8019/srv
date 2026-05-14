// One-shot backfill of WindrosePlus NDJSON logs into the games stats DB.
// Walks every YYYY-MM-DD.log in /srv/games/windrose/windrose_plus_data, dedups
// on (sid + ts_unix + ev) so re-runs are safe, inserts player_join/leave/etc
// game_events, and rebuilds windrose totalPlaytime/sessions in player_stats by
// pairing each player_leave with the immediately-preceding player_join for
// the same name (capped at 24h, matching the live collector's logic).
//
// Run: node /srv/games/scripts/backfill-windrose-events.js [--from YYYY-MM-DD] [--dry]

require('dotenv').config({ path: '/srv/games/.env' });
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DATA_DIR = '/srv/games/windrose/windrose_plus_data';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const fromIdx = args.indexOf('--from');
const fromDate = fromIdx >= 0 ? args[fromIdx + 1] : null;

const TYPE_MAP = {
  'player.join': 'player_join',
  'player.leave': 'player_leave',
};

(async () => {
  const c = new MongoClient(process.env.DB_URL);
  await c.connect();
  const db = c.db();

  // Pick log files
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
    .filter(f => !fromDate || f.slice(0, 10) >= fromDate)
    .sort();

  console.log('[backfill] files to process:', files);

  // Pull existing event signatures for windrose to dedup. Two keys:
  //   sid:<sessionId>:<ts_sec>:<type>:<name>  (precise — when sid is present)
  //   ts:<type>:<isoTs>:<name>                (fallback for older rows)
  const existing = new Set();
  await db.collection('game_events')
    .find({ game: 'windrose' }, { projection: { type: 1, ts: 1, name: 1, sessionId: 1 } })
    .forEach(e => {
      if (e.sessionId) existing.add(`sid:${e.sessionId}:${Math.floor(e.ts.getTime()/1000)}:${e.type}:${e.name||''}`);
      existing.add(`ts:${e.type}:${e.ts.toISOString()}:${e.name||''}`);
    });
  console.log('[backfill] existing event keys cached:', existing.size);

  let inserted = 0;
  let skipped = 0;
  const eventsToInsert = [];

  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try { parsed = JSON.parse(trimmed); } catch { continue; }
      const rawType = parsed.ev || parsed.event || parsed.type;
      if (!rawType) continue;
      // Player events only — keep DB tidy and skip thousands of heartbeats.
      if (rawType !== 'player.join' && rawType !== 'player.leave') continue;

      const tsRaw = parsed.ts || parsed.timestamp;
      const ts = tsRaw ? new Date(tsRaw) : (parsed.ts_unix ? new Date(parsed.ts_unix * 1000) : null);
      if (!ts || isNaN(ts.getTime())) continue;

      const p = (parsed.payload && typeof parsed.payload === 'object') ? parsed.payload : parsed;
      const name = p.name || p.player || p.playerName;
      if (!name) continue;

      const type = TYPE_MAP[rawType];
      const sid = parsed.sid || null;
      const sigSid = sid ? `sid:${sid}:${Math.floor(ts.getTime()/1000)}:${type}:${name}` : null;
      const sigTs = `ts:${type}:${ts.toISOString()}:${name}`;
      if ((sigSid && existing.has(sigSid)) || existing.has(sigTs)) {
        skipped++;
        continue;
      }
      if (sigSid) existing.add(sigSid);
      existing.add(sigTs);

      const doc = { game: 'windrose', type, ts, name, raw: trimmed.slice(0, 300) };
      if (sid) doc.sessionId = sid;
      if (p.x != null && p.y != null) doc.pos = `${p.x},${p.y},${p.z != null ? p.z : 0}`;
      eventsToInsert.push(doc);
      inserted++;
    }
  }

  console.log(`[backfill] new events to insert: ${inserted}, skipped (already present): ${skipped}`);

  if (!dry && eventsToInsert.length > 0) {
    const r = await db.collection('game_events').insertMany(eventsToInsert, { ordered: false });
    console.log('[backfill] inserted:', r.insertedCount);
  }

  // ── Rebuild windrose player_stats playtime + sessions from full event history ──
  // Pairs leaves with the latest preceding join for the same name (24h cap).
  // Idempotent — we $set the totals, not $inc.
  const allEvents = await db.collection('game_events')
    .find({ game: 'windrose', type: { $in: ['player_join', 'player_leave'] }, name: { $exists: true } })
    .project({ _id: 0, type: 1, ts: 1, name: 1 })
    .sort({ ts: 1 })
    .toArray();

  const byName = {};
  for (const ev of allEvents) {
    if (!byName[ev.name]) byName[ev.name] = [];
    byName[ev.name].push(ev);
  }

  const stats = {};
  for (const [name, evs] of Object.entries(byName)) {
    let sessions = 0;
    let totalPlaytime = 0;
    let firstSeen = null;
    let lastSeen = null;
    let openJoin = null;

    for (const ev of evs) {
      if (!firstSeen || ev.ts < firstSeen) firstSeen = ev.ts;
      if (!lastSeen || ev.ts > lastSeen) lastSeen = ev.ts;

      if (ev.type === 'player_join') {
        sessions++;
        openJoin = ev.ts;
      } else if (ev.type === 'player_leave' && openJoin) {
        const sec = Math.min(86400, Math.max(0, Math.floor((ev.ts - openJoin) / 1000)));
        totalPlaytime += sec;
        openJoin = null;
      }
    }
    stats[name] = { sessions, totalPlaytime, firstSeen, lastSeen };
  }

  console.log('[backfill] computed stats for', Object.keys(stats).length, 'windrose players');
  for (const [name, s] of Object.entries(stats)) {
    console.log(`  ${name}: ${s.sessions} sessions, ${s.totalPlaytime}s playtime`);
    if (dry) continue;

    // Two-step upsert that omits steamId on insert so the sparse-unique
    // index on (steamId, game) doesn't see steamId:null.
    const existing = await db.collection('player_stats').findOne({ game: 'windrose', name });
    if (existing) {
      await db.collection('player_stats').updateOne(
        { _id: existing._id },
        {
          $set: {
            sessions: s.sessions,
            totalPlaytime: s.totalPlaytime,
            lastSeen: s.lastSeen,
          },
        }
      );
    } else {
      try {
        await db.collection('player_stats').insertOne({
          game: 'windrose',
          name,
          firstSeen: s.firstSeen,
          lastSeen: s.lastSeen,
          sessions: s.sessions,
          totalPlaytime: s.totalPlaytime,
          kills: 0,
          deaths: 0,
          bossKills: 0,
          piecesPlaced: 0,
          crafted: 0,
        });
      } catch (e) {
        if (e && e.code === 11000) {
          console.log('  (race) re-applying as update for', name);
          await db.collection('player_stats').updateOne(
            { game: 'windrose', name },
            { $set: { sessions: s.sessions, totalPlaytime: s.totalPlaytime, lastSeen: s.lastSeen } }
          );
        } else {
          throw e;
        }
      }
    }
  }

  if (dry) console.log('[backfill] DRY RUN — no DB writes performed');
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
