import fs from 'fs';
const F = '/srv/games/arcade/tiles/craps/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('// POINT-CYCLE LIVE BETTING')) { console.log('already'); process.exit(0); }

// MODEL CHANGE: keep the come-out flow (everyone locks -> shooter rolls), but once
// a POINT is set, betting stays OPEN — any seat may add field/prop/hardway bets
// between rolls, and the shooter may roll at any time. We represent the point
// cycle as phase 'bets' with comeout=false, and allow a {type:'roll'} from the
// shooter directly out of the bets phase when a point is on.

// 1) currentTurn / legalActions: shooter may roll from bets phase if a point is on.
s = s.replace(
`  currentTurn(table) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'roll') return h.shooter;
    return null;   // bets phase: no single turn
  },`,
`  // POINT-CYCLE LIVE BETTING
  currentTurn(table) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'roll') return h.shooter;
    return null;   // bets phase: no single turn (everyone bets live)
  },
  _pointOn(table) { const h = table.hand; return !!(h && !h.comeout && h.point != null); },`
);

// 2) legalActions: in bets phase, the shooter additionally gets a roll action
//    whenever a point is on (so they can roll between live bets).
s = s.replace(
`    if (h.phase === 'bets') {
      if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return [];
      const free = h.match.bankrolls[seat] - this._staked(h, seat);
      const amount = Math.min(free, table.config.betSize);
      const acts = [];
      if (amount > 0) {
        const sides = h.comeout ? ['pass', 'dontpass'] : [];   // line bets only on come-out
        sides.push('field', 'any7', 'anycraps', 'ce', 'hard4', 'hard6', 'hard8', 'hard10');
        for (const side of sides) acts.push({ type: 'bet', side, amount });
      }
      acts.push({ type: 'done' });                              // finish betting
      return acts;
    }
    return [];`,
`    if (h.phase === 'bets') {
      const acts = [];
      const solvent = h.match.bankrolls[seat] > 0;
      if (solvent && !h.locked[seat]) {
        const free = h.match.bankrolls[seat] - this._staked(h, seat);
        const amount = Math.min(free, table.config.betSize);
        if (amount > 0) {
          const sides = h.comeout ? ['pass', 'dontpass'] : [];   // line bets only on come-out
          sides.push('field', 'any7', 'anycraps', 'ce', 'hard4', 'hard6', 'hard8', 'hard10');
          for (const side of sides) acts.push({ type: 'bet', side, amount });
        }
        acts.push({ type: 'done' });                             // finish betting (come-out gate)
      }
      // once a POINT is on, the shooter can roll at any time — betting stays open
      if (this._pointOn(table) && seat === h.shooter) acts.push({ type: 'roll' });
      return acts;
    }
    return [];`
);

// 3) applyAction (bets phase): accept a {type:'roll'} from the shooter when a point
//    is on — perform the roll inline (don't require everyone to lock).
s = s.replace(
`    if (h.phase === 'bets') {
      if (h.locked[seat]) return { ok: false, error: 'already locked in' };
      if (action.type === 'done') {`,
`    if (h.phase === 'bets') {
      // point cycle: the shooter may roll directly from the bets phase
      if (action.type === 'roll') {
        if (!this._pointOn(table)) return { ok: false, error: 'no point yet — finish betting first' };
        if (seat !== h.shooter) return { ok: false, error: 'only the shooter rolls' };
        return this._doRoll(table, h, events, seat);
      }
      if (h.locked[seat]) return { ok: false, error: 'already locked in' };
      if (action.type === 'done') {`
);

// 4) Extract the roll body into _doRoll so both the roll phase and the point-cycle
//    bets phase can call it. Replace the roll-phase block to call it.
s = s.replace(
`    if (h.phase === 'roll') {
      if (seat !== h.shooter) return { ok: false, error: 'only the shooter rolls' };
      if (action.type !== 'roll') return { ok: false, error: 'expected roll' };
      const d1 = 1 + Math.floor(h._rng() * 6), d2 = 1 + Math.floor(h._rng() * 6), sum = d1 + d2;
      const hard = d1 === d2;
      h.rolls.push([d1, d2]);
      h.match.lastRoll = [d1, d2]; h.match.lastRollKey = (h.match.lastRollKey || 0) + 1;   // persist across hands
      events.push({ type: 'roll', seat, dice: [d1, d2], sum, hard, point: h.point, comeout: h.comeout });
      return this._resolveRoll(table, h, events, d1, d2, sum, hard);
    }
    return { ok: false, error: \`cannot act in phase \${h.phase}\` };
  },`,
`    if (h.phase === 'roll') {
      if (seat !== h.shooter) return { ok: false, error: 'only the shooter rolls' };
      if (action.type !== 'roll') return { ok: false, error: 'expected roll' };
      return this._doRoll(table, h, events, seat);
    }
    return { ok: false, error: \`cannot act in phase \${h.phase}\` };
  },

  _doRoll(table, h, events, seat) {
    const d1 = 1 + Math.floor(h._rng() * 6), d2 = 1 + Math.floor(h._rng() * 6), sum = d1 + d2;
    const hard = d1 === d2;
    h.rolls.push([d1, d2]);
    h.match.lastRoll = [d1, d2]; h.match.lastRollKey = (h.match.lastRollKey || 0) + 1;
    events.push({ type: 'roll', seat, dice: [d1, d2], sum, hard, point: h.point, comeout: h.comeout });
    return this._resolveRoll(table, h, events, d1, d2, sum, hard);
  },`
);

// 5) _resolveRoll: when a point is freshly set OR the sequence continues (point
//    still on), keep the table in the BETS phase so live betting + shooter rolls
//    both work. On round over, handOver as before.
s = s.replace(
`    if (roundOver) {
      // CONTINUOUS: never gameOver — just start the next round (rotate shooter on seven-out)
      return { ok: true, events, handOver: true, gameOver: false };
    }
    // sequence continues (point established or hardways still riding) — roll again
    // but if there are no remaining bets at all and a point is set, still allow rolls
    return { ok: true, events, handOver: false, gameOver: false };`,
`    if (roundOver) {
      // CONTINUOUS: never gameOver — just start the next round (rotate shooter on seven-out)
      return { ok: true, events, handOver: true, gameOver: false };
    }
    // sequence continues: a point is on. Stay in BETS phase with betting OPEN so
    // any seat can add bets, and the shooter can roll again at will. Re-open any
    // locks so players may bet between rolls.
    h.phase = 'bets';
    h.locked = h.locked.map(() => false);
    return { ok: true, events, handOver: false, gameOver: false };`
);

// 6) Also: when the come-out point is first set inside _resolveRoll, the phase is
//    'roll' at that moment; the block above flips it back to 'bets'. Good.
//    botSeatsToAct: in bets phase with a point on, the shooter bot should roll
//    (after a beat) and other bots may add a bet then lock.
s = s.replace(
`  botSeatsToAct(table) {
    const h = table.hand; if (!h) return [];
    if (h.phase === 'roll') return [h.shooter];
    // all un-locked bots bet simultaneously
    return this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot);
  },`,
`  botSeatsToAct(table) {
    const h = table.hand; if (!h) return [];
    if (h.phase === 'roll') return [h.shooter];
    // bets phase: un-locked bots act; plus, if a point is on, the shooter bot acts
    // (it will roll) even though it may already be locked.
    const set = new Set(this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot));
    if (this._pointOn(table) && table.seats[h.shooter] && table.seats[h.shooter].bot) set.add(h.shooter);
    return [...set];
  },`
);

// 7) botAction: in bets phase with a point on, the shooter rolls; others bet/lock.
s = s.replace(
`    if (h.phase === 'bets') {
      if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
      // bots place one line/field bet then finish
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
    return null;`,
`    if (h.phase === 'bets') {
      // point on: the shooter bot rolls (after possibly having bet already)
      if (this._pointOn(table) && seat === h.shooter) return { type: 'roll' };
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
    return null;`
);

fs.writeFileSync(F, s);
console.log('craps engine: point-cycle live betting + shooter rolls from bets phase');
