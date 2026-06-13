/**
 * Table manager — in-memory registry of live tables. Matchmaking creates
 * tables via a ticket; tables can also be created locally (dev/admin).
 */
import { TableRuntime } from './table.js';
import { getVariant } from './variants/index.js';

const tables = new Map();

export function createTable({ tableId, game, config = {}, players = [] }) {
  const variant = getVariant(game);
  if (!variant) throw new Error(`unknown game: ${game}`);
  if (tables.has(tableId)) return tables.get(tableId);
  const t = new TableRuntime({ tableId, variant, config, players });
  tables.set(tableId, t);
  return t;
}

export function getTable(id) { return tables.get(id) || null; }
export function dropTable(id) { return tables.delete(id); }
export function listTables() { return [...tables.values()].map((t) => t.summary()); }

// Rich live-table listing for the cross-game match dashboard (bridge-authed).
// Screen names only. Defensive about optional fields (legacy variants).
const CASINO = new Set(['craps', 'roulette']);
export function listLiveTables() {
  const out = [];
  for (const t of tables.values()) {
    const seats = (t.seats || []).map((s) => ({
      seat: s.seat,
      kind: s.bot ? 'bot' : (s.platformId ? 'human' : 'open'),
      name: s.bot ? null : (s.platformId ? (s.displayName || 'Player') : null),
      connected: !!s.connected,
      ready: !!s.ready,
    }));
    const humans = seats.filter((s) => s.kind === 'human');
    out.push({
      tableId: t.tableId, game: t.game, phase: t.phase,
      seatCount: t.seatCount || seats.length, seats,
      humans: humans.length,
      humanNames: humans.map((s) => s.name).filter(Boolean),
      connectedHumans: humans.filter((s) => s.connected).length,
      bots: seats.filter((s) => s.kind === 'bot').length,
      openSeats: seats.filter((s) => s.kind === 'open').length,
      min: (t.config && t.config.betSize) || null,
      gamesPlayed: t.gamesPlayed || 0, handNo: t.handNo || 0,
      casino: CASINO.has(t.game),
    });
  }
  return out;
}

// Find the live seat a human currently holds, for reconnect / resume. Prefers an
// in-progress table over a finished one. Returns { tableId, game, seat, phase } | null.
export function findSeatByPlatformId(pid) {
  pid = String(pid);
  let best = null;
  for (const t of tables.values()) {
    const s = t.seats.find((x) => x.platformId === pid && !x.bot);
    if (!s) continue;
    const cand = { tableId: t.tableId, game: t.game, seat: s.seat, phase: t.phase, displayName: s.displayName };
    if (!best || (best.phase === 'gameOver' && cand.phase !== 'gameOver')) best = cand;
  }
  return best;
}

let seq = 0;
export function nextTableId(prefix = 't') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}
