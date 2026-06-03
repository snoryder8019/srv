/**
 * Dominoes — Block/Draw Dominoes inside the tiles platform, now with optional
 * SPINNERS (doubles that branch the line in up to four directions).
 * (/srv/tiles is the scaffolding; this folder is the variant + its config.)
 *
 * Implements the tiles-platform variant contract. The engine (../engine) owns the
 * tile set + boneyard shuffle/deal/draw; dominoes owns the rules: who opens, what
 * matches an open end, drawing when stuck, passing when blocked, going out, and
 * scoring opponents' pips toward a match target.
 *
 * --- Board model (generalized for spinners) ---
 * The board is a set of open ENDS, each: { id, pip, kind }.
 *   kind 'line'  -> the two primary growth directions ('L','R')
 *   kind 'spin'  -> the perpendicular arms off a spinner double ('T','B')
 * A bone {a,b} (a>=b) plays on an end with exposed pip P if a===P or b===P; the
 * bone's OTHER face becomes that end's new exposed pip. Doubles are placed
 * crosswise (rendered rotated) and score/sequence identically.
 *
 * Spinner rule is chosen by the host at setup (table.config.spinnerRule):
 *   'first' (default) - only the FIRST double played is a spinner
 *   'all'             - every double is a spinner
 *   'none'            - doubles are ordinary; classic single line, two ends
 * Classic constraint: a spinner's perpendicular arms (T/B) only OPEN once BOTH
 * primary line ends (L and R) have been built on past the spinner — i.e. the main
 * line is established first, then play may branch off the spinner.
 *
 * Each placed piece in `line[]` carries a `branch` tag ('main'|'T'|'B') and order
 * so a 2D or 3D client can lay the chain out with arms. Cumulative match state
 * lives on table._domMatch; per-hand state on table.hand.
 */
import { buildDominoSet, shuffle, deal, draw, tileCode, rngFromSeed } from '../engine/index.js';
import cfg from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

const pip = (t) => t.a + t.b;
const handPips = (hand) => hand.reduce((s, t) => s + pip(t), 0);

// Can bone t attach to exposed pip P? returns the OTHER face (new end) or null.
function matchFace(t, P) {
  if (t.a === P) return t.b;
  if (t.b === P) return t.a;
  return null;
}

const dominoes = {
  id: 'dominoes',
  name: 'Dominoes',
  meta: cfg,
  catalog,
  defaults: {
    target: cfg.rules.target,
    drawGame: cfg.rules.drawGame,
    spinnerRule: cfg.rules.spinnerRule || 'first',
  },

  _ensureMatch(table) {
    if (!table._domMatch) table._domMatch = { totals: new Array(table.seatCount).fill(0), handNo: 0 };
    return table._domMatch;
  },

  _spinnerRule(table) {
    const r = (table.config && table.config.spinnerRule) || cfg.rules.spinnerRule || 'first';
    return (r === 'all' || r === 'none') ? r : 'first';
  },

  startHand(table, rng) {
    const match = this._ensureMatch(table);
    match.handNo += 1;
    const seats = table.seatCount;
    const bag = shuffle(buildDominoSet(cfg.set.max), rng);
    const { hands, rest } = deal(bag, { players: seats, tilesPer: cfg.deal.tilesPer });

    // Opener: highest double held; else the highest bone (by pips then high face).
    let opener = 0, openBone = null;
    const rank = (t) => (t.double ? 1000 : 0) + t.pips * 10 + t.a;
    for (let s = 0; s < seats; s++) {
      for (const t of hands[s]) {
        if (!openBone || rank(t) > rank(openBone)) { openBone = t; opener = s; }
      }
    }

    table.hand = {
      phase: 'playing',
      hands,
      boneyard: rest,
      line: [],                 // ordered placed pieces: { code,a,b,double,branch,order }
      ends: [],                 // open ends: { id, pip, kind:'line'|'spin' }
      spinner: null,            // { code, pip } once a spinner double is placed
      spinnerArmsOpen: false,   // T/B playable yet?
      lineBuiltL: false, lineBuiltR: false, // has main line grown past the spinner each side?
      turn: opener,
      starter: opener,
      mustOpen: true,
      openCode: openBone ? tileCode(openBone) : null,
      passes: 0,
      tilesPlayed: 0,
      order: 0,
      match,
      result: null,
    };
    return table.hand;
  },

  currentTurn(table) {
    const h = table.hand;
    return (h && h.phase === 'playing') ? h.turn : null;
  },

  // Is a given double a spinner under the active rule?
  _isSpinner(table, h, t) {
    const rule = this._spinnerRule(table);
    if (rule === 'none' || !t.double) return false;
    if (rule === 'all') return true;
    return h.spinner == null; // 'first': only if no spinner established yet
  },

  // Recompute which ends are currently OPEN (and playable). Spinner arms (T/B)
  // only open once BOTH primary line ends have been extended past the spinner.
  _openEnds(h) {
    const arms = h.spinnerArmsOpen ? h.ends : h.ends.filter((e) => e.kind === 'line');
    return arms;
  },

  legalActions(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'playing' || seat !== h.turn) return [];
    const hand = h.hands[seat];

    if (h.mustOpen) {
      return [{ type: 'play', code: h.openCode, end: 'open' }];
    }

    const plays = [];
    const ends = this._openEnds(h);
    for (const t of hand) {
      for (const e of ends) {
        if (matchFace(t, e.pip) != null) plays.push({ type: 'play', code: tileCode(t), end: e.id });
      }
    }
    if (plays.length) return plays;
    if (table.config.drawGame !== false && cfg.rules.drawGame && h.boneyard.length) return [{ type: 'draw' }];
    return [{ type: 'pass' }];
  },

  // Open the spinner arms if the main line has grown on both L and R.
  _maybeOpenArms(h, events) {
    if (h.spinner && !h.spinnerArmsOpen && h.lineBuiltL && h.lineBuiltR) {
      h.spinnerArmsOpen = true;
      // add the two perpendicular arms, exposing the spinner's pip
      h.ends.push({ id: 'T', pip: h.spinner.pip, kind: 'spin' });
      h.ends.push({ id: 'B', pip: h.spinner.pip, kind: 'spin' });
      events.push({ type: 'spinnerOpen', pip: h.spinner.pip });
    }
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h || h.phase !== 'playing') return { ok: false, error: 'no hand in progress' };
    if (seat !== h.turn) return { ok: false, error: 'not your turn' };
    if (!action || !action.type) return { ok: false, error: 'no action' };
    const hand = h.hands[seat];
    const events = [];

    if (action.type === 'draw') {
      if (table.config.drawGame === false || !cfg.rules.drawGame || !h.boneyard.length) return { ok: false, error: 'cannot draw' };
      const { drawn, rest } = draw(h.boneyard, 1);
      h.boneyard = rest;
      hand.push(drawn[0]);
      events.push({ type: 'drew', seat, remaining: h.boneyard.length });
      return { ok: true, events, handOver: false, gameOver: false };
    }

    if (action.type === 'pass') {
      const ends = this._openEnds(h);
      const canPlay = hand.some((t) => ends.some((e) => matchFace(t, e.pip) != null));
      if (h.mustOpen || canPlay || (table.config.drawGame !== false && cfg.rules.drawGame && h.boneyard.length)) {
        return { ok: false, error: 'cannot pass — a move is available' };
      }
      h.passes += 1;
      events.push({ type: 'passed', seat });
      if (h.passes >= table.seatCount) return this._endHandBlocked(table, h, events);
      h.turn = table.next(seat);
      return { ok: true, events, handOver: false, gameOver: false };
    }

    if (action.type === 'play') {
      const idx = hand.findIndex((t) => tileCode(t) === action.code);
      if (idx < 0) return { ok: false, error: 'tile not in hand' };
      const t = hand[idx];

      // ---- opening move ----
      if (h.mustOpen) {
        if (action.code !== h.openCode) return { ok: false, error: 'must open with ' + h.openCode };
        hand.splice(idx, 1);
        h.order += 1;
        // opener exposes both faces: b toward L, a toward R. matchPip null (no parent).
        h.line.push({ code: t.code, a: t.a, b: t.b, double: t.double, branch: 'main', order: h.order,
                      on: 'open', matchPip: null, outerL: t.b, outerR: t.a });
        // primary line ends
        h.ends = [{ id: 'L', pip: t.b, kind: 'line' }, { id: 'R', pip: t.a, kind: 'line' }];
        // a double opener can be the spinner
        if (this._isSpinner(table, h, t)) { h.spinner = { code: t.code, pip: t.a }; h.lineBuiltL = false; h.lineBuiltR = false; }
        h.mustOpen = false; h.tilesPlayed += 1; h.passes = 0;
        events.push({ type: 'played', seat, code: t.code, end: 'open', spinner: !!h.spinner, ends: this._endsView(h) });
        if (hand.length === 0) return this._endHandWon(table, h, seat, events);
        h.turn = table.next(seat); return { ok: true, events, handOver: false, gameOver: false };
      }

      // ---- subsequent move: must target an OPEN end by id ----
      const ends = this._openEnds(h);
      const e = ends.find((x) => x.id === action.end);
      if (!e) return { ok: false, error: 'no such open end' };
      const other = matchFace(t, e.pip);
      if (other == null) return { ok: false, error: 'tile does not match that end' };
      hand.splice(idx, 1);
      h.order += 1;
      const branch = (e.kind === 'spin') ? e.id : 'main';
      // matchPip = the face that touches the existing end; outer = the new exposed face.
      const piece = { code: t.code, a: t.a, b: t.b, double: t.double, branch, order: h.order,
                      on: e.id, matchPip: e.pip, outer: other };
      if (e.id === 'L') h.line.unshift(piece); else h.line.push(piece);
      // update that end's exposed pip
      e.pip = other;
      // a freshly-played double may become a spinner (rule 'all', or 'first' if none yet)
      if (this._isSpinner(table, h, t) && !h.spinner) { h.spinner = { code: t.code, pip: t.a }; h.lineBuiltL = false; h.lineBuiltR = false; }
      // track main-line growth on each side (for arm opening)
      if (e.id === 'L') h.lineBuiltL = true;
      if (e.id === 'R') h.lineBuiltR = true;
      h.tilesPlayed += 1; h.passes = 0;
      this._maybeOpenArms(h, events);
      events.push({ type: 'played', seat, code: t.code, end: e.id, branch, ends: this._endsView(h) });

      if (hand.length === 0) return this._endHandWon(table, h, seat, events);
      h.turn = table.next(seat);
      return { ok: true, events, handOver: false, gameOver: false };
    }

    return { ok: false, error: 'unknown action ' + action.type };
  },

  _endsView(h) {
    return this._openEnds(h).map((e) => ({ id: e.id, pip: e.pip, kind: e.kind }));
  },

  _endHandWon(table, h, winnerSeat, events) {
    const gained = h.hands.reduce((sum, hd, s) => sum + (s === winnerSeat ? 0 : handPips(hd)), 0);
    h.match.totals[winnerSeat] += gained;
    events.push({ type: 'handWon', seat: winnerSeat, gained, reason: 'out', totals: h.match.totals.slice() });
    return this._afterHand(table, h, events);
  },

  _endHandBlocked(table, h, events) {
    const pipsBySeat = h.hands.map((hd) => handPips(hd));
    const min = Math.min(...pipsBySeat);
    const lowSeats = pipsBySeat.map((p, s) => (p === min ? s : -1)).filter((s) => s >= 0);
    if (lowSeats.length === 1) {
      const winnerSeat = lowSeats[0];
      const gained = pipsBySeat.reduce((sum, p, s) => sum + (s === winnerSeat ? 0 : p), 0);
      h.match.totals[winnerSeat] += gained;
      events.push({ type: 'handWon', seat: winnerSeat, gained, reason: 'blocked', totals: h.match.totals.slice() });
    } else {
      events.push({ type: 'handBlocked', tie: lowSeats, totals: h.match.totals.slice() });
    }
    return this._afterHand(table, h, events);
  },

  _afterHand(table, h, events) {
    const target = table.config.target || cfg.rules.target;
    const totals = h.match.totals;
    const top = Math.max(...totals);
    if (top >= target) {
      const winnerSeat = totals.indexOf(top);
      table._domResult = { totals: totals.slice(), winnerSeat };
      events.push({ type: 'gameWon', winnerSeat, totals: totals.slice() });
      return { ok: true, events, handOver: false, gameOver: true };
    }
    return { ok: true, events, handOver: true, gameOver: false };
  },

  gameResult(table) {
    const r = table._domResult || { totals: (table._domMatch || { totals: table.scores }).totals, winnerSeat: 0 };
    return { mode: 'individual', winnerSeat: r.winnerSeat, totals: r.totals };
  },
  standings(table) {
    const r = table._domResult || { totals: (table._domMatch || { totals: table.scores }).totals };
    const totals = r.totals;
    const top = Math.max(...totals);
    return table.seats.map((s) => ({
      seat: s.seat, team: s.seat, displayName: s.displayName,
      bot: s.bot, score: totals[s.seat], won: totals[s.seat] === top,
    }));
  },
  resetMatch(table) { table._domMatch = { totals: new Array(table.seatCount).fill(0), handNo: 0 }; table._domResult = null; },

  publicView(table) {
    const h = table.hand;
    if (!h) return { phase: 'lobby' };
    return {
      phase: h.phase,
      dealer: table.dealer,
      turn: h.turn,
      starter: h.starter,
      line: h.line.map((b) => ({ code: b.code, a: b.a, b: b.b, double: b.double, branch: b.branch, order: b.order, on: b.on || null, matchPip: (b.matchPip === undefined ? null : b.matchPip), outer: (b.outer === undefined ? null : b.outer) })),
      ends: this._endsView(h),
      spinner: h.spinner ? { code: h.spinner.code, pip: h.spinner.pip, armsOpen: h.spinnerArmsOpen } : null,
      spinnerRule: this._spinnerRule(table),
      boneyard: h.boneyard.length,
      handCounts: h.hands.map((hh) => hh.length),
      totals: h.match ? h.match.totals.slice() : new Array(table.seatCount).fill(0),
      target: table.config.target || cfg.rules.target,
      tilesPlayed: h.tilesPlayed,
    };
  },

  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, hand: [], legal: [] };
    const legal = this.legalActions(table, seat);
    return {
      seat,
      hand: (h.hands[seat] || []).map((t) => ({ code: t.code, a: t.a, b: t.b, double: t.double })),
      turn: h.turn,
      yourTurn: h.phase === 'playing' && h.turn === seat,
      legal,
      ends: this._endsView(h),
      spinner: h.spinner ? { code: h.spinner.code, pip: h.spinner.pip, armsOpen: h.spinnerArmsOpen } : null,
      boneyard: h.boneyard.length,
      mustOpen: h.mustOpen,
      handNo: h.match ? h.match.handNo : 0,
      tilesPlayed: h.tilesPlayed,
    };
  },

  botAction(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'playing' || seat !== h.turn) return null;
    const legal = this.legalActions(table, seat);
    if (!legal.length) return null;
    const plays = legal.filter((a) => a.type === 'play');
    if (plays.length) {
      const hand = h.hands[seat];
      const byCode = Object.fromEntries(hand.map((t) => [t.code, t]));
      plays.sort((x, y) => {
        const tx = byCode[x.code], ty = byCode[y.code];
        return (ty.double - tx.double) || (pip(ty) - pip(tx));
      });
      return plays[0];
    }
    return legal[0];
  },
};

export default dominoes;
export { matchFace, pip, handPips };
