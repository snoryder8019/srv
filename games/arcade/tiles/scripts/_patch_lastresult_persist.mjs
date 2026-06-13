import fs from 'fs';

// ── ROULETTE: persist lastPocket/lastColor on the match so it survives the
//    immediate next-hand reset (continuous table). publicView reads from match. ──
let r = fs.readFileSync('/srv/games/arcade/tiles/roulette/index.js', 'utf8');
// _spin: also record on the match
r = r.replace(
  `    h.lastPocket = pocket;`,
  `    h.lastPocket = pocket;\n    m.lastPocket = pocket; m.lastColor = colorOf(pocket);   // persist across hands (continuous)`
);
// publicView: prefer the match's persisted value (hand resets to null each round)
r = r.replace(
  `      phase: h.phase, turn: this.currentTurn(table), lastPocket: h.lastPocket,
      lastColor: h.lastPocket == null ? null : colorOf(h.lastPocket),`,
  `      phase: h.phase, turn: this.currentTurn(table),
      lastPocket: (h.match.lastPocket != null ? h.match.lastPocket : h.lastPocket),
      lastColor: (h.match.lastColor != null ? h.match.lastColor : (h.lastPocket == null ? null : colorOf(h.lastPocket))),`
);
fs.writeFileSync('/srv/games/arcade/tiles/roulette/index.js', r);

// ── CRAPS: persist lastRoll on the match the same way. ──
let c = fs.readFileSync('/srv/games/arcade/tiles/craps/index.js', 'utf8');
// record the roll on the match when it happens (in applyAction roll branch)
c = c.replace(
  `      h.rolls.push([d1, d2]);
      events.push({ type: 'roll', seat, dice: [d1, d2], sum, hard, point: h.point, comeout: h.comeout });`,
  `      h.rolls.push([d1, d2]);
      h.match.lastRoll = [d1, d2]; h.match.lastRollKey = (h.match.lastRollKey || 0) + 1;   // persist across hands
      events.push({ type: 'roll', seat, dice: [d1, d2], sum, hard, point: h.point, comeout: h.comeout });`
);
// publicView: prefer the match's persisted lastRoll
c = c.replace(
  `      lastRoll: h.rolls.length ? h.rolls[h.rolls.length - 1] : null,`,
  `      lastRoll: (h.rolls.length ? h.rolls[h.rolls.length - 1] : (h.match.lastRoll || null)),
      lastRollKey: h.match.lastRollKey || 0,`
);
fs.writeFileSync('/srv/games/arcade/tiles/craps/index.js', c);

console.log('persisted lastPocket (roulette) + lastRoll (craps) on the match object');
