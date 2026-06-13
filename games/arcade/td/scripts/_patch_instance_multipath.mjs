import fs from 'fs';
const F = '/srv/td/services/game/instance.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('this.paths')) { console.log('already multi-path'); process.exit(0); }

// import findAllPaths alongside findDefaultPath
s = s.replace(
  `import { findDefaultPath } from './pathfinding.js';`,
  `import { findDefaultPath, findAllPaths } from './pathfinding.js';`
);

// build all spawn paths; keep this.path as the first one for back-compat/start gate
s = s.replace(
  `    // Precompute path once. If no path, instance is unstartable.
    this.path = findDefaultPath(map);`,
  `    // Precompute EVERY spawn->base path once (multi-spawn / Siege). this.path is
    // the first routable path, kept for back-compat + the start gate.
    this.paths = (findAllPaths(map) || []).map((p) => p.hexes).filter((h) => h && h.length);
    if (!this.paths.length) { const dp = findDefaultPath(map); if (dp) this.paths = [dp]; }
    this.path = this.paths[0] || null;
    this._spawnRR = 0;   // round-robin index across spawn paths`
);

// spawnEnemy: assign each enemy its own path (round-robin across spawns)
s = s.replace(
  `      ground: tpl.ground !== false,
      disguiseType,           // non-null => blended into the crowd
      exposed: false,
      pathIndex: 0, t: 0,
    };`,
  `      ground: tpl.ground !== false,
      disguiseType,           // non-null => blended into the crowd
      exposed: false,
      pathIndex: 0, t: 0,
      pathId: (opts.pathId != null ? opts.pathId : (this._spawnRR++ % this.paths.length)),
    };`
);

// helper to fetch an enemy's path (falls back to this.path)
s = s.replace(
  `  moveEnemies() {`,
  `  enemyPath(enemy) { return this.paths[enemy.pathId] || this.path; }

  moveEnemies() {`
);

// moveEnemies: use the enemy's own path length
s = s.replace(
  `    for (const enemy of this.enemies.values()) {
      enemy.t += enemy.speed * dt;
      while (enemy.t >= 1 && enemy.pathIndex < this.path.length - 1) {
        enemy.t -= 1;
        enemy.pathIndex++;
      }
      if (enemy.pathIndex >= this.path.length - 1) {`,
  `    for (const enemy of this.enemies.values()) {
      const path = this.enemyPath(enemy);
      enemy.t += enemy.speed * dt;
      while (enemy.t >= 1 && enemy.pathIndex < path.length - 1) {
        enemy.t -= 1;
        enemy.pathIndex++;
      }
      if (enemy.pathIndex >= path.length - 1) {`
);

// enemyAxial: use the enemy's own path
s = s.replace(
  `  enemyAxial(enemy) {
    const a = this.path[enemy.pathIndex];
    const b = this.path[Math.min(enemy.pathIndex + 1, this.path.length - 1)];`,
  `  enemyAxial(enemy) {
    const path = this.enemyPath(enemy);
    const a = path[enemy.pathIndex];
    const b = path[Math.min(enemy.pathIndex + 1, path.length - 1)];`
);

fs.writeFileSync(F, s);
console.log('instance.js: multi-spawn paths wired (per-enemy pathId, round-robin)');
