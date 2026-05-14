/**
 * Wave engine - server-authoritative TD simulation.
 *
 * One GameInstance per active run. The engine ticks at GAME_TICK_HZ,
 * advances enemies along the precomputed path, processes tower firing,
 * and emits state diffs over Socket.IO.
 *
 * Lifecycle:
 *   new GameInstance(run, map, ioRoom)
 *   .start() -> begins ticking
 *   .placeTower(towerDef, q, r) -> mutates state
 *   .stop() -> halts tick, marks run finished
 *
 * State diffs are intentionally small - clients render with interpolation.
 */
import { findDefaultPath } from './pathfinding.js';
import { hexDistance, hexKey } from './hex-grid.js';

export const GAME_TICK_HZ = 20;
export const TICK_MS = 1000 / GAME_TICK_HZ;

let nextEntityId = 1;
const newId = () => `e${nextEntityId++}`;

/**
 * Enemy archetypes - kept tiny for now, expand as wave designer grows.
 */
const ENEMY_TYPES = {
  basic:  { hp: 20,  speed: 1.5, reward: 5,  color: 0x88ff88 },
  fast:   { hp: 12,  speed: 3.0, reward: 7,  color: 0xffff66 },
  tank:   { hp: 80,  speed: 0.8, reward: 15, color: 0xff6644 },
};

export class GameInstance {
  constructor({ run, map, io }) {
    this.run = run;
    this.map = map;
    this.io = io;
    this.room = `run:${run._id}`;

    // Precompute path once. If no path, instance is unstartable.
    this.path = findDefaultPath(map);

    // Live state
    this.enemies = new Map();   // id -> { id, type, hp, hpMax, pathIndex, t, ... }
    this.towers = new Map();    // hexKey -> { id, towerDef, q, r, cooldown }
    this.projectiles = [];      // ephemeral, client-side animation only

    this.tickHandle = null;
    this.waveIndex = -1;
    this.waveQueue = [];        // pending spawns in current wave
    this.intermissionUntil = 0;
    this.lastSpawnAt = 0;
    this.tickCount = 0;
    this.startedAt = Date.now();
  }

  start() {
    if (!this.path) {
      this.emit('run:error', { error: 'No valid path from spawn to base' });
      return false;
    }
    this.emit('run:started', {
      runId: String(this.run._id),
      path: this.path,
      tickHz: GAME_TICK_HZ,
    });
    this.startNextWave();
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    return true;
  }

  stop(status = 'abandoned') {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.run.status = status;
    this.run.endedAt = new Date();
    this.run.durationMs = Date.now() - this.startedAt;
    this.emit('run:ended', {
      status,
      score: this.run.score,
      durationMs: this.run.durationMs,
    });
  }

  emit(event, payload) {
    if (this.io) this.io.to(this.room).emit(event, payload);
  }

  // ---- Wave management ---------------------------------------------------

  startNextWave() {
    this.waveIndex++;
    const wave = this.map.waves?.[this.waveIndex];
    if (!wave) {
      // No more waves and no enemies left = victory
      if (this.enemies.size === 0) this.win();
      return;
    }
    // Flatten wave enemies into a spawn queue with timing
    this.waveQueue = [];
    let elapsed = 0;
    for (const group of wave.enemies) {
      for (let i = 0; i < group.count; i++) {
        this.waveQueue.push({ type: group.type, spawnAt: this.startedAt + this.tickCount * TICK_MS + elapsed });
        elapsed += group.delayMs;
      }
    }
    this.intermissionUntil = 0;
    this.emit('wave:start', { wave: this.waveIndex, totalEnemies: this.waveQueue.length });
  }

  // ---- Tower placement ---------------------------------------------------

  placeTower(towerDef, q, r) {
    const key = hexKey(q, r);
    if (this.towers.has(key)) return { ok: false, error: 'occupied' };
    if (this.run.currency < towerDef.stats.cost) return { ok: false, error: 'insufficient currency' };

    // Cannot place on path/spawn/base/blocked
    const role = this.roleAt(q, r);
    if (['path', 'spawn', 'base', 'blocked'].includes(role)) {
      return { ok: false, error: `cannot place on ${role}` };
    }

    this.run.currency -= towerDef.stats.cost;
    const tower = {
      id: newId(),
      towerDef,
      q, r,
      cooldown: 0,
    };
    this.towers.set(key, tower);
    this.emit('tower:placed', {
      id: tower.id,
      towerId: String(towerDef._id || ''),
      gltfUrl: towerDef.gltfUrl,
      q, r,
      currency: this.run.currency,
    });
    return { ok: true, tower };
  }

  roleAt(q, r) {
    const k = hexKey(q, r);
    const has = (arr) => arr?.some(h => hexKey(h.q, h.r) === k);
    if (has(this.map.spawnHexes)) return 'spawn';
    if (has(this.map.baseHexes)) return 'base';
    if (has(this.map.pathHexes)) return 'path';
    if (has(this.map.blockedHexes)) return 'blocked';
    return 'open';
  }

  // ---- Tick loop ---------------------------------------------------------

  tick() {
    this.tickCount++;
    const now = Date.now();

    // 1. Spawn from wave queue
    while (this.waveQueue.length && this.waveQueue[0].spawnAt <= now) {
      const spec = this.waveQueue.shift();
      this.spawnEnemy(spec.type);
    }

    // 2. Move enemies along the path
    this.moveEnemies();

    // 3. Tower targeting + firing
    this.fireTowers();

    // 4. Wave completion check
    if (this.waveQueue.length === 0 && this.enemies.size === 0 && !this.intermissionUntil) {
      const wave = this.map.waves?.[this.waveIndex];
      if (!wave) { this.win(); return; }
      this.intermissionUntil = now + (wave.intermissionMs || 5000);
      this.emit('wave:cleared', { wave: this.waveIndex });
    }
    if (this.intermissionUntil && now >= this.intermissionUntil) {
      this.intermissionUntil = 0;
      this.startNextWave();
    }

    // 5. Periodic state snapshot (4 Hz)
    if (this.tickCount % 5 === 0) this.broadcastSnapshot();
  }

  spawnEnemy(type) {
    const tpl = ENEMY_TYPES[type] || ENEMY_TYPES.basic;
    const enemy = {
      id: newId(),
      type,
      hp: tpl.hp,
      hpMax: tpl.hp,
      speed: tpl.speed,
      reward: tpl.reward,
      pathIndex: 0,
      t: 0, // 0..1 progress between pathIndex and pathIndex+1
    };
    this.enemies.set(enemy.id, enemy);
    this.emit('enemy:spawned', {
      id: enemy.id,
      type: enemy.type,
      hp: enemy.hp,
      hpMax: enemy.hpMax,
      color: tpl.color,
    });
  }

  moveEnemies() {
    const dt = TICK_MS / 1000;
    for (const enemy of this.enemies.values()) {
      enemy.t += enemy.speed * dt;
      while (enemy.t >= 1 && enemy.pathIndex < this.path.length - 1) {
        enemy.t -= 1;
        enemy.pathIndex++;
      }
      if (enemy.pathIndex >= this.path.length - 1) {
        // reached the base
        this.run.baseHealth -= 10;
        this.enemies.delete(enemy.id);
        this.emit('enemy:reached-base', { id: enemy.id, baseHealth: this.run.baseHealth });
        if (this.run.baseHealth <= 0) { this.lose(); return; }
      }
    }
  }

  // Compute world-ish position used for targeting (axial, fractional).
  enemyAxial(enemy) {
    const a = this.path[enemy.pathIndex];
    const b = this.path[Math.min(enemy.pathIndex + 1, this.path.length - 1)];
    return {
      q: a.q + (b.q - a.q) * enemy.t,
      r: a.r + (b.r - a.r) * enemy.t,
    };
  }

  fireTowers() {
    const dt = TICK_MS / 1000;
    for (const tower of this.towers.values()) {
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      if (tower.cooldown > 0) continue;

      const target = this.pickTarget(tower);
      if (!target) continue;

      target.hp -= tower.towerDef.stats.damage;
      tower.cooldown = 1 / tower.towerDef.stats.fireRate;

      this.emit('tower:fired', {
        towerId: tower.id,
        targetId: target.id,
        damage: tower.towerDef.stats.damage,
      });

      if (target.hp <= 0) {
        this.run.currency += target.reward;
        this.run.score += target.reward;
        this.enemies.delete(target.id);
        this.emit('enemy:killed', {
          id: target.id,
          reward: target.reward,
          currency: this.run.currency,
          score: this.run.score,
        });
      }
    }
  }

  pickTarget(tower) {
    const targeting = tower.towerDef.behavior?.targeting || 'first';
    const range = tower.towerDef.stats.range;
    const candidates = [];
    for (const e of this.enemies.values()) {
      const ea = this.enemyAxial(e);
      const d = hexDistance({ q: tower.q, r: tower.r }, { q: Math.round(ea.q), r: Math.round(ea.r) });
      if (d <= range) candidates.push({ enemy: e, dist: d });
    }
    if (!candidates.length) return null;

    switch (targeting) {
      case 'nearest':
        candidates.sort((a, b) => a.dist - b.dist);
        break;
      case 'last':
        candidates.sort((a, b) => a.enemy.pathIndex - b.enemy.pathIndex);
        break;
      case 'strongest':
        candidates.sort((a, b) => b.enemy.hp - a.enemy.hp);
        break;
      case 'weakest':
        candidates.sort((a, b) => a.enemy.hp - b.enemy.hp);
        break;
      case 'first':
      default:
        candidates.sort((a, b) => b.enemy.pathIndex - a.enemy.pathIndex || b.enemy.t - a.enemy.t);
    }
    return candidates[0].enemy;
  }

  broadcastSnapshot() {
    const enemies = [];
    for (const e of this.enemies.values()) {
      const a = this.enemyAxial(e);
      enemies.push({ id: e.id, q: a.q, r: a.r, hp: e.hp });
    }
    this.emit('state:tick', {
      tick: this.tickCount,
      enemies,
      baseHealth: this.run.baseHealth,
      currency: this.run.currency,
      score: this.run.score,
      wave: this.waveIndex,
      intermission: this.intermissionUntil > 0,
    });
  }

  win()  { this.stop('won'); }
  lose() { this.stop('lost'); }
}

/**
 * Active games registry.
 */
const activeGames = new Map(); // runId -> GameInstance

export function getGame(runId) { return activeGames.get(String(runId)); }
export function registerGame(runId, game) { activeGames.set(String(runId), game); }
export function unregisterGame(runId) { activeGames.delete(String(runId)); }
export function listGames() { return Array.from(activeGames.values()); }
