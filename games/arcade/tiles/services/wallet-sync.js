/**
 * walletSync — mirror casino-table bankroll changes into the persistent chip
 * wallet (games platform). The engine runs an in-memory bankroll per seat (so
 * bots + mechanics work unchanged); for HUMAN seats we make that bankroll track
 * the real wallet:
 *
 *   • when a human first sits at a casino hand, seed the engine bankroll from
 *     their real wallet balance (so they bet what they actually own)
 *   • after each settle, reconcile the seat's NET change to the wallet — credit a
 *     winning round, debit a losing round, no-op a push — then re-pull the
 *     authoritative balance so engine + wallet stay in lockstep
 *
 * STATE LIVES ON THE TABLE INSTANCE (table._walletSync), NOT a tableId-keyed map.
 * This is load-bearing: an idle table can be reaped and a new table object created
 * later under the SAME tableId. If the synced baseline (`last`) + `seeded` flag
 * survived on a tableId map, the fresh table's engine bankroll (startChips) would
 * be reconciled against a stale, huge baseline and DRAIN the wallet by the whole
 * difference. Binding state to the instance means a recreated table always starts
 * fresh and re-seeds from the wallet.
 *
 * CONCURRENCY: broadcast() is async and awaits these wallet round-trips, while a
 * casino table fires many overlapping broadcasts (every craps roll settles; the
 * 1s clock also broadcasts). Two overlapping reconciles would both read the same
 * baseline and apply the SAME delta twice — double-debiting losses (a drain). We
 * (a) serialize all wallet work per table through a promise chain, and (b) advance
 * the baseline SYNCHRONOUSLY before the awaited wallet call, so a re-entrant pass
 * computes a zero delta. Net: each round's delta hits the wallet exactly once.
 *
 * DESYNC GUARD: if a loss reconcile is implausibly larger than the round's tracked
 * wager (the signature of a baseline desync), we refuse to debit and instead
 * re-pull the wallet to resync — a wrong free hand is always better than a drain.
 */
import { getChips, settleChips, debitChips, isWalletSeat } from '../lib/wallet.js';

const CASINO = new Set(['craps', 'roulette', 'blackjack', 'baccarat']);

/**
 * Map a seat's net bankroll change over a round to a single wallet operation.
 *   delta > 0 → credit the win (settleChips pays out exactly `delta`)
 *   delta < 0 → debit the loss
 *   delta = 0 → push, nothing to do
 */
export function roundOps(before, after) {
  const delta = Math.round((after || 0) - (before || 0));
  if (delta > 0) return { kind: 'win', payout: delta, delta };
  if (delta < 0) return { kind: 'loss', debit: -delta, delta };
  return { kind: 'push', delta: 0 };
}

// per-table sync state — stored ON THE TABLE INSTANCE so a recreated table is fresh
function st(table) {
  if (!table._walletSync) table._walletSync = { seeded: new Set(), last: {}, mainWager: {}, sideWager: {} };
  return table._walletSync;
}

// per-table serialization: all wallet work for a table runs strictly in sequence
const chains = new Map();
function serialize(tableId, fn) {
  const prev = chains.get(tableId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  chains.set(tableId, run.catch(() => {}));
  return run;
}

export function isCasino(table) { return table && table.variant && CASINO.has(table.variant.id); }

/**
 * Seed a human seat's engine bankroll from their wallet at the first chance.
 * Called before bets open. Returns silently if not applicable.
 */
async function _seedSeat(table, seat) {
  if (!isCasino(table)) return;
  const s = st(table);
  const seatObj = table.seats[seat];
  if (!seatObj || seatObj.bot || !isWalletSeat(seatObj.platformId)) return;
  if (s.seeded.has(seat)) return;
  const w = await getChips(seatObj.platformId, seatObj.displayName);
  if (w && w.ok && typeof w.chips === 'number') {
    const m = table.variant._match ? table.variant._match(table) : null;
    if (m && Array.isArray(m.bankrolls)) { m.bankrolls[seat] = w.chips; table.scores = m.bankrolls.slice(); }
    seatObj.chips = w.chips;
    s.last[seat] = w.chips;
    s.seeded.add(seat);          // only mark seeded on SUCCESS, so a transient wallet failure retries
  }
}
export async function seedSeat(table, seat) { return serialize(table.tableId, () => _seedSeat(table, seat)); }

/** Seed every current human seat (call at hand/bet start). */
async function _seedAll(table) {
  if (!isCasino(table)) return;
  for (let i = 0; i < table.seatCount; i++) await _seedSeat(table, i);
}
export async function seedAll(table) { return serialize(table.tableId, () => _seedAll(table)); }

async function _resync(table, m, s, seat, seatObj) {
  const w = await getChips(seatObj.platformId, seatObj.displayName);
  if (w && w.ok && typeof w.chips === 'number') { m.bankrolls[seat] = w.chips; s.last[seat] = w.chips; }
  seatObj.chips = m.bankrolls[seat];
  s.mainWager[seat] = 0; s.sideWager[seat] = 0;
}

/**
 * After a settle, reconcile each human seat's net change to the wallet. Runs
 * serialized per table (see header) and advances the baseline before awaiting.
 */
async function _syncAfterEvents(table, events) {
  if (!isCasino(table)) return;
  const s = st(table);
  // accumulate wagers seen this round (main vs side) for stat reporting + the desync guard
  for (const ev of events) {
    if (ev.type === 'bet' && ev.amount != null) {
      if (ev.side) s.sideWager[ev.seat] = (s.sideWager[ev.seat] || 0) + ev.amount;
      else s.mainWager[ev.seat] = (s.mainWager[ev.seat] || 0) + ev.amount;
    }
  }
  if (events.some((e) => e.type === 'sidebets') && !events.some((e) => e.type === 'settle')) {
    const m0 = table.variant._match ? table.variant._match(table) : null;
    for (let seat = 0; seat < table.seatCount; seat++) {
      const so = table.seats[seat]; if (!so || so.bot || !isWalletSeat(so.platformId)) continue;
      console.log(`[walletSync] side resolved (deferred) ${table.tableId} seat ${seat}: bankroll=${m0 && m0.bankrolls[seat]} baseline=${s.last[seat]} sideWager=${s.sideWager[seat] || 0} — awaiting main settle`);
    }
  }
  if (!events.some((e) => e.type === 'settle')) return;   // side bets sync with the main settle

  const m = table.variant._match ? table.variant._match(table) : null;
  if (!m || !Array.isArray(m.bankrolls)) return;

  for (let seat = 0; seat < table.seatCount; seat++) {
    const seatObj = table.seats[seat];
    if (!seatObj || seatObj.bot || !isWalletSeat(seatObj.platformId)) continue;
    const before = s.last[seat] != null ? s.last[seat] : m.bankrolls[seat];
    const after = m.bankrolls[seat];
    const ops = roundOps(before, after);
    if (ops.kind === 'push') { s.last[seat] = after; continue; }

    const mainWager = s.mainWager[seat] || 0;
    const totalWager = mainWager + (s.sideWager[seat] || 0);

    // DESYNC GUARD: a loss far larger than the round's wager means the baseline
    // drifted from the engine bankroll (e.g., a reaped+recreated table). Never
    // drain on that — resync from the wallet and move on.
    if (ops.kind === 'loss' && ops.debit > 2000 && ops.debit > 8 * (totalWager + 10) + 50) {
      console.warn(`[walletSync] desync guard tripped on ${table.tableId} seat ${seat}: ` +
                   `would debit ${ops.debit} vs wager ${totalWager} (before=${before} after=${after}) — resyncing instead`);
      await _resync(table, m, s, seat, seatObj);
      continue;
    }

    // Advance the baseline NOW, before the awaited wallet call. If another
    // broadcast's reconcile runs while this awaits, it sees before==after and
    // no-ops — so the delta is applied exactly once.
    console.log(`[walletSync] reconcile ${table.tableId} seat ${seat}: before=${before} after=${after} net=${ops.delta} (${ops.kind}) mainWager=${mainWager} sideWager=${s.sideWager[seat] || 0}`);
    s.last[seat] = after;
    const meta = { tableId: table.tableId, delta: ops.delta, wager: totalWager };

    if (ops.kind === 'win') {
      // Parlor signal: record + queue notable wins so the 3D room can pop a
      // "BIG WIN" animation on that table from afar (privacy-safe: screen name only).
      if (ops.payout >= BIG_WIN) {
        const win = { tableId: table.tableId, game: table.variant.id, name: seatObj.displayName || 'Player', amount: ops.payout, ts: Date.now() };
        recentWins.set(table.tableId, win);
        pendingWins.push(win);
      }
      await settleChips(seatObj.platformId, {
        wager: mainWager, payout: ops.payout, game: table.variant.id, meta, displayName: seatObj.displayName,
      });
    } else if (ops.kind === 'loss') {
      await debitChips(seatObj.platformId, ops.debit, table.variant.id, meta, seatObj.displayName);
    }
    // re-pull authoritative balance so the engine + wallet stay in lockstep
    const w = await getChips(seatObj.platformId, seatObj.displayName);
    if (w && w.ok && typeof w.chips === 'number') { m.bankrolls[seat] = w.chips; s.last[seat] = w.chips; }
    seatObj.chips = m.bankrolls[seat];
    console.log(`[walletSync] post-settle ${table.tableId} seat ${seat}: wallet=${m.bankrolls[seat]} (applied ${ops.kind} ${ops.kind === 'win' ? '+' + ops.payout : ops.kind === 'loss' ? '-' + ops.debit : '0'})`);
    s.mainWager[seat] = 0;
    s.sideWager[seat] = 0;
  }
  table.scores = m.bankrolls.slice();
}
export async function syncAfterEvents(table, events) { return serialize(table.tableId, () => _syncAfterEvents(table, events)); }

export function clear(table) { if (table) { if (table._walletSync) table._walletSync = null; chains.delete(table.tableId); } }

// --- parlor big-win feed (for the 3D room's from-afar win animations) ---
const BIG_WIN = 150;                  // chips; below this it's not "notable"
const recentWins = new Map();         // tableId -> { tableId, game, name, amount, ts } (latest notable)
const pendingWins = [];               // FIFO of new wins the socket layer hasn't emitted yet
export function drainPendingWins() { const out = pendingWins.splice(0, pendingWins.length); return out; }
export function getRecentWin(tableId, maxAgeMs = 30000) {
  const w = recentWins.get(tableId);
  return (w && Date.now() - w.ts <= maxAgeMs) ? w : null;
}
