/**
 * Mahjong — 4-player draw-discard with CLAIMING (pung, kong, chow, ron) on the
 * tile engine (136-tile set, no bonus).
 *
 * The platform runtime drives one active seat at a time (currentTurn → one seat,
 * submit checks it). Rather than a simultaneous claim window, we resolve claims
 * SEQUENTIALLY in priority order, which fits that contract exactly:
 *
 *   • A seat discards. We compute every other seat's possible claims:
 *       ron  (win on the discard)        — any seat, highest priority
 *       pung/kong (3/4 of a kind)         — any seat, next
 *       chow (run of 3)                   — ONLY the seat to the discarder's left
 *   • Claimants are queued by priority; currentTurn points at the head. Each may
 *     CLAIM (their best option) or PASS. A claim short-circuits the queue.
 *   • If everyone passes, play proceeds to the next seat to draw.
 *
 * Claiming a pung/chow exposes the meld and the claimant must then discard (no
 * draw). A kong also draws a replacement first. A hand wins when concealed tiles
 * + exposed melds form four melds + a pair (ron = winning on a discard; tsumo =
 * winning on your own draw). First to winScore points wins the match.
 */
import { buildMahjongSet, shuffle, deal, tileCode } from '../engine/index.js';
import cfg from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

// ---- decomposition helpers (suit runs/triplets + honor triplets + one pair) ----
function tally(tiles) {
  const suited = { bamboo: new Array(9).fill(0), circle: new Array(9).fill(0), character: new Array(9).fill(0) };
  const honors = {};
  for (const t of tiles) {
    if (t.kind === 'suit') suited[t.suit][t.rank - 1] += 1;
    else honors[t.code] = (honors[t.code] || 0) + 1;
  }
  return { suited, honors };
}
function suitDecomposes(counts) {
  const c = counts.slice();
  function rec(i) {
    while (i < 9 && c[i] === 0) i++;
    if (i >= 9) return true;
    if (c[i] >= 3) { c[i] -= 3; if (rec(i)) return true; c[i] += 3; }
    if (i <= 6 && c[i] > 0 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--; if (rec(i)) return true; c[i]++; c[i + 1]++; c[i + 2]++;
    }
    return false;
  }
  return rec(0);
}
function honorsAllPungs(honors) { return Object.values(honors).every((n) => n % 3 === 0); }

// Can `tiles` split into exactly one pair + the rest all melds? (length must fit)
function decomposesToMeldsPlusPair(tiles) {
  if (tiles.length % 3 !== 2) return false;
  const { suited, honors } = tally(tiles);
  const trySuitedPair = () => {
    for (const suit of Object.keys(suited)) {
      const arr = suited[suit];
      for (let r = 0; r < 9; r++) {
        if (arr[r] >= 2) {
          arr[r] -= 2;
          const ok = suitDecomposes(suited.bamboo) && suitDecomposes(suited.circle) && suitDecomposes(suited.character) && honorsAllPungs(honors);
          arr[r] += 2;
          if (ok) return true;
        }
      }
    }
    return false;
  };
  if (trySuitedPair()) return true;
  for (const code of Object.keys(honors)) {
    if (honors[code] >= 2) {
      honors[code] -= 2;
      const ok = suitDecomposes(suited.bamboo) && suitDecomposes(suited.circle) && suitDecomposes(suited.character) && honorsAllPungs(honors);
      honors[code] += 2;
      if (ok) return true;
    }
  }
  return false;
}

// Concealed tiles + exposedMeldCount form a complete hand?
function handComplete(concealed, exposedMeldCount) {
  const need = 4 - exposedMeldCount;
  if (need < 0) return false;
  if (concealed.length !== need * 3 + 2) return false;
  return decomposesToMeldsPlusPair(concealed);
}
// 14-tile concealed convenience (kept for the smoke test import)
export function isWinningHand(tiles) { return tiles.length === 14 && decomposesToMeldsPlusPair(tiles); }

function completeness(concealed, exposedMeldCount) {
  let score = exposedMeldCount * 3;
  const { suited, honors } = tally(concealed);
  for (const suit of Object.keys(suited)) {
    const c = suited[suit].slice();
    for (let i = 0; i < 9; i++) { while (c[i] >= 3) { c[i] -= 3; score += 3; } }
    for (let i = 0; i <= 6; i++) { while (c[i] > 0 && c[i + 1] > 0 && c[i + 2] > 0) { c[i]--; c[i + 1]--; c[i + 2]--; score += 3; } }
    for (let i = 0; i < 9; i++) if (c[i] >= 2) score += 1;
  }
  for (const n of Object.values(honors)) score += Math.floor(n / 3) * 3 + (n % 3 === 2 ? 1 : 0);
  return score;
}
function usefulness(tile, tiles) {
  if (tile.kind !== 'suit') return tiles.filter((t) => t.code === tile.code).length * 2;
  const sameSuit = tiles.filter((t) => t.kind === 'suit' && t.suit === tile.suit);
  const dup = sameSuit.filter((t) => t.rank === tile.rank).length;
  const adj = sameSuit.filter((t) => Math.abs(t.rank - tile.rank) === 1).length;
  return dup * 2 + adj;
}

// ---- claim detection on a discard ----
function countCode(tiles, code) { return tiles.filter((t) => t.code === code).length; }
// chow partner pairs in `tiles` that complete a run with the discarded suit-tile
function chowOptions(tiles, disc) {
  if (disc.kind !== 'suit') return [];
  const r = disc.rank, suit = disc.suit;
  const has = (rank) => tiles.find((t) => t.kind === 'suit' && t.suit === suit && t.rank === rank);
  const opts = [];
  const combos = [[r - 2, r - 1], [r - 1, r + 1], [r + 1, r + 2]];
  for (const [a, b] of combos) {
    if (a < 1 || b > 9) continue;
    const ta = has(a), tb = has(b);
    if (ta && tb) opts.push([ta, tb]);
  }
  return opts;
}

const mahjong = {
  id: 'mahjong',
  name: 'Mahjong',
  meta: cfg,
  catalog,
  defaults: { winScore: cfg.scoring.winScore, wallPer: cfg.deal.wallPer },

  _match(table) {
    if (!table._mj) table._mj = { points: [0, 0, 0, 0], handNo: 0 };
    return table._mj;
  },

  startHand(table, rng) {
    const m = this._match(table);
    m.handNo += 1;
    const wall = shuffle(buildMahjongSet({ bonus: false }), rng);
    const { hands, rest } = deal(wall, { players: 4, tilesPer: table.config.wallPer });
    table.hand = {
      phase: 'turn',          // 'turn' | 'claim'
      hands, wall: rest,
      melds: [[], [], [], []],   // exposed melds per seat: {type, tiles:[code]}
      turn: (table.dealer + 1) % 4,
      drawn: null,
      discards: [],
      lastDiscard: null,      // { seat, tile }
      claimQueue: [],         // [{ seat, kind:'win'|'kong'|'pung'|'chow', tiles?:[tileObj] }]
      claimIdx: 0,
      match: m,
    };
    return table.hand;
  },

  // During a claim phase the active seat is the head of the queue; otherwise the
  // normal turn holder.
  currentTurn(table) {
    const h = table.hand; if (!h) return null;
    if (h.phase === 'claim') { const c = h.claimQueue[h.claimIdx]; return c ? c.seat : null; }
    return h.turn;
  },
  botSeatsToAct(table) { const s = this.currentTurn(table); return s == null ? [] : [s]; },

  // Build the priority-ordered claim queue for a freshly discarded tile.
  _buildClaims(table, h, discSeat, disc) {
    const q = [];
    for (let off = 1; off <= 3; off++) {
      const seat = (discSeat + off) % 4;
      const hand = h.hands[seat];
      const exposed = h.melds[seat].length;
      // ron: concealed + disc completes the hand
      if (handComplete(hand.concat(disc), exposed)) q.push({ seat, kind: 'win', prio: 3 });
    }
    for (let seat = 0; seat < 4; seat++) {
      if (seat === discSeat) continue;
      const hand = h.hands[seat];
      const same = countCode(hand, disc.code);
      if (same >= 3) q.push({ seat, kind: 'kong', prio: 2 });
      else if (same >= 2) q.push({ seat, kind: 'pung', prio: 2 });
    }
    // chow: only the seat immediately after the discarder
    const left = (discSeat + 1) % 4;
    const chows = chowOptions(h.hands[left], disc);
    if (chows.length) q.push({ seat: left, kind: 'chow', prio: 1, chows });
    // order by priority desc, then by seat distance from discarder (closer first)
    q.sort((a, b) => b.prio - a.prio || ((a.seat - discSeat + 4) % 4) - ((b.seat - discSeat + 4) % 4));
    return q;
  },

  legalActions(table, seat) {
    const h = table.hand; if (!h) return [];
    if (h.phase === 'claim') {
      const c = h.claimQueue[h.claimIdx];
      if (!c || c.seat !== seat) return [];
      const acts = [{ type: 'pass' }];
      const disc = h.lastDiscard.tile;
      if (c.kind === 'win') acts.unshift({ type: 'claimWin' });
      else if (c.kind === 'kong') acts.unshift({ type: 'kong', tile: disc.code });
      else if (c.kind === 'pung') acts.unshift({ type: 'pung', tile: disc.code });
      else if (c.kind === 'chow') {
        for (const pair of c.chows) acts.unshift({ type: 'chow', tile: disc.code, with: pair.map((t) => t.code) });
      }
      return acts;
    }
    // normal turn
    if (seat !== h.turn) return [];
    if (h.drawn == null) return h.wall.length ? [{ type: 'draw' }] : [];
    const acts = h.hands[seat].map((t) => ({ type: 'discard', tile: tileCode(t), id: t.id }));
    if (handComplete(h.hands[seat], h.melds[seat].length)) acts.unshift({ type: 'win' });
    return acts;
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h) return { ok: false, error: 'no hand' };
    if (seat !== this.currentTurn(table)) return { ok: false, error: 'not your turn' };
    if (!action || !action.type) return { ok: false, error: 'no action' };
    const events = [];

    // ---------- claim phase ----------
    if (h.phase === 'claim') {
      const c = h.claimQueue[h.claimIdx];
      const disc = h.lastDiscard.tile;

      if (action.type === 'pass') {
        h.claimIdx += 1;
        if (h.claimIdx >= h.claimQueue.length) return this._afterClaimsPass(table, h, events);
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type === 'claimWin') {
        if (c.kind !== 'win') return { ok: false, error: 'cannot win on this tile' };
        h.hands[seat] = h.hands[seat].concat(disc);          // ron: take the discard
        return this._scoreWin(table, h, seat, events, 'ron');
      }
      if (action.type === 'pung' || action.type === 'kong') {
        const need = action.type === 'kong' ? 3 : 2;
        const taken = [];
        for (let i = h.hands[seat].length - 1; i >= 0 && taken.length < need; i--) {
          if (h.hands[seat][i].code === disc.code) taken.push(h.hands[seat].splice(i, 1)[0]);
        }
        if (taken.length < need) { h.hands[seat].push(...taken); return { ok: false, error: 'not enough tiles' }; }
        h.melds[seat].push({ type: action.type, tiles: [...taken.map(tileCode), disc.code] });
        events.push({ type: 'claimed', seat, kind: action.type, tile: disc.code, from: h.lastDiscard.seat });
        if (action.type === 'kong') {
          // replacement draw, then discard
          if (h.wall.length) { const [rep] = h.wall.splice(0, 1); h.hands[seat].push(rep); h.drawn = rep; events.push({ type: 'drew', seat, wall: h.wall.length, kong: true }); }
        }
        return this._enterDiscard(table, h, seat, events);
      }
      if (action.type === 'chow') {
        if (c.kind !== 'chow') return { ok: false, error: 'cannot chow' };
        const withCodes = action.with || [];
        const taken = [];
        for (const code of withCodes) {
          const i = h.hands[seat].findIndex((t) => t.code === code && !taken.includes(t));
          if (i >= 0) taken.push(h.hands[seat][i]);
        }
        if (taken.length !== 2) return { ok: false, error: 'chow tiles not in hand' };
        for (const t of taken) h.hands[seat].splice(h.hands[seat].indexOf(t), 1);
        h.melds[seat].push({ type: 'chow', tiles: [...taken.map(tileCode), disc.code] });
        events.push({ type: 'claimed', seat, kind: 'chow', tile: disc.code, from: h.lastDiscard.seat });
        return this._enterDiscard(table, h, seat, events);
      }
      return { ok: false, error: `bad claim ${action.type}` };
    }

    // ---------- normal turn ----------
    if (action.type === 'draw') {
      if (h.drawn != null) return { ok: false, error: 'already drew' };
      if (!h.wall.length) return this._exhaust(table, h, events);
      const [t] = h.wall.splice(0, 1);
      h.hands[seat].push(t); h.drawn = t;
      events.push({ type: 'drew', seat, wall: h.wall.length });
      return { ok: true, events, handOver: false, gameOver: false };
    }
    if (action.type === 'win') {
      if (!handComplete(h.hands[seat], h.melds[seat].length)) return { ok: false, error: 'not a winning hand' };
      return this._scoreWin(table, h, seat, events, 'tsumo');
    }
    if (action.type === 'discard') {
      if (h.drawn == null) return { ok: false, error: 'draw first' };
      const idx = h.hands[seat].findIndex((t) => t.id === action.id || tileCode(t) === action.tile);
      if (idx < 0) return { ok: false, error: 'tile not in hand' };
      const [t] = h.hands[seat].splice(idx, 1);
      h.discards.push(t); h.drawn = null;
      h.lastDiscard = { seat, tile: t };
      events.push({ type: 'discarded', seat, tile: tileCode(t) });
      // open a claim window
      const q = this._buildClaims(table, h, seat, t);
      if (q.length) {
        h.phase = 'claim'; h.claimQueue = q; h.claimIdx = 0;
        events.push({ type: 'claimOpen', tile: tileCode(t), from: seat, claimants: q.map((x) => ({ seat: x.seat, kind: x.kind })) });
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (!h.wall.length) return this._exhaust(table, h, events);
      h.turn = (seat + 1) % 4;
      return { ok: true, events, handOver: false, gameOver: false };
    }
    return { ok: false, error: `bad action ${action.type}` };
  },

  // all claimants passed → next seat after the discarder draws
  _afterClaimsPass(table, h, events) {
    h.phase = 'turn'; h.claimQueue = []; h.claimIdx = 0;
    if (!h.wall.length) return this._exhaust(table, h, events);
    h.turn = (h.lastDiscard.seat + 1) % 4;
    events.push({ type: 'claimPassed', turn: h.turn });
    return { ok: true, events, handOver: false, gameOver: false };
  },
  // a claimant took the tile → they hold it and must discard (no draw)
  _enterDiscard(table, h, seat, events) {
    h.phase = 'turn'; h.claimQueue = []; h.claimIdx = 0;
    h.turn = seat;
    if (h.drawn == null) h.drawn = h.lastDiscard.tile;   // marks "must discard, don't draw"
    events.push({ type: 'mustDiscard', seat });
    return { ok: true, events, handOver: false, gameOver: false };
  },

  _scoreWin(table, h, seat, events, how) {
    const m = h.match;
    m.points[seat] += cfg.scoring.win;
    table.scores = m.points.slice();
    events.push({ type: 'mahjong', seat, how: how || 'tsumo', points: m.points.slice() });
    const gameOver = m.points.some((p) => p >= table.config.winScore);
    if (gameOver) { table._mjResult = { points: m.points.slice(), winnerSeat: seat }; events.push({ type: 'gameWon', winnerSeat: seat, points: m.points.slice() }); }
    return { ok: true, events, handOver: !gameOver, gameOver };
  },
  _exhaust(table, h, events) {
    const m = h.match;
    let best = 0, bestScore = -1;
    for (let s = 0; s < 4; s++) { const c = completeness(h.hands[s], h.melds[s].length); if (c > bestScore) { bestScore = c; best = s; } }
    m.points[best] += cfg.scoring.wash;
    table.scores = m.points.slice();
    events.push({ type: 'wallExhausted', closest: best, points: m.points.slice() });
    const gameOver = m.points.some((p) => p >= table.config.winScore);
    if (gameOver) { table._mjResult = { points: m.points.slice(), winnerSeat: best }; events.push({ type: 'gameWon', winnerSeat: best, points: m.points.slice() }); }
    return { ok: true, events, handOver: !gameOver, gameOver };
  },

  gameResult(table) {
    const r = table._mjResult || { points: this._match(table).points, winnerSeat: 0 };
    return { mode: 'individual', winnerSeat: r.winnerSeat, totals: r.points };
  },
  resetMatch(table) { table._mj = { points: [0, 0, 0, 0], handNo: 0 }; table._mjResult = null; },

  publicView(table) {
    const h = table.hand;
    if (!h) return { phase: 'lobby' };
    return {
      phase: h.phase, turn: this.currentTurn(table), dealer: table.dealer,
      wall: h.wall.length,
      handCounts: h.hands.map((hh) => hh.length),
      melds: h.melds.map((ms) => ms.map((md) => ({ type: md.type, tiles: md.tiles }))),
      lastDiscards: h.discards.slice(-8).map(tileCode),
      claim: h.phase === 'claim' ? { tile: tileCode(h.lastDiscard.tile), from: h.lastDiscard.seat, waitingOn: this.currentTurn(table) } : null,
      points: h.match.points.slice(), winScore: table.config.winScore,
    };
  },
  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, hand: [], legal: [] };
    const active = this.currentTurn(table);
    return {
      seat, phase: h.phase, turn: active, yourTurn: active === seat,
      hand: (h.hands[seat] || []).map(tileCode),
      melds: (h.melds[seat] || []).map((md) => ({ type: md.type, tiles: md.tiles })),
      drew: h.phase === 'turn' && h.turn === seat && h.drawn ? tileCode(h.drawn) : null,
      claiming: h.phase === 'claim' && active === seat ? { tile: tileCode(h.lastDiscard.tile), from: h.lastDiscard.seat } : null,
      legal: this.legalActions(table, seat),
      wall: h.wall.length,
    };
  },

  botAction(table, seat) {
    const h = table.hand; if (!h) return null;
    const active = this.currentTurn(table);
    if (active !== seat) return null;

    if (h.phase === 'claim') {
      const legal = this.legalActions(table, seat);
      // bots always take a win; otherwise claim pung/kong opportunistically, skip chow
      const win = legal.find((a) => a.type === 'claimWin'); if (win) return win;
      const pk = legal.find((a) => a.type === 'kong' || a.type === 'pung');
      if (pk && Math.random() < 0.6) return pk;     // claim most of the time
      return { type: 'pass' };
    }

    if (h.drawn == null) return h.wall.length ? { type: 'draw' } : null;
    if (handComplete(h.hands[seat], h.melds[seat].length)) return { type: 'win' };
    const hand = h.hands[seat];
    let worst = hand[0], worstU = Infinity;
    for (const t of hand) { const u = usefulness(t, hand); if (u < worstU) { worstU = u; worst = t; } }
    return { type: 'discard', tile: tileCode(worst), id: worst.id };
  },
};

export default mahjong;
