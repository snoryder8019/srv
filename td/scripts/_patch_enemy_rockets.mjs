import fs from 'fs';
const F = '/srv/td/services/game/instance.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('enemy:rocket')) { console.log('already'); process.exit(0); }

// ── 1) Give each spawned enemy rocket-attack state ──
s = s.replace(
  `      pathIndex: 0, t: 0,
      pathId: (opts.pathId != null ? opts.pathId : (this._spawnRR++ % this.paths.length)),
    };`,
  `      pathIndex: 0, t: 0,
      pathId: (opts.pathId != null ? opts.pathId : (this._spawnRR++ % this.paths.length)),
      // rocket-attack state: enemies pause to shell a nearby tower, twice, then move on
      attackRange: 2,            // hexes; how close a tower must be to draw fire
      shotsPerTower: 2,          // fire twice per tower before advancing
      rocketDamage: Math.max(4, Math.round((tpl.threat || 1) * 5)),
      rocketCooldownMs: 700,     // between the two shots
      haltMaxMs: 2200,           // safety: never freeze on one tower longer than this
      _shotsLeft: 0,
      _nextShotAt: 0,
      _haltUntil: 0,
      _engaged: null,            // tower id currently being shelled
      _spentTowers: new Set(),   // towers this enemy already emptied its volley on
    };`
);

// ── 2) In moveEnemies, before advancing, check for a tower to shell ──
// Replace the per-enemy advance block with one that can HALT to fire rockets.
s = s.replace(
  `  moveEnemies() {
    const dt = TICK_MS / 1000;
    for (const enemy of this.enemies.values()) {
      const path = this.enemyPath(enemy);
      enemy.t += enemy.speed * dt;`,
  `  moveEnemies() {
    const dt = TICK_MS / 1000;
    const now = Date.now();
    for (const enemy of this.enemies.values()) {
      const path = this.enemyPath(enemy);

      // ── rocket bombardment: if a tower is in range and not yet shelled, halt
      //    and fire up to shotsPerTower rockets at it, then resume the march ──
      if (enemy.ground !== false) {   // fliers keep moving; ground units bombard
        if (enemy._engaged && now < enemy._haltUntil) {
          // mid-volley: fire when the per-shot cooldown elapses
          if (enemy._shotsLeft > 0 && now >= enemy._nextShotAt) {
            const tw = [...this.towers.values()].find(t => t.id === enemy._engaged);
            if (tw) {
              this._fireRocket(enemy, tw);
              enemy._shotsLeft--;
              enemy._nextShotAt = now + enemy.rocketCooldownMs;
              if (enemy._shotsLeft <= 0) { enemy._spentTowers.add(enemy._engaged); enemy._engaged = null; }
            } else { enemy._engaged = null; }   // tower died mid-volley
          }
          continue;   // frozen this tick while bombarding
        }
        enemy._engaged = null;
        // look for a fresh tower in range we haven't already shelled
        const ea = this.enemyAxial(enemy);
        const ec = { q: Math.round(ea.q), r: Math.round(ea.r) };
        let near = null, nearD = Infinity;
        for (const tw of this.towers.values()) {
          if (enemy._spentTowers.has(tw.id)) continue;
          const d = hexDistance(ec, { q: tw.q, r: tw.r });
          if (d <= enemy.attackRange && d < nearD) { nearD = d; near = tw; }
        }
        if (near) {
          enemy._engaged = near.id;
          enemy._shotsLeft = enemy.shotsPerTower;
          enemy._haltUntil = now + enemy.haltMaxMs;
          enemy._nextShotAt = now;   // first shot immediately
          continue;                  // begin bombarding next ticks
        }
      }

      enemy.t += enemy.speed * dt;`
);

// ── 3) Add _fireRocket: damages the tower (or just FX if towers are invulnerable)
//      and emits the bezier rocket so the client animates smoke trail + explosion ──
s = s.replace(
  `  // Compute world-ish position used for targeting (axial, fractional).
  enemyAxial(enemy) {`,
  `  // An enemy lobs a rocket at a tower: emit a bezier arc (enemy -> tower) for the
  // client to animate (smoke trail + fiery explosion). Towers have no HP pool yet,
  // so this is pressure/spectacle; we still emit a hit so the client can shake it.
  _fireRocket(enemy, tower) {
    const ea = this.enemyAxial(enemy);
    this.emit('enemy:rocket', {
      enemyId: enemy.id,
      towerId: tower.id,
      from: { q: ea.q, r: ea.r },
      to: { q: tower.q, r: tower.r },
      damage: enemy.rocketDamage,
    });
  }

  // Compute world-ish position used for targeting (axial, fractional).
  enemyAxial(enemy) {`
);

fs.writeFileSync(F, s);
console.log('instance.js: enemies halt to fire 2 rockets at in-range towers (enemy:rocket emitted)');
