import fs from 'fs';
const F = '/srv/games/arcade/tiles/craps/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('const PLACE =')) { console.log('already'); process.exit(0); }

// 1) Define PLACE bets (point numbers) + their fractional payout multipliers.
s = s.replace(
  `const HARD = { hard4: 4, hard6: 6, hard8: 8, hard10: 10 };`,
  `const HARD = { hard4: 4, hard6: 6, hard8: 8, hard10: 10 };
// PLACE bets on the point numbers: win if the number rolls before a 7, lose on 7.
// Casino place odds: 4/10 = 9:5, 5/9 = 7:5, 6/8 = 7:6.
const PLACE = { place4: 4, place5: 5, place6: 6, place8: 8, place9: 9, place10: 10 };
const PLACE_MULT = { 4: 9 / 5, 5: 7 / 5, 6: 7 / 6, 8: 7 / 6, 9: 7 / 5, 10: 9 / 5 };`
);

// 2) Offer place bets in legalActions (only once a point is on — standard: place
//    bets are "off" on the come-out). Add to the sides list when !comeout.
s = s.replace(
  `          const sides = h.comeout ? ['pass', 'dontpass'] : [];   // line bets only on come-out
          sides.push('field', 'any7', 'anycraps', 'ce', 'hard4', 'hard6', 'hard8', 'hard10');`,
  `          const sides = h.comeout ? ['pass', 'dontpass'] : [];   // line bets only on come-out
          sides.push('field', 'any7', 'anycraps', 'ce', 'hard4', 'hard6', 'hard8', 'hard10');
          if (!h.comeout) sides.push('place4', 'place5', 'place6', 'place8', 'place9', 'place10');`
);

// 3) Validate place bets in applyAction.
s = s.replace(
  `      const valid = LINE.has(side) || ONE_ROLL.has(side) || HARD[side];
      if (!valid) return { ok: false, error: 'bad bet side' };
      if (LINE.has(side) && !h.comeout) return { ok: false, error: 'line bets only on come-out' };`,
  `      const valid = LINE.has(side) || ONE_ROLL.has(side) || HARD[side] || PLACE[side];
      if (!valid) return { ok: false, error: 'bad bet side' };
      if (LINE.has(side) && !h.comeout) return { ok: false, error: 'line bets only on come-out' };
      if (PLACE[side] && h.comeout) return { ok: false, error: 'place bets work after a point is set' };`
);

// 4) Resolve place bets each roll: hit the number -> win (rides, stays up), 7 -> lose.
//    Insert a branch in the per-bet resolution, before the LINE branch.
s = s.replace(
  `        } else if (LINE.has(bet.side) && lineDecision) {`,
  `        } else if (PLACE[bet.side]) {
          const target = PLACE[bet.side];
          if (sum === target) { m.bankrolls[s] += Math.round(a * PLACE_MULT[target]); /* rides: stays up */ }
          else if (sum === 7) { m.bankrolls[s] -= a; bet._done = true; }   // seven-out takes it down
          // any other number: the place bet just rides
        } else if (LINE.has(bet.side) && lineDecision) {`
);

fs.writeFileSync(F, s);
console.log('craps engine: place bets on 4/5/6/8/9/10 added (ride until hit or seven-out)');
