/**
 * Craps — casino dice with a shooter, full prop/hardway betting, and a CONTINUOUS
 * table (rounds cycle forever; the table lives until players leave).
 *
 * Each seat can stack MULTIPLE bets in the betting window:
 *   line:     pass (1:1), dontpass (1:1)
 *   one-roll: field (1:1, with 2x on 2 and 12), any7 (4:1), anycraps (7:1),
 *             c&e / "combo" (craps-or-eleven, pays per outcome), the single-number
 *             props two/aces (30:1), three (15:1), yo/eleven (15:1), twelve (30:1),
 *             and horn (4-way split on 2/3/11/12)
 *   hardways: hard4, hard6, hard8, hard10 — stay up across rolls until the hard
 *             pair hits (win) or the easy number / a 7 hits (lose)
 *   big:      big6, big8 — even-money, ride until the number or a 7 rolls
 *
 * A round is one full pass-line sequence (come-out → point → resolve). One-roll
 * bets settle each roll; line + hardways ride until their decision. We never end
 * the game on a cap or target — rounds keep coming. Most chips is still tracked
 * for the leaderboard, but the table is endless.
 */
import cfg from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

const HARD = { hard4: 4, hard6: 6, hard8: 8, hard10: 10 };
// PLACE bets on the point numbers: win if the number rolls before a 7, lose on 7.
// Casino place odds: 4/10 = 9:5, 5/9 = 7:5, 6/8 = 7:6.
const PLACE = { place4: 4, place5: 5, place6: 6, place8: 8, place9: 9, place10: 10 };
const PLACE_MULT = { 4: 9 / 5, 5: 7 / 5, 6: 7 / 6, 8: 7 / 6, 9: 7 / 5, 10: 9 / 5 };
// BIG 6 / BIG 8 — even-money cousins of place 6/8: win if the number rolls before a
// 7, lose on a 7, ride otherwise. Bettable any time (come-out included).
const BIG = { big6: 6, big8: 8 };
// payout multipliers (profit:stake) for one-roll/hardway resolutions
const PAY = {
  pass: 1, dontpass: 1, field: 1, any7: 4, anycraps: 7,
  hard4: 7, hard10: 7, hard6: 9, hard8: 9, ce: 3,
  // single-number one-roll props
  two: 30, three: 15, yo: 15, twelve: 30,
  big6: 1, big8: 1,
};
// one-roll props settle on every roll (win or lose immediately, never ride)
const ONE_ROLL = new Set(['field', 'any7', 'anycraps', 'ce', 'two', 'three', 'yo', 'twelve', 'horn']);
const LINE = new Set(['pass', 'dontpass']);

const craps = {
  id: 'craps',
  name: 'Craps',
  meta: cfg,
  catalog,
  defaults: { startChips: cfg.scoring.startChips, betSize: cfg.scoring.betSize },
  continuous: true,                       // runtime hint: this table does not "end"

  _match(table) {
    if (!table._craps) {
      table._craps = { bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0 };
      table.scores = table._craps.bankrolls.slice();
    }
    return table._craps;
  },
  _firstBetter(table) {
    const h = table.hand;
    for (let s = 0; s < table.seatCount; s++) {
      if (h.match.bankrolls[s] > 0 && !h.locked[s]) return s;
    }
    return null;
  },

  startHand(table, rng) {
    const m = this._match(table);
    m.handNo += 1;
    let shooter = table.dealer;
    for (let i = 0; i < table.seatCount; i++) { const s = (table.dealer + i) % table.seatCount; if (m.bankrolls[s] > 0) { shooter = s; break; } }
    table.hand = {
      phase: 'bets', shooter,
      bets: Array.from({ length: table.seatCount }, () => []),   // array of {side,amount,n?} per seat
      locked: new Array(table.seatCount).fill(false),            // seat finished betting this come-out
      comeout: true, point: null, rolls: [], turn: null, _rng: rng, match: m,
    };
    table.hand.turn = this._firstBetter(table);
    return table.hand;
  },

  // LIVE simultaneous betting: during BETS every un-locked solvent seat bets at
  // once (no round-robin). During ROLL only the shooter acts.
  // POINT-CYCLE LIVE BETTING
  currentTurn(table) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'roll') return h.shooter;
    return null;   // bets phase: no single turn (everyone bets live)
  },
  _pointOn(table) { const h = table.hand; return !!(h && !h.comeout && h.point != null); },
  // connected humans who are solvent and have NOT locked in this betting window
  _humansStillBetting(table) {
    const h = table.hand; if (!h || h.phase !== 'bets') return false;
    for (let s = 0; s < table.seatCount; s++) {
      const seat = table.seats[s];
      if (seat && seat.platformId && !seat.bot && seat.connected && h.match.bankrolls[s] > 0 && !h.locked[s]) return true;
    }
    return false;
  },
  _unlockedSeats(table) {
    const h = table.hand; const out = [];
    if (!h || h.phase !== 'bets') return out;
    for (let s = 0; s < table.seatCount; s++) if (h.match.bankrolls[s] > 0 && !h.locked[s]) out.push(s);
    return out;
  },
  botSeatsToAct(table) {
    const h = table.hand; if (!h) return [];
    if (h.phase === 'roll') return [h.shooter];
    // bets phase: un-locked bots place their bets + lock.
    const set = new Set(this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot));
    // point cycle: the bot shooter may roll — but ONLY once no human is still
    // betting, so humans always get a window between rolls (prevents rapid-fire).
    if (this._pointOn(table) && table.seats[h.shooter] && table.seats[h.shooter].bot
        && !this._humansStillBetting(table)) {
      set.add(h.shooter);
    }
    return [...set];
  },

  _staked(h, seat) { return h.bets[seat].reduce((a, b) => a + b.amount, 0); },

  legalActions(table, seat) {
    const h = table.hand;
    if (!h) return [];
    if (h.phase === 'roll') return seat === h.shooter ? [{ type: 'roll' }] : [];
    if (h.phase === 'bets') {
      const acts = [];
      const solvent = h.match.bankrolls[seat] > 0;
      if (solvent && !h.locked[seat]) {
        const free = h.match.bankrolls[seat] - this._staked(h, seat);
        const amount = Math.min(free, table.config.betSize);
        if (amount > 0) {
          const sides = h.comeout ? ['pass', 'dontpass'] : [];   // line bets only on come-out
          sides.push('field', 'any7', 'anycraps', 'ce', 'two', 'three', 'yo', 'twelve', 'horn',
                     'big6', 'big8', 'hard4', 'hard6', 'hard8', 'hard10');
          if (!h.comeout) sides.push('place4', 'place5', 'place6', 'place8', 'place9', 'place10');
          for (const side of sides) acts.push({ type: 'bet', side, amount });
        }
        acts.push({ type: 'done' });                             // finish betting (come-out gate)
      }
      // press/pull offered when this seat has a riding win to act on
      const myPress = (h.pressable || []).filter((p) => p.seat === seat);
      for (const p of myPress) {
        acts.push({ type: 'press', id: p.id, side: p.side, won: p.won });
        acts.push({ type: 'takewin', id: p.id, side: p.side, won: p.won });
        acts.push({ type: 'pull', id: p.id, side: p.side, won: p.won });
      }
      // once a POINT is on, the shooter can roll at any time — betting stays open
      if (this._pointOn(table) && seat === h.shooter) acts.push({ type: 'roll' });
      return acts;
    }
    return [];
  },

  applyAction(table, seat, action) {
    const h = table.hand;
    if (!h) return { ok: false, error: 'no hand' };
    if (!action || !action.type) return { ok: false, error: 'no action' };
    const events = [];

    if (h.phase === 'bets') {
      // point cycle: the shooter may roll directly from the bets phase
      if (action.type === 'roll') {
        if (!this._pointOn(table)) return { ok: false, error: 'no point yet — finish betting first' };
        if (seat !== h.shooter) return { ok: false, error: 'only the shooter rolls' };
        return this._doRoll(table, h, events, seat);
      }
      if (action.type === 'press' || action.type === 'pull' || action.type === 'takewin') {
        const list = (h.pressable || []).filter((p) => p.seat === seat);
        if (!list.length) return { ok: false, error: 'nothing to press' };
        // resolve which pressable win(s) this refers to (by bet id, or all of mine)
        const targets = action.id != null ? list.filter((p) => p.id === action.id) : list;
        if (!targets.length) return { ok: false, error: 'no such pressable bet' };
        if (action.type === 'takewin') {
          // take the win: the profit is already banked; leave the bet up to ride.
          h.pressable = (h.pressable || []).filter((p) => !(p.seat === seat && targets.some((t) => t.id === p.id)));
          events.push({ type: 'tookWin', seat, ids: targets.map((t) => t.id) });
          return { ok: true, events, handOver: false, gameOver: false };
        }
        if (action.type === 'pull') {
          // pull = take the bet DOWN: remove it so the reserved stake returns to the
          // bankroll (stakes are reserved, not deducted), keeping the banked winnings.
          for (const t of targets) {
            const idx = h.bets[seat].findIndex((b) => b.id === t.id);
            if (idx >= 0) h.bets[seat].splice(idx, 1);
          }
          h.pressable = (h.pressable || []).filter((p) => !(p.seat === seat && targets.some((t) => t.id === p.id)));
          events.push({ type: 'pulled', seat, ids: targets.map((t) => t.id) });
          return { ok: true, events, handOver: false, gameOver: false };
        }
        // press = add the won profit back onto each riding bet (capped by bankroll)
        let pressedTotal = 0;
        for (const t of targets) {
          const bet = h.bets[seat].find((b) => b.id === t.id && PLACE[b.side]);
          if (!bet) continue;
          const free = h.match.bankrolls[seat] - this._staked(h, seat);
          const add = Math.max(0, Math.min(free, t.won));   // press up to the amount just won
          if (add <= 0) continue;
          bet.amount += add; pressedTotal += add;
        }
        h.pressable = (h.pressable || []).filter((p) => !(p.seat === seat && targets.some((t) => t.id === p.id)));
        events.push({ type: 'pressed', seat, amount: pressedTotal });
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (h.locked[seat]) return { ok: false, error: 'already locked in' };
      if (action.type === 'done') {
        h.locked[seat] = true;
        // once every solvent seat is locked, move to the roll (shooter rolls)
        if (this._unlockedSeats(table).length === 0) {
          h.phase = 'roll'; h.turn = h.shooter; events.push({ type: 'comeout', shooter: h.shooter });
        } else {
          events.push({ type: 'locked', seat });
        }
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (action.type !== 'bet') return { ok: false, error: 'expected bet or done' };
      const side = action.side;
      const valid = LINE.has(side) || ONE_ROLL.has(side) || HARD[side] || PLACE[side] || BIG[side];
      if (!valid) return { ok: false, error: 'bad bet side' };
      if (LINE.has(side) && !h.comeout) return { ok: false, error: 'line bets only on come-out' };
      if (PLACE[side] && h.comeout) return { ok: false, error: 'place bets work after a point is set' };
      const free = h.match.bankrolls[seat] - this._staked(h, seat);
      const amount = Math.max(0, Math.min(free, action.amount || table.config.betSize));
      if (amount <= 0) return { ok: false, error: 'insufficient' };
      h.bets[seat].push({ side, amount });
      events.push({ type: 'bet', seat, side, amount });
      return { ok: true, events, handOver: false, gameOver: false };   // stay on this seat to stack more
    }

    if (h.phase === 'roll') {
      if (seat !== h.shooter) return { ok: false, error: 'only the shooter rolls' };
      if (action.type !== 'roll') return { ok: false, error: 'expected roll' };
      return this._doRoll(table, h, events, seat);
    }
    return { ok: false, error: `cannot act in phase ${h.phase}` };
  },

  _doRoll(table, h, events, seat) {
    const d1 = 1 + Math.floor(h._rng() * 6), d2 = 1 + Math.floor(h._rng() * 6), sum = d1 + d2;
    const hard = d1 === d2;
    h.rolls.push([d1, d2]);
    h.match.lastRoll = [d1, d2]; h.match.lastRollKey = (h.match.lastRollKey || 0) + 1;
    events.push({ type: 'roll', seat, dice: [d1, d2], sum, hard, point: h.point, comeout: h.comeout });
    return this._resolveRoll(table, h, events, d1, d2, sum, hard);
  },

  _resolveRoll(table, h, events, d1, d2, sum, hard) {
    const m = h.match;
    const before = m.bankrolls.slice();   // snapshot to compute this roll's win/loss per seat
    const breakdown = [];                 // per-bet results: {seat, side, amount, result, delta}
    const pressable = [];                 // riding bets that WON and can be pressed/pulled

    // line + point decision
    let lineDecision = null;  // 'win'|'lose' for pass; dontpass mirrors
    if (h.comeout) {
      if (sum === 7 || sum === 11) lineDecision = 'passWin';
      else if (sum === 2 || sum === 3) lineDecision = 'passLose';
      else if (sum === 12) lineDecision = 'passLoseDontPush';
      else { h.point = sum; h.comeout = false; events.push({ type: 'pointSet', point: sum }); }
    } else {
      if (sum === h.point) lineDecision = 'passWin';
      else if (sum === 7) lineDecision = 'passLose';
    }

    // tag each bet a stable id so the client can reference it for press/pull
    let _bidCounter = h._bidCounter || 0;
    for (let s = 0; s < table.seatCount; s++) {
      for (const bet of h.bets[s]) {
        const a = bet.amount;
        if (bet.id == null) bet.id = ++_bidCounter;
        let delta = 0, result = 'ride';
        // one-roll props resolve every roll
        if (bet.side === 'field') {
          if ([3, 4, 9, 10, 11].includes(sum)) { m.bankrolls[s] += a; delta = a; result = 'win'; }
          else if (sum === 2 || sum === 12) { m.bankrolls[s] += a * 2; delta = a * 2; result = 'win'; }   // 2x ends
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (bet.side === 'any7') {
          if (sum === 7) { m.bankrolls[s] += a * PAY.any7; delta = a * PAY.any7; result = 'win'; }
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (bet.side === 'anycraps') {
          if ([2, 3, 12].includes(sum)) { m.bankrolls[s] += a * PAY.anycraps; delta = a * PAY.anycraps; result = 'win'; }
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (bet.side === 'ce') {   // craps & eleven combo
          if ([2, 3, 12].includes(sum) || sum === 11) { m.bankrolls[s] += a * PAY.ce; delta = a * PAY.ce; result = 'win'; }
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (bet.side === 'two') {        // aces / snake eyes
          if (sum === 2) { const w = a * PAY.two; m.bankrolls[s] += w; delta = w; result = 'win'; }
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (bet.side === 'three') {      // ace-deuce
          if (sum === 3) { const w = a * PAY.three; m.bankrolls[s] += w; delta = w; result = 'win'; }
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (bet.side === 'yo') {         // eleven
          if (sum === 11) { const w = a * PAY.yo; m.bankrolls[s] += w; delta = w; result = 'win'; }
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (bet.side === 'twelve') {     // boxcars
          if (sum === 12) { const w = a * PAY.twelve; m.bankrolls[s] += w; delta = w; result = 'win'; }
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (bet.side === 'horn') {       // 4-way split on 2/3/11/12 (one unit each)
          const q = a / 4;
          if (sum === 2 || sum === 12) { const w = Math.round(q * 30 - 3 * q); m.bankrolls[s] += w; delta = w; result = 'win'; }
          else if (sum === 3 || sum === 11) { const w = Math.round(q * 15 - 3 * q); m.bankrolls[s] += w; delta = w; result = 'win'; }
          else { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
          bet._done = true;
        } else if (HARD[bet.side]) {
          const target = HARD[bet.side];
          if (sum === target && hard) { const w = a * PAY[bet.side]; m.bankrolls[s] += w; delta = w; result = 'win'; bet._done = true; }
          else if (sum === target && !hard) { m.bankrolls[s] -= a; delta = -a; result = 'lose'; bet._done = true; }
          else if (sum === 7) { m.bankrolls[s] -= a; delta = -a; result = 'lose'; bet._done = true; }
          // otherwise the hardway rides (result stays 'ride')
        } else if (PLACE[bet.side]) {
          const target = PLACE[bet.side];
          if (sum === target) {
            const w = Math.round(a * PLACE_MULT[target]); m.bankrolls[s] += w; delta = w; result = 'win';
            // a place win RIDES (stays up) — and the just-won profit can be pressed
            pressable.push({ seat: s, id: bet.id, side: bet.side, amount: a, won: w });
          } else if (sum === 7) { m.bankrolls[s] -= a; delta = -a; result = 'lose'; bet._done = true; }
          // any other number: the place bet just rides (result 'ride')
        } else if (BIG[bet.side]) {
          const target = BIG[bet.side];
          if (sum === target) { m.bankrolls[s] += a; delta = a; result = 'win'; }   // even money, rides
          else if (sum === 7) { m.bankrolls[s] -= a; delta = -a; result = 'lose'; bet._done = true; }
          // any other number: the Big 6/8 just rides (result 'ride')
        } else if (LINE.has(bet.side) && lineDecision) {
          if (bet.side === 'pass') {
            if (lineDecision === 'passWin') { m.bankrolls[s] += a; delta = a; result = 'win'; }
            else if (lineDecision.startsWith('passLose')) { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
            bet._done = true;
          } else { // dontpass
            if (lineDecision === 'passWin') { m.bankrolls[s] -= a; delta = -a; result = 'lose'; }
            else if (lineDecision === 'passLose') { m.bankrolls[s] += a; delta = a; result = 'win'; }
            else if (lineDecision === 'passLoseDontPush') { result = 'push'; }
            bet._done = true;
          }
        }
        if (result !== 'ride') breakdown.push({ seat: s, side: bet.side, amount: a, result, delta });
        else if (delta !== 0) breakdown.push({ seat: s, side: bet.side, amount: a, result: 'win', delta });
      }
      // hardway wins also ride in real craps, but here HARD wins are marked _done
      // (single-shot) to keep it simple; place wins ride. Drop resolved bets.
      h.bets[s] = h.bets[s].filter((b) => !b._done);
    }
    h._bidCounter = _bidCounter;

    table.scores = m.bankrolls.slice();
    const roundOver = lineDecision != null;   // the pass-line sequence concluded
    if (roundOver) {
      // casinos don't ride place/Big/hardway bets across the decision — take any
      // still-standing ones DOWN, return the stake, and record it for the modal.
      const wonIds = new Set(pressable.map((pp) => pp.id));
      for (let s = 0; s < table.seatCount; s++) {
        for (const bet of h.bets[s]) {
          if ((PLACE[bet.side] || BIG[bet.side] || HARD[bet.side]) && !wonIds.has(bet.id)) {
            breakdown.push({ seat: s, side: bet.side, amount: bet.amount, result: 'down', delta: 0 });
          }
        }
      }
    }
    const deltas = m.bankrolls.map((v, i) => v - before[i]);   // per-seat win/loss this roll
    events.push({ type: 'settle', sum, hard, point: h.point, roundOver, bankrolls: m.bankrolls.slice(), deltas, breakdown });

    // offer press/pull for riding place wins (only meaningful if the round continues)
    if (!roundOver && pressable.length) {
      h.pressable = pressable;   // remember which bets can be pressed this window
      events.push({ type: 'pressable', bets: pressable });
    } else {
      h.pressable = null;
    }

    if (roundOver) {
      return { ok: true, events, handOver: true, gameOver: false };
    }
    // sequence continues: a point is on. Stay in BETS phase with betting OPEN.
    h.phase = 'bets';
    h.locked = h.locked.map(() => false);
    return { ok: true, events, handOver: false, gameOver: false };
  },

  // never ends; gameResult only used if something forces it
  gameResult(table) {
    const m = this._match(table);
    let w = 0; for (let s = 1; s < table.seatCount; s++) if (m.bankrolls[s] > m.bankrolls[w]) w = s;
    return { mode: 'individual', winnerSeat: w, totals: m.bankrolls.slice() };
  },
  resetMatch(table) {
    table._craps = { bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0 };
    table.scores = table._craps.bankrolls.slice();
  },

  publicView(table) {
    const h = table.hand;
    if (!h) return { phase: 'lobby' };
    return {
      phase: h.phase, shooter: h.shooter, comeout: h.comeout, point: h.point, locked: h.locked.slice(),
      lastRoll: (h.rolls.length ? h.rolls[h.rolls.length - 1] : (h.match.lastRoll || null)),
      lastRollKey: h.match.lastRollKey || 0,
      bets: h.bets.map((arr) => arr.map((b) => ({ side: b.side, amount: b.amount }))),
      bankrolls: h.match.bankrolls.slice(), round: h.match.handNo, continuous: true,
    };
  },
  privateView(table, seat) {
    const h = table.hand;
    if (!h) return { seat, legal: [] };
    return {
      seat, phase: h.phase, turn: this.currentTurn(table),
      yourTurn: (h.phase === 'bets' && !h.locked[seat] && h.match.bankrolls[seat] > 0) || (h.phase === 'roll' && seat === h.shooter),
      locked: h.locked[seat],
      bankroll: h.match.bankrolls[seat], myBets: h.bets[seat], shooter: h.shooter,
      comeout: h.comeout, point: h.point,
      pressable: (h.pressable || []).filter((p) => p.seat === seat),
      legal: this.legalActions(table, seat),
    };
  },

  botAction(table, seat) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'roll') return seat === h.shooter ? { type: 'roll' } : null;
    if (h.phase === 'bets') {
      // point on: the shooter bot rolls — but waits while humans are still betting
      if (this._pointOn(table) && seat === h.shooter) {
        if (this._humansStillBetting(table)) {
          // not the shooter's moment yet; if the shooter also has an un-placed bet
          // it can still bet, otherwise it just holds (returns null -> no action).
          if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
          // fall through to normal betting below
        } else {
          return { type: 'roll' };
        }
      }
      // if the bot has a pressable win, it pulls (banks it) by default
      const botPress = (h.pressable || []).find((p) => p.seat === seat);
      if (botPress) return { type: 'pull', id: botPress.id };
      if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
      const mine = h.bets[seat];
      if (!mine.length) {
        const free = h.match.bankrolls[seat];
        if (free <= 0) return { type: 'done' };
        const amount = Math.min(free, table.config.betSize);
        if (h.comeout) return { type: 'bet', side: seat % 3 === 0 ? 'field' : (seat % 2 ? 'dontpass' : 'pass'), amount };
        return { type: 'bet', side: 'field', amount };
      }
      return { type: 'done' };
    }
    return null;
  },
};

export default craps;
