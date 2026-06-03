import fs from 'fs';
const F = '/srv/td/services/game/siege-map.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('LONGER WAVES')) { console.log('already'); process.exit(0); }

// Replace the wave-generation block with LONGER-running, more sustained waves:
// higher counts, moderate (non-collapsing) spawn delays so each wave pours in
// over a real stretch of time, plus staggered group start offsets and a longer
// tail. More tiles handled by the caller via a bigger radius.
const oldWaves = `  // --- waves: scale count + variety with wave number (more spawns over time) ---
  const waves = [];
  for (let w = 0; w < waveCount; w++) {
    const tier = Math.floor(w / 3);
    const enemies = [
      { type: 'grunt', count: 8 + w * 4, delayMs: Math.max(280, 700 - w * 30) },
    ];
    if (w >= 2) enemies.push({ type: 'runner', count: 4 + w * 2, delayMs: Math.max(220, 520 - w * 24) });
    if (w >= 4) enemies.push({ type: 'machine', count: 2 + tier * 2, delayMs: 900 });
    if (w >= 6 && w % 3 === 0) enemies.push({ type: 'flyer', count: 3 + tier, delayMs: 500 });
    waves.push({ enemies, intermissionMs: 6000 });
  }`;
const newWaves = `  // --- LONGER WAVES: sustained pressure. Counts scale up but spawn delays stay
  //     moderate (they do NOT collapse toward instant), so each wave takes a real
  //     stretch to fully arrive. Groups stagger via startDelayMs so a wave layers
  //     grunts -> runners -> heavies instead of dumping everything at once. ---
  const waves = [];
  for (let w = 0; w < waveCount; w++) {
    const tier = Math.floor(w / 3);
    const enemies = [];
    // main grunt column — big, steady stream (delay floor 420ms keeps it long)
    enemies.push({ type: 'grunt', count: 14 + w * 6, delayMs: Math.max(420, 720 - w * 14), startDelayMs: 0 });
    // runners join after a beat from wave 2
    if (w >= 2) enemies.push({ type: 'runner', count: 6 + w * 3, delayMs: Math.max(380, 560 - w * 12), startDelayMs: 2500 });
    // heavy machines grind in mid/late, slow cadence
    if (w >= 4) enemies.push({ type: 'machine', count: 2 + tier * 2, delayMs: 1400, startDelayMs: 4000 });
    // periodic flyer flights
    if (w >= 6 && w % 2 === 0) enemies.push({ type: 'flyer', count: 4 + tier * 2, delayMs: 700, startDelayMs: 6000 });
    // a late grunt "tail" so the wave doesn't end abruptly
    enemies.push({ type: 'grunt', count: 8 + w * 3, delayMs: Math.max(500, 800 - w * 10), startDelayMs: 8000 });
    waves.push({ enemies, intermissionMs: 7000 });
  }`;
if (!s.includes(oldWaves)) { console.log('wave block not found'); process.exit(1); }
s = s.replace(oldWaves, newWaves);
s = s.replace(`  const radius = opts.radius ?? 10;`, `  const radius = opts.radius ?? 14;`);
fs.writeFileSync(F, s);
console.log('siege-map: longer sustained waves + staggered groups; default radius 14');
