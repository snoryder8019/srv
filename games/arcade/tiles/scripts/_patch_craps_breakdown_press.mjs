import fs from 'fs';
const F = '/srv/games/arcade/tiles/craps/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('pressable')) { console.log('already'); process.exit(0); }

// ── Rewrite _resolveRoll to (a) collect a per-bet result breakdown and (b) mark
// riding bets (place/hardway) that WON this roll as "pressable" so the player can
// press (add the won profit back onto the bet) or pull (keep it — the default,
// since the profit is already in the bankroll). ──
const oldResolve = `  _resolveRoll(table, h, events, d1, d2, sum, hard) {
    const m = h.match;
    const before = m.bankrolls.slice();   // snapshot to compute this roll's win/loss per seat

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

    for (let s = 0; s < table.seatCount; s++) {
      for (const bet of h.bets[s]) {
        const a = bet.amount;
        // one-roll props resolve every roll
        if (bet.side === 'field') {
          if ([3, 4, 9, 10, 11].includes(sum)) m.bankrolls[s] += a;
          else if (sum === 2 || sum === 12) m.bankrolls[s] += a * 2;   // 2x ends
          else m.bankrolls[s] -= a;
          bet._done = true;
        } else if (bet.side === 'any7') {
          if (sum === 7) m.bankrolls[s] += a * PAY.any7; else m.bankrolls[s] -= a;
          bet._done = true;
        } else if (bet.side === 'anycraps') {
          if ([2, 3, 12].includes(sum)) m.bankrolls[s] += a * PAY.anycraps; else m.bankrolls[s] -= a;
          bet._done = true;
        } else if (bet.side === 'ce') {   // craps & eleven combo
          if ([2, 3, 12].includes(sum) || sum === 11) m.bankrolls[s] += a * PAY.ce; else m.bankrolls[s] -= a;
          bet._done = true;
        } else if (HARD[bet.side]) {
          const target = HARD[bet.side];
          if (sum === target && hard) { m.bankrolls[s] += a * PAY[bet.side]; bet._done = true; }
          else if (sum === target && !hard) { m.bankrolls[s] -= a; bet._done = true; }   // easy number loses it
          else if (sum === 7) { m.bankrolls[s] -= a; bet._done = true; }                  // seven-out loses it
          // otherwise the hardway rides
        } else if (PLACE[bet.side]) {
          const target = PLACE[bet.side];
          if (sum === target) { m.bankrolls[s] += Math.round(a * PLACE_MULT[target]); /* rides: stays up */ }
          else if (sum === 7) { m.bankrolls[s] -= a; bet._done = true; }   // seven-out takes it down
          // any other number: the place bet just rides
        } else if (LINE.has(bet.side) && lineDecision) {
          if (bet.side === 'pass') {
            if (lineDecision === 'passWin') m.bankrolls[s] += a;
            else if (lineDecision.startsWith('passLose')) m.bankrolls[s] -= a;
            bet._done = true;
          } else { // dontpass
            if (lineDecision === 'passWin') m.bankrolls[s] -= a;
            else if (lineDecision === 'passLose') m.bankrolls[s] += a;
            else if (lineDecision === 'passLoseDontPush') { /* push on 12 */ }
            bet._done = true;
          }
        }
      }
      // drop resolved bets
      h.bets[s] = h.bets[s].filter((b) => !b._done);
    }

    table.scores = m.bankrolls.slice();
    const roundOver = lineDecision != null;   // the pass-line sequence concluded
    const deltas = m.bankrolls.map((v, i) => v - before[i]);   // per-seat win/loss this roll
    events.push({ type: 'settle', sum, hard, point: h.point, roundOver, bankrolls: m.bankrolls.slice(), deltas });

    if (roundOver) {
      // CONTINUOUS: never gameOver — just start the next round (rotate shooter on seven-out)
      return { ok: true, events, handOver: true, gameOver: false };
    }
    // sequence continues: a point is on. Stay in BETS phase with betting OPEN so
    // any seat can add bets, and the shooter can roll again at will. Re-open any
    // locks so players may bet between rolls.
    h.phase = 'bets';
    h.locked = h.locked.map(() => false);
    return { ok: true, events, handOver: false, gameOver: false };
  },`;

const newResolve = `  _resolveRoll(table, h, events, d1, d2, sum, hard) {
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
  },`;

if (!s.includes(oldResolve)) { console.log('resolve anchor not found'); process.exit(1); }
s = s.replace(oldResolve, newResolve);
fs.writeFileSync(F, s);
console.log('craps engine: settle now carries per-bet breakdown + pressable wins');
