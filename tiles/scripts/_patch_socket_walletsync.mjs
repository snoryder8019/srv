/**
 * Hook walletSync into services/socket.js so craps/roulette use real chips:
 *  - import the module
 *  - seedAll(table) when a casino table broadcasts in the bets phase
 *  - syncAfterEvents(table, events) after each broadcast (mirrors settle -> wallet)
 *  - clear(table) when the table is over
 * Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/tiles/services/socket.js';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes("wallet-sync.js")) { console.log('already wired'); process.exit(0); }

// 1) import after the stats import
s = s.replace(
  "import { reportGameResult } from '../lib/stats.js';",
  "import { reportGameResult } from '../lib/stats.js';\nimport * as walletSync from './wallet-sync.js';"
);

// 2) in broadcast(), after emitting events + before turn clock, seed + sync wallets.
const anchor = `async function broadcast(io, table, events = []) {
  const r = room(table.tableId);
  for (const ev of events) io.to(r).emit('table:event', ev);
  table.armTurnClock();`;
const replaced = `async function broadcast(io, table, events = []) {
  const r = room(table.tableId);
  for (const ev of events) io.to(r).emit('table:event', ev);
  // Casino chip economy: seed human bankrolls from the wallet during betting and
  // push settle deltas back. Best-effort; never blocks the table.
  if (walletSync.isCasino(table)) {
    const v = (table.publicState && table.publicState().view) || {};
    if (v.phase === 'bets') { try { await walletSync.seedAll(table); } catch (e) {} }
    try { await walletSync.syncAfterEvents(table, events); } catch (e) {}
  }
  table.armTurnClock();`;
if (s.split(anchor).length - 1 !== 1) throw new Error('broadcast anchor not unique');
s = s.replace(anchor, replaced);

// 3) clear sync state when a table finishes — finishIfOver path.
// finishIfOver calls finishGame-ish; simplest: clear inside finishIfOver after over.
// We hook the existing reportGameResult call site (runs once on game over).
s = s.replace(
  "  reportGameResult(table)\n    .then((r) => console.log(`[tiles] stats exported for ${table.tableId}:`, JSON.stringify(r)))\n    .catch((e) => console.warn('[tiles] stats export error:', e.message));",
  "  reportGameResult(table)\n    .then((r) => console.log(`[tiles] stats exported for ${table.tableId}:`, JSON.stringify(r)))\n    .catch((e) => console.warn('[tiles] stats export error:', e.message));\n  try { walletSync.clear(table); } catch (e) {}"
);

fs.writeFileSync(FILE, s);
console.log('socket.js: walletSync wired (seed + sync + clear)');
