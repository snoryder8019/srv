/**
 * Table manager — in-memory registry of live tables. Matchmaking creates
 * tables via a ticket; tables can also be created locally (dev/admin).
 */
import { TileTableRuntime } from './table.js';
import { getVariant } from './variants/index.js';

const tables = new Map();
const CASINO = new Set(['craps', 'roulette', 'blackjack', 'baccarat']);

export function createTable({ tableId, game, config = {}, players = [] }) {
  const variant = getVariant(game);
  if (!variant) throw new Error(`unknown game: ${game}`);
  if (tables.has(tableId)) return tables.get(tableId);
  const t = new TileTableRuntime({ tableId, variant, config, players });
  tables.set(tableId, t);
  return t;
}

export function getTable(id) { return tables.get(id) || null; }
export function dropTable(id) { return tables.delete(id); }
export function listTables() { return [...tables.values()].map((t) => t.summary()); }

/**
 * Rich live-table listing for the cross-game match dashboard (bridge-authed).
 * Every live table on this platform, normalized with per-seat occupancy so the
 * dashboard can render rooms/tables open across games. Screen names only.
 */
export function listLiveTables() {
  const out = [];
  for (const t of tables.values()) {
    const seats = (t.seats || []).map((s) => ({
      seat: s.seat,
      kind: s.bot ? 'bot' : (s.platformId ? 'human' : 'open'),
      // privacy: only the public screen name is ever exposed (never real name/email)
      name: s.bot ? null : (s.platformId ? (s.displayName || 'Player') : null),
      connected: !!s.connected,
      ready: !!s.ready,
    }));
    const humans = seats.filter((s) => s.kind === 'human');
    out.push({
      tableId: t.tableId,
      game: t.game,
      phase: t.phase,
      seatCount: t.seatCount || seats.length,
      seats,
      humans: humans.length,
      humanNames: humans.map((s) => s.name).filter(Boolean),
      connectedHumans: humans.filter((s) => s.connected).length,
      bots: seats.filter((s) => s.kind === 'bot').length,
      openSeats: seats.filter((s) => s.kind === 'open').length,
      min: (t.config && t.config.betSize) || null,
      gamesPlayed: t.gamesPlayed || 0,
      handNo: t.handNo || 0,
      scores: Array.isArray(t.scores) ? t.scores.slice() : [],
      topScore: Array.isArray(t.scores) && t.scores.length ? Math.max(...t.scores) : null,
      casino: CASINO.has(t.game),
    });
  }
  return out;
}

/**
 * Casino table listing for matchmaking. Returns open continuous tables grouped
 * with their minimum bet + occupancy so players can pick a table/stake. A table
 * is "open" if it isn't gameOver and has at least one seat without a human.
 */
export function listCasinoTables(game) {
  const out = [];
  for (const t of tables.values()) {
    if (!CASINO.has(t.game)) continue;
    if (game && t.game !== game) continue;
    if (t.phase === 'gameOver') continue;
    const humanSeats = t.seats.filter((s) => s.platformId && !s.bot);
    const openSeats = t.seats.filter((s) => !s.platformId).map((s) => s.seat);
    out.push({
      tableId: t.tableId, game: t.game,
      min: t.config.betSize, startChips: t.config.startChips,
      seats: t.seatCount, humans: humanSeats.length, openSeats,
      phase: t.phase,
    });
  }
  return out;
}

/**
 * Find an open casino table at the given minimum, or signal that one should be
 * created. Returns { tableId, seat, created:false } for an existing table with an
 * open seat, or { needCreate:true, min } if none exists at that minimum.
 * Matchmaking owns ticket minting; this only resolves placement.
 */
export function placeAtCasinoTable(game, min) {
  // a "human seat" = occupied by a real player (platformId set AND not a bot).
  const humanHeld = (st) => !!(st.platformId && !st.bot);
  for (const t of tables.values()) {
    if (t.game !== game || t.phase === 'gameOver') continue;
    if (t.config.betSize !== min) continue;
    // don't pile onto a table that's already full of humans
    const freeForHuman = t.seats.filter((st) => !humanHeld(st));
    if (!freeForHuman.length) continue;
    // prefer a truly-empty seat; otherwise displace a bot so the human joins the
    // SAME live table (this is how matchmaking adds you to an active game).
    const empty = freeForHuman.find((st) => !st.platformId);
    const target = empty || freeForHuman.find((st) => st.bot) || freeForHuman[0];
    return { tableId: t.tableId, seat: target.seat, created: false, min, displacedBot: !empty };
  }
  return { needCreate: true, min };
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

// ALL live seats a human holds (a player can sit at several tables/games at once).
// Powers the match board's "my active games" section. In-progress tables first.
export function findSeatsByPlatformId(pid) {
  pid = String(pid);
  const out = [];
  for (const t of tables.values()) {
    const s = t.seats.find((x) => x.platformId === pid && !x.bot);
    if (!s) continue;
    out.push({
      tableId: t.tableId, game: t.game, seat: s.seat, phase: t.phase,
      displayName: s.displayName,
      humans: t.seats.filter((x) => x.platformId && !x.bot).length,
      seatCount: t.seatCount || t.seats.length,
    });
  }
  // in-progress before finished, so resume surfaces a live game first
  out.sort((a, b) => (a.phase === 'gameOver' ? 1 : 0) - (b.phase === 'gameOver' ? 1 : 0));
  return out;
}

// Resolve a seat a walk-up human can take at a SPECIFIC live table: prefer a
// truly-empty seat, else displace a bot. Never take another human's seat, never
// a finished table. Powers "tap any table → sit down (over a bot)".
export function findOpenSeatAtTable(tableId) {
  const t = tables.get(tableId);
  if (!t || t.phase === 'gameOver') return null;
  const empty = t.seats.find((s) => !s.platformId);
  if (empty) return { seat: empty.seat, game: t.game, displaced: false };
  const bot = t.seats.find((s) => s.bot);
  if (bot) return { seat: bot.seat, game: t.game, displaced: true };
  return null;   // full of humans
}

let seq = 0;
export function nextTableId(prefix = 't') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}
