/**
 * Roulette — European single-zero wheel (37 pockets). Bet → spin → settle, on a
 * CONTINUOUS table (rounds cycle until players leave).
 *
 * Each seat may stack MULTIPLE bets in the betting window, then `done`:
 *   outside (1:1):  red/black, even/odd, low/high
 *   2:1:            dozen1/2/3, col1/2/3
 *   inside:         straight number (35:1), and multi-number bets carrying a
 *                   `nums` array — split (2 → 17:1), street (3 → 11:1),
 *                   corner (4 → 8:1), line/double-street (6 → 5:1)
 * Payout is (matching numbers) chosen so total return = stake * (36/coverage),
 * i.e. profit:stake of 35,17,11,8,5,2,1 for 1,2,3,4,6,12,18-number coverage.
 */
import cfg from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function colorOf(n) { return n === 0 ? 'green' : (RED.has(n) ? 'red' : 'black'); }
const OUTSIDES = ['red', 'black', 'even', 'odd', 'low', 'high'];
const TWO_TO_ONE = ['dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3'];
const INSIDE = ['number', 'split', 'street', 'corner', 'line'];
const ALL_SIDES = OUTSIDES.concat(TWO_TO_ONE, INSIDE);

// profit multiplier by how many numbers a bet covers (European, 36/cover - 1)
const PAYOUT_BY_COVER = { 1: 35, 2: 17, 3: 11, 4: 8, 6: 5, 12: 2, 18: 1 };

// validate that a `nums` array is a legal adjacency on the standard layout.
// We keep it permissive-but-sane: right count + all in range + (for multi) the
// numbers form a contiguous block by the table grid (3 columns × 12 rows).
function rowOf(n) { return Math.ceil(n / 3); }              // 1..12
function colOf(n) { return ((n - 1) % 3) + 1; }             // 1..3
function validInside(side, nums) {
  if (!Array.isArray(nums)) return false;
  const u = [...new Set(nums)];
  if (u.some((x) => !Number.isInteger(x) || x < 0 || x > 36)) return false;
  if (side === 'split' && u.length === 2) {
    const [a, b] = u.slice().sort((x, y) => x - y);
    if (a === 0) return [1, 2, 3].includes(b);              // 0 splits
    // horizontal neighbor (same row, adjacent col) or vertical (col same, row±1)
    if (rowOf(a) === rowOf(b) && Math.abs(colOf(a) - colOf(b)) === 1) return true;
    if (colOf(a) === colOf(b) && Math.abs(rowOf(a) - rowOf(b)) === 1) return true;
    return false;
  }
  if (side === 'street' && u.length === 3) {
    const r = rowOf(u[0]);
    return u.every((x) => rowOf(x) === r) && new Set(u.map(colOf)).size === 3;
  }
  if (side === 'corner' && u.length === 4) {
    const rows = [...new Set(u.map(rowOf))].sort((a, b) => a - b);
    const cols = [...new Set(u.map(colOf))].sort((a, b) => a - b);
    return rows.length === 2 && cols.length === 2 && rows[1] - rows[0] === 1 && cols[1] - cols[0] === 1;
  }
  if (side === 'line' && u.length === 6) {
    const rows = [...new Set(u.map(rowOf))].sort((a, b) => a - b);
    return rows.length === 2 && rows[1] - rows[0] === 1 && new Set(u.map(colOf)).size === 3;
  }
  return false;
}

function betWins(bet, n) {
  const { side } = bet;
  if (INSIDE.includes(side)) {
    if (side === 'number') return n === bet.n;
    return Array.isArray(bet.nums) && bet.nums.includes(n);
  }
  if (n === 0) return false;                                 // outsides/2:1 all lose on 0
  switch (side) {
    case 'red': return colorOf(n) === 'red';
    case 'black': return colorOf(n) === 'black';
    case 'even': return n % 2 === 0;
    case 'odd': return n % 2 === 1;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19 && n <= 36;
    case 'dozen1': return n >= 1 && n <= 12;
    case 'dozen2': return n >= 13 && n <= 24;
    case 'dozen3': return n >= 25 && n <= 36;
    case 'col1': return n % 3 === 1;
    case 'col2': return n % 3 === 2;
    case 'col3': return n % 3 === 0;
    default: return false;
  }
}
function payoutMult(bet) {
  if (bet.side === 'number') return 35;
  if (bet.side === 'split') return 17;
  if (bet.side === 'street') return 11;
  if (bet.side === 'corner') return 8;
  if (bet.side === 'line') return 5;
  if (TWO_TO_ONE.includes(bet.side)) return 2;
  return 1;
}

const roulette = {
  id: 'roulette',
  name: 'Roulette',
  continuous: true,
  meta: cfg,
  catalog,
  defaults: { startChips: cfg.scoring.startChips, betSize: cfg.scoring.betSize },

  _match(table) {
    if (!table._roul) {
      table._roul = {
        bankrolls: new Array(table.seatCount).fill(table.config.startChips),
        handNo: 0,
        wins: new Array(table.seatCount).fill(0),     // rounds won (net positive)
        losses: new Array(table.seatCount).fill(0),   // rounds lost (net negative)
        net: new Array(table.seatCount).fill(0),      // cumulative chip net since sitting
      };
      table.scores = table._roul.bankrolls.slice();
    }
    // keep the stat arrays sized to the table (seat count is stable, but be safe)
    const _m = table._roul;
    for (const k of ['wins', 'losses', 'net']) {
      if (!_m[k]) _m[k] = new Array(table.seatCount).fill(0);
    }
    return table._roul;
  },
  _staked(h, seat) { return h.bets[seat].reduce((a, b) => a + b.amount, 0); },
  _firstBetter(table) {
    const h = table.hand;
    for (let s = 0; s < table.seatCount; s++) if (h.match.bankrolls[s] > 0 && !h.locked[s]) return s;
    return null;
  },

  startHand(table, rng) {
    const m = this._match(table);
    m.handNo += 1;
    table.hand = {
      phase: 'bets',
      bets: Array.from({ length: table.seatCount }, () => []),
      locked: new Array(table.seatCount).fill(false),
      lastPocket: null, turn: null, _rng: rng, match: m,
    };
    table.hand.turn = this._firstBetter(table);
    return table.hand;
  },

  // LIVE simultaneous betting: no round-robin. There is no single "current turn"
  // during bets — every un-locked solvent seat may bet at any time.
  currentTurn(table) { return null; },
  _unlockedSeats(table) {
    const h = table.hand; const out = [];
    if (!h || h.phase !== 'bets') return out;
    for (let s = 0; s < table.seatCount; s++) if (h.match.bankrolls[s] > 0 && !h.locked[s]) out.push(s);
    return out;
  },
  // every un-locked BOT seat acts (they place a bet then lock) — all at once.
  botSeatsToAct(table) {
    const h = table.hand; if (!h || h.phase !== 'bets') return [];
    return this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot);
  },

  legalActions(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'bets') return [];
    if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return [];   // already done / broke
    const free = h.match.bankrolls[seat] - this._staked(h, seat);
    const amount = Math.min(free, table.config.betSize);
    const acts = [];
    if (amount > 0) for (const side of OUTSIDES) acts.push({ type: 'bet', side, amount });
    acts.push({ type: 'done' });
    // inside bets (number/split/street/corner/line) accepted but not enumerated here
    return acts;
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h) return { ok: false, error: 'no hand' };
    if (h.phase !== 'bets') return { ok: false, error: 'not betting' };
    if (h.locked[seat]) return { ok: false, error: 'already locked in' };
    if (!action) return { ok: false, error: 'no action' };

    if (action.type === 'done') {
      h.locked[seat] = true;
      // spin once EVERY solvent seat has locked in (live betting — order doesn't matter)
      if (this._unlockedSeats(table).length === 0) return this._spin(table, h, []);
      return { ok: true, events: [{ type: 'locked', seat }], handOver: false, gameOver: false };
    }
    if (action.type !== 'bet') return { ok: false, error: 'expected bet or done' };

    const side = action.side;
    const bet = { side, amount: 0 };
    if (side === 'number') {
      const n = Number(action.n);
      if (!Number.isInteger(n) || n < 0 || n > 36) return { ok: false, error: 'number must be 0..36' };
      bet.n = n;
    } else if (['split', 'street', 'corner', 'line'].includes(side)) {
      const nums = (action.nums || []).map(Number);
      if (!validInside(side, nums)) return { ok: false, error: `invalid ${side}` };
      bet.nums = [...new Set(nums)];
    } else if (!OUTSIDES.includes(side) && !TWO_TO_ONE.includes(side)) {
      return { ok: false, error: 'bad bet side' };
    }
    const free = h.match.bankrolls[seat] - this._staked(h, seat);
    const amount = Math.max(0, Math.min(free, action.amount || table.config.betSize));
    if (amount <= 0) return { ok: false, error: 'insufficient' };
    bet.amount = amount;
    h.bets[seat].push(bet);
    const events = [{ type: 'bet', seat, side, n: bet.n, nums: bet.nums, amount }];
    return { ok: true, events, handOver: false, gameOver: false };  // stay on seat to stack more
  },

  _spin(table, h, events) {
    const m = h.match;
    const pocket = Math.floor(h._rng() * cfg.pockets);   // 0..36
    h.lastPocket = pocket;
    m.lastPocket = pocket; m.lastColor = colorOf(pocket);   // persist across hands (continuous)
    events.push({ type: 'spin', pocket, color: colorOf(pocket) });
    const before = m.bankrolls.slice();
    const wonBets = [];   // {seat, idx} of bets that WON — client keeps these up before raking
    for (let s = 0; s < table.seatCount; s++) {
      h.bets[s].forEach((bet, idx) => {
        if (betWins(bet, pocket)) { m.bankrolls[s] += bet.amount * payoutMult(bet); wonBets.push({ seat: s, idx }); }
        else m.bankrolls[s] -= bet.amount;
      });
    }
    const deltas = m.bankrolls.map((v, i) => v - before[i]);
    // update cumulative stats per seat (only seats that had action this round)
    for (let s = 0; s < table.seatCount; s++) {
      if (!h.bets[s].length) continue;
      m.net[s] += deltas[s];
      if (deltas[s] > 0) m.wins[s] += 1; else if (deltas[s] < 0) m.losses[s] += 1;
    }
    table.scores = m.bankrolls.slice();
    events.push({
      type: 'settle', pocket, color: colorOf(pocket),
      bankrolls: m.bankrolls.slice(), deltas, wonBets,
      stats: { wins: m.wins.slice(), losses: m.losses.slice(), net: m.net.slice() },
    });
    return { ok: true, events, handOver: true, gameOver: false };   // continuous
  },

  gameResult(table) {
    const m = this._match(table);
    let w = 0; for (let s = 1; s < table.seatCount; s++) if (m.bankrolls[s] > m.bankrolls[w]) w = s;
    return { mode: 'individual', winnerSeat: w, totals: m.bankrolls.slice() };
  },
  resetMatch(table) {
    table._roul = {
      bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0,
      wins: new Array(table.seatCount).fill(0), losses: new Array(table.seatCount).fill(0),
      net: new Array(table.seatCount).fill(0),
    };
    table.scores = table._roul.bankrolls.slice();
  },

  publicView(table) {
    const h = table.hand;
    if (!h) return { phase: 'lobby' };
    return {
      phase: h.phase, turn: null, locked: h.locked.slice(),
      lastPocket: (h.match.lastPocket != null ? h.match.lastPocket : h.lastPocket),
      lastColor: (h.match.lastColor != null ? h.match.lastColor : (h.lastPocket == null ? null : colorOf(h.lastPocket))),
      bets: h.bets.map((arr) => arr.map((b) => ({ side: b.side, n: b.n, nums: b.nums, amount: b.amount }))),
      bankrolls: h.match.bankrolls.slice(), round: h.match.handNo, continuous: true,
      stats: {
        wins: (h.match.wins || []).slice(),
        losses: (h.match.losses || []).slice(),
        net: (h.match.net || []).slice(),
      },
    };
  },
  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, legal: [] };
    return {
      seat, phase: h.phase, turn: null,
      yourTurn: h.phase === 'bets' && !h.locked[seat] && h.match.bankrolls[seat] > 0,
      locked: h.locked[seat],
      bankroll: h.match.bankrolls[seat], myBets: h.bets[seat],
      legal: this.legalActions(table, seat),
    };
  },

  // SPREAD BOT BETS — bots build a small varied portfolio then lock.
  _botBetTarget(seat) {
    // deterministic-ish per seat so each bot has a "style", with some randomness
    const styles = [
      ['red', 'black', 'even', 'odd', 'low', 'high'],          // outside-lover
      ['dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3'],  // dozens/columns
      ['number', 'number', 'split', 'red', 'dozen2'],          // inside-leaning
      ['red', 'dozen1', 'number', 'high', 'col3'],             // mixed
    ];
    const style = styles[seat % styles.length];
    return style[Math.floor(Math.random() * style.length)];
  },
  _randomInside(side) {
    if (side === 'number') return { n: Math.floor(Math.random() * 37) };          // 0..36
    if (side === 'split') {
      // pick a random horizontal split (n, n+1) in the same row
      const row = Math.floor(Math.random() * 12); const col = Math.floor(Math.random() * 2);
      const a = row * 3 + col + 1; return { nums: [a, a + 1] };
    }
    return {};
  },
  botAction(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'bets' || h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
    const mine = h.bets[seat];
    // how many bets this bot wants this round (1..3), decided once and stored
    if (h._botPlan == null) h._botPlan = {};
    if (h._botPlan[seat] == null) h._botPlan[seat] = 1 + Math.floor(Math.random() * 3);
    const want = h._botPlan[seat];
    if (mine.length >= want) return { type: 'done' };
    const free = h.match.bankrolls[seat] - this._staked(h, seat);
    if (free <= 0) return { type: 'done' };
    const amount = Math.min(free, table.config.betSize);
    if (amount <= 0) return { type: 'done' };
    const side = this._botBetTarget(seat);
    if (side === 'number' || side === 'split') {
      return { type: 'bet', side, amount, ...this._randomInside(side) };
    }
    return { type: 'bet', side, amount };
  },
};

export default roulette;
export { colorOf, betWins, validInside, payoutMult };
