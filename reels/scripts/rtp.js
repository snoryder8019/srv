/**
 * RTP enumeration — exact return-to-player for a machine, brute force over all
 * stop combinations (fine for 3 reels; for 5+ reels switch to per-reel symbol
 * distributions). Run: npm run rtp [machine-slug]
 */
const { loadMachines, getMachine, windowFromStops, lineSymbols, evalLine, countInWindow } = require('../lib/engine');

loadMachines();
const slug = process.argv[2] || 'classic-diamond';
const m = getMachine(slug);
if (!m) { console.error('unknown machine', slug); process.exit(1); }

const lens = m.strips.map(s => s.length);
const total = lens.reduce((a, b) => a * b, 1);

for (const lines of m.lineOptions) {
  const active = m.paylines.slice(0, lines);
  let lineReturn = 0;      // in line-bet units
  let fsHits = 0, pickHits = 0;
  const labelHits = {};
  const idx = new Array(m.strips.length).fill(0);
  for (let n = 0; n < total; n++) {
    let k = n;
    for (let r = 0; r < lens.length; r++) { idx[r] = k % lens[r]; k = Math.floor(k / lens[r]); }
    const win = windowFromStops(m, idx);
    for (const pl of active) {
      const hit = evalLine(m, lineSymbols(win, pl));
      if (hit) { lineReturn += hit.mult; labelHits[hit.label] = (labelHits[hit.label] || 0) + 1; }
    }
    for (const b of m.bonuses || []) {
      if (countInWindow(win, b.trigger.scatter) >= (b.trigger.count || 3)) {
        if (b.type === 'freespins') fsHits++;
        if (b.type === 'pick') pickHits++;
      }
    }
  }
  const baseRTP = lineReturn / (total * lines);

  // free spins: expected free spins per bought spin (retriggers -> geometric series),
  // each worth baseRTP × multiplier × bet
  const fb = (m.bonuses || []).find(x => x.type === 'freespins');
  let fsRTP = 0;
  if (fb) {
    const pT = fsHits / total;
    const efs = (pT * fb.spins) / Math.max(1e-9, 1 - pT * fb.spins);
    fsRTP = efs * baseRTP * (fb.multiplier || 1);
  }
  // pick bonus: prizes are TOTAL-bet multipliers, uniform random assignment -> E = mean(prizes)
  const pk = (m.bonuses || []).find(x => x.type === 'pick');
  let pickRTP = 0;
  if (pk) pickRTP = (pickHits / total) * (pk.prizes.reduce((a, b) => a + b, 0) / pk.prizes.length);

  console.log(`lines=${lines}  combos=${total}  baseRTP=${(baseRTP * 100).toFixed(2)}%  freespins=${(fsRTP * 100).toFixed(2)}%  pick=${(pickRTP * 100).toFixed(2)}%  TOTAL=${((baseRTP + fsRTP + pickRTP) * 100).toFixed(2)}%`);
  console.log(`  trigger odds per spin — free spins: 1-in-${Math.round(total / Math.max(1, fsHits))}, pick: 1-in-${Math.round(total / Math.max(1, pickHits))}`);
  if (lines === Math.max(...m.lineOptions)) {
    console.log('hit counts (all lines, all combos):');
    Object.entries(labelHits).sort((a, b) => b[1] - a[1]).forEach(([l, c]) => console.log(`  ${l}: ${c} (${(c / (total * lines) * 100).toFixed(3)}%/line-spin)`));
  }
}
