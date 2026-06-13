import fs from 'fs';
const F = '/srv/td/services/game/instance.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('group.startDelayMs')) { console.log('already'); process.exit(0); }

// Fix wave queue timing: use a real `now` base (Date.now()), honor each group's
// optional startDelayMs so groups can stagger/overlap (grunts streaming while
// runners join later), and sort the queue by spawn time. This makes waves run
// longer and layer naturally instead of dumping one group fully before the next.
s = s.replace(
  `    // Flatten wave enemies into a spawn queue with timing
    this.waveQueue = [];
    let elapsed = 0;
    for (const group of wave.enemies) {
      for (let i = 0; i < group.count; i++) {
        this.waveQueue.push({ type: group.type, spawnAt: this.startedAt + this.tickCount * TICK_MS + elapsed });
        elapsed += group.delayMs;
      }
    }`,
  `    // Flatten wave enemies into a spawn queue with timing. Each group spawns its
    // members every group.delayMs, beginning at group.startDelayMs (default:
    // sequentially after the previous group). Groups with an explicit startDelayMs
    // overlap, layering the wave; the queue is sorted by absolute spawn time.
    this.waveQueue = [];
    const base = Date.now();
    let sequential = 0;
    for (const group of wave.enemies) {
      const start = (group.startDelayMs != null) ? group.startDelayMs : sequential;
      for (let i = 0; i < group.count; i++) {
        this.waveQueue.push({ type: group.type, spawnAt: base + start + i * group.delayMs });
      }
      // advance the sequential cursor to the end of this group (for groups w/o explicit start)
      sequential = Math.max(sequential, start + group.count * group.delayMs);
    }
    this.waveQueue.sort((a, b) => a.spawnAt - b.spawnAt);`
);

fs.writeFileSync(F, s);
console.log('instance.js: wave queue honors startDelayMs + real-time base + sorted');
