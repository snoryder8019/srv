import fs from 'fs';
const F = '/srv/games/arcade/tiles/craps/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('deltas: ')) { console.log('already'); process.exit(0); }

// snapshot bankrolls before resolution so we can report a per-seat delta for THIS roll
s = s.replace(
  `  _resolveRoll(table, h, events, d1, d2, sum, hard) {
    const m = h.match;
    const pay = [];   // {seat, side, delta}`,
  `  _resolveRoll(table, h, events, d1, d2, sum, hard) {
    const m = h.match;
    const before = m.bankrolls.slice();   // snapshot to compute this roll's win/loss per seat`
);

// add deltas to the settle event
s = s.replace(
  `    events.push({ type: 'settle', sum, hard, point: h.point, roundOver, bankrolls: m.bankrolls.slice() });`,
  `    const deltas = m.bankrolls.map((v, i) => v - before[i]);   // per-seat win/loss this roll
    events.push({ type: 'settle', sum, hard, point: h.point, roundOver, bankrolls: m.bankrolls.slice(), deltas });`
);

fs.writeFileSync(F, s);
console.log('craps engine: settle event now carries per-seat deltas (win/loss this roll)');
