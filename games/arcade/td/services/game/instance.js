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
import { findDefaultPath, findAllPaths } from './pathfinding.js';
import { hexDistance, hexKey } from './hex-grid.js';
import { bark } from '../ai/npc.js';
import { Deck } from '../cards/deck.js';
import { ENEMY_TYPES } from './enemy-types.js';
import { StoryDirector } from './story-director.js';

export const GAME_TICK_HZ = 20;
export const TICK_MS = 1000 / GAME_TICK_HZ;

let nextEntityId = 1;
const newId = () => `e${nextEntityId++}`;

/**
 * Enemy archetypes - kept tiny for now, expand as wave designer grows.
 */

export class GameInstance {
  constructor({ run, map, io, towers = [], onEnd = null, actionHand = [], actionSlots = 5, level = 1, drawCard = null, enemyTypes = null, inventory = null, armCost = 5 }) {
    this.run = run;
    this.map = map;
    this.io = io;
    this.room = `run:${run._id}`;

    // Precompute EVERY spawn->base path once (multi-spawn / Siege). this.path is
    // the first routable path, kept for back-compat + the start gate.
    this.paths = (findAllPaths(map) || []).map((p) => p.hexes).filter((h) => h && h.length);
    if (!this.paths.length) { const dp = findDefaultPath(map); if (dp) this.paths = [dp]; }
    this.path = this.paths[0] || null;
    this._spawnRR = 0;   // round-robin index across spawn paths

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
    this._lastBarkAt = 0;
    this.deck = new Deck(towers);
    this.onEnd = onEnd;
    this.towersBuilt = 0;
    this._stopped = false;
    this.actionHand = actionHand;
    this.actionSlots = actionSlots;
    this.level = level;
    this.drawCard = drawCard;
    this.enemyTypes = enemyTypes;
    this.paused = false;
    this.story = new StoryDirector(arguments[0].story || null);
    this._lastBasePct = 100;
    // public tactical pause: a budget of pauses per run (default 3, +1 each wave clear up to a cap)
    this.pauseBudget = arguments[0].pauseBudget ?? 3;
    this.pausesUsed = 0;
    this.pauseCapBonusPerWave = 1;
    this.pauseMaxBudget = arguments[0].pauseMaxBudget ?? 8;
    this._tacticalPaused = false;

    // ---- DEPLOYABLE INVENTORY (economy v2) --------------------------------
    // Towers are no longer bought with run currency. The player deploys from a
    // pre-built stable (lobby) plus a per-level base loadout, and arming each
    // placement costs ammo (one-time). deployable maps towerId -> count left.
    this.armCost = armCost;
    this.ammo = inventory?.ammo ?? 0;
    this.deployable = new Map();   // towerId(string) -> remaining deployable count
    for (const t of (inventory?.builtTowers || [])) {
      this.deployable.set(String(t.towerId), (this.deployable.get(String(t.towerId)) || 0) + (t.count || 0));
    }
    // base loadout the map grants for free this run (towerId -> count)
    for (const b of (map.baseLoadout || [])) {
      this.deployable.set(String(b.towerId), (this.deployable.get(String(b.towerId)) || 0) + (b.count || 0));
    }

    // ---- LOOT: drops on kill ----------------------------------------------
    // ~1/8 kills drop ammo OR a tower component; ~1/16–1/32 drop token currency.
    // Loot accumulates on the run; the client shows a pickup pop at the kill spot.
    this.loot = { ammo: 0, components: 0, tokens: 0 };
    this.lootOdds = {
      supply: 1 / 8,        // ammo or component (split 50/50)
      token: 1 / 24,        // token currency (between 1/16 and 1/32)
    };
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
    this.say("run:start", { mapName: this.map.name, currency: this.run.currency });
    this.emit("cards:hand", { hand: this.deck.deal() });
    this.emit("action:hand", { hand: this.actionHand });
    this.emitDeployState();
    this.emitForecast();
    if (this.story?.enabled) {
      this.story.onRunStart({ mapName: this.map.name }, (fx) => this._applyFx(fx))
        .then((beats) => this._fireStory(beats)).catch(() => {});
    }
    this.startNextWave();
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    return true;
  }

  stop(status = "abandoned") {
    if (this._stopped) return;
    this._stopped = true;
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.run.status = status;
    this.run.currentWave = Math.max(this.waveIndex, 0);
    this.run.endedAt = new Date();
    this.run.durationMs = Date.now() - this.startedAt;
    this.emit("run:ended", {
      status,
      score: this.run.score,
      wave: this.run.currentWave,
      durationMs: this.run.durationMs,
    });
    if (this.onEnd) {
      Promise.resolve(this.onEnd({
        run: this.run,
        status,
        score: this.run.score,
        waveReached: this.run.currentWave,
        towersBuilt: this.towersBuilt,
        loot: this.loot,
        ammoLeft: this.ammo,
        deployableLeft: Object.fromEntries(this.deployable),
      })).catch(err => console.error("[engine] onEnd hook failed:", err));
    }
  }

  emit(event, payload) {
    if (this.io) this.io.to(this.room).emit(event, payload);
  }

  // Apply a story beat's gameplay effects (currency / heal).
  _applyFx(fx = {}) {
    if (fx.grantCurrency) { this.run.currency += fx.grantCurrency; }
    if (fx.healBase) { this.run.baseHealth = Math.min(100, this.run.baseHealth + fx.healBase); }
  }

  // Emit a set of story beats (from a director hook). If any beat requests a
  // narrative pause, halt the wave loop; the client resumes via 'story:dismiss'.
  _fireStory(payloads) {
    if (!payloads || !payloads.length) return;
    let wantPause = false;
    for (const p of payloads) {
      this.emit('story:beat', p);
      if (p.pause) wantPause = true;
    }
    if (wantPause) this.pauseForStory();
    // effects may have changed currency/base — refresh the client
    this.broadcastSnapshot();
  }

  // A story-driven pause (distinct from the admin bug-button pause so resume
  // logic can tell them apart). Halts ticking until 'story:dismiss'.
  pauseForStory() {
    if (this._stopped || this.paused) return;
    this.paused = true; this._storyPaused = true;
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
  }
  resumeFromStory() {
    if (this._stopped || !this._storyPaused) return;
    this._storyPaused = false; this.paused = false;
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  // Fire-and-forget NPC bark. Never awaited - resolves to LLM line or fallback.
  // Throttled so non-terminal events cannot flood the GPU tunnel.
  say(evt, ctx = {}) {
    const terminal = evt === 'run:won' || evt === 'run:lost' || evt === 'run:start';
    const now = Date.now();
    if (!terminal && now - this._lastBarkAt < 3500) return;
    this._lastBarkAt = now;
    Promise.resolve(bark(evt, ctx))
      .then(line => this.emit('npc:say', { event: evt, line }))
      .catch(() => {});
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
    // Flatten wave enemies into a spawn queue with timing. Each group spawns its
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
    this.waveQueue.sort((a, b) => a.spawnAt - b.spawnAt);
    this.intermissionUntil = 0;
    this.emit('wave:start', { wave: this.waveIndex, totalEnemies: this.waveQueue.length });
    this.say('wave:start', { wave: this.waveIndex, totalEnemies: this.waveQueue.length });
    if (this.story?.enabled) {
      this.story.onWaveStart(this.waveIndex, { wave: this.waveIndex }, (fx) => this._applyFx(fx))
        .then((beats) => this._fireStory(beats)).catch(() => {});
    }
    this.emitForecast();
  }

  // ---- Tower placement ---------------------------------------------------

  placeTower(towerDef, q, r) {
    const key = hexKey(q, r);
    if (this.towers.has(key)) return { ok: false, error: 'occupied' };

    // Cannot place on path/spawn/base/blocked
    const role = this.roleAt(q, r);
    if (['path', 'spawn', 'base', 'blocked'].includes(role)) {
      return { ok: false, error: `cannot place on ${role}` };
    }

    // Economy v2: must own a built/loadout tower of this type, and have ammo to arm it.
    const tid = String(towerDef._id || '');
    const have = this.deployable.get(tid) || 0;
    if (have <= 0) return { ok: false, error: 'none in inventory — build one in the lobby' };
    if (this.ammo < this.armCost) return { ok: false, error: 'out of ammo' };

    this.deployable.set(tid, have - 1);
    this.ammo -= this.armCost;
    const tower = {
      id: newId(),
      towerDef,
      q, r,
      cooldown: 0,
      mods: [],
    };
    this.towers.set(key, tower);
    this.emit('tower:placed', {
      id: tower.id,
      towerId: String(towerDef._id || ''),
      gltfUrl: towerDef.gltfUrl,
      scale: towerDef.scale,
      q, r,
      currency: this.run.currency,
    });
    const card = this.deck.findByTower(towerDef._id);
    if (card) this.emit("cards:hand", { hand: this.deck.replace(card.cardId) });
    this.towersBuilt++;
    this.emitDeployState();
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
      this.rewardActionCard();
      // reward tactical pauses for surviving a wave (capped)
      if (this.pauseBudget < this.pauseMaxBudget) {
        this.pauseBudget = Math.min(this.pauseMaxBudget, this.pauseBudget + this.pauseCapBonusPerWave);
        this.emit('run:pause-budget', { pauseBudget: this.pauseBudget, pausesLeft: Math.max(0, this.pauseBudget - this.pausesUsed) });
      }
      if (this.story?.enabled) {
        this.story.onWaveCleared(this.waveIndex, { wave: this.waveIndex }, (fx) => this._applyFx(fx))
          .then((beats) => this._fireStory(beats)).catch(() => {});
      }
    }
    if (this.intermissionUntil && now >= this.intermissionUntil) {
      this.intermissionUntil = 0;
      this.startNextWave();
    }

    // 5. Periodic state snapshot (4 Hz)
    if (this.tickCount % 2 === 0) this.broadcastSnapshot();
  }

  spawnEnemy(type, opts = {}) {
    const base = ENEMY_TYPES[type] || ENEMY_TYPES.basic;
    const tpl = (this.enemyTypes && this.enemyTypes[type]) ? { ...base, ...this.enemyTypes[type] } : base;
    // if this unit is disguised, it renders as its disguise type until exposed
    const disguiseType = opts.disguiseAs || tpl.disguise || null;
    const enemy = {
      id: newId(),
      type,
      hp: tpl.hp, hpMax: tpl.hp,
      speed: tpl.speed, reward: tpl.reward,
      armor: tpl.armor || 0,
      threat: tpl.threat || 1,
      aggro: tpl.aggro || 'Advances on the core',
      ability: tpl.ability || 'None',
      ground: tpl.ground !== false,
      disguiseType,           // non-null => blended into the crowd
      exposed: false,
      pathIndex: 0, t: 0,
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
    };
    this.enemies.set(enemy.id, enemy);
    this.emit('enemy:spawned', {
      id: enemy.id,
      // clients see the DISGUISE type/color while hidden (Where's-Waldo)
      type: disguiseType || enemy.type,
      hp: enemy.hp, hpMax: enemy.hpMax,
      color: (ENEMY_TYPES[disguiseType] || tpl).color,
      disguised: !!disguiseType,
    });
  }

  // Tell the client what it can still deploy + how much ammo remains.
  emitDeployState() {
    this.emit('run:deploy-state', {
      ammo: this.ammo,
      armCost: this.armCost,
      deployable: Object.fromEntries(this.deployable),
    });
  }

  enemyPath(enemy) { return this.paths[enemy.pathId] || this.path; }

  moveEnemies() {
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

      enemy.t += enemy.speed * dt;
      while (enemy.t >= 1 && enemy.pathIndex < path.length - 1) {
        enemy.t -= 1;
        enemy.pathIndex++;
      }
      if (enemy.pathIndex >= path.length - 1) {
        // reached the base
        this.run.baseHealth -= 10;
        this.enemies.delete(enemy.id);
        this.emit('enemy:reached-base', { id: enemy.id, baseHealth: this.run.baseHealth });
        this.say('base:hit', { baseHealth: this.run.baseHealth });
        if (this.story?.enabled) {
          const pct = this.run.baseHealth;
          if (pct < this._lastBasePct) {
            this._lastBasePct = pct;
            this.story.onBaseChanged(pct, { baseHealth: pct }, (fx) => this._applyFx(fx))
              .then((beats) => this._fireStory(beats)).catch(() => {});
          }
        }
        if (this.run.baseHealth <= 0) { this.lose(); return; }
      }
    }
  }

  // An enemy lobs a rocket at a tower: emit a bezier arc (enemy -> tower) for the
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
  enemyAxial(enemy) {
    const path = this.enemyPath(enemy);
    const a = path[enemy.pathIndex];
    const b = path[Math.min(enemy.pathIndex + 1, path.length - 1)];
    return {
      q: a.q + (b.q - a.q) * enemy.t,
      r: a.r + (b.r - a.r) * enemy.t,
    };
  }

  // Effective stat = (base + additive mods) * multiplicative mods, expiring temps.
  effectiveStat(tower, stat) {
    let base = stat === 'splash'
      ? (tower.towerDef.behavior?.splashRadius || 0)
      : (tower.towerDef.stats?.[stat] || 0);
    let add = 0, mult = 1;
    const now = Date.now();
    for (const m of (tower.mods || [])) {
      if (m.stat !== stat) continue;
      if (m.expiresAt && m.expiresAt < now) continue;
      if (m.mode === 'add') add += m.value; else mult *= m.value;
    }
    return (base + add) * mult;
  }

  // Roll loot for a kill. Returns a drop descriptor {kind, item, amount} or null.
  // Tougher enemies (higher threat) tilt supply drops toward components.
  _rollLoot(enemy) {
    const roll = Math.random();
    // token currency is the rarer tier
    if (roll < this.lootOdds.token) {
      const amount = 1 + Math.floor(Math.random() * 2);   // 1–2 tokens
      this.loot.tokens += amount;
      return { kind: 'token', item: 'token', amount };
    }
    // supply tier (ammo or component), checked after tokens so the bands don't overlap
    if (roll < this.lootOdds.token + this.lootOdds.supply) {
      const threat = enemy.threat || 1;
      const componentChance = Math.min(0.7, 0.3 + threat * 0.08);  // beefier foes drop parts more
      if (Math.random() < componentChance) {
        this.loot.components += 1;
        return { kind: 'supply', item: 'component', amount: 1 };
      }
      const amount = 2 + Math.floor(Math.random() * 4);   // 2–5 ammo
      this.loot.ammo += amount;
      return { kind: 'supply', item: 'ammo', amount };
    }
    return null;
  }

  applyDamage(enemy, dmg) {
    if (!this.enemies.has(enemy.id)) return;
    const eff = Math.max(1, dmg - (enemy.armor || 0));   // armor reduces each hit (min 1)
    enemy.hp -= eff;
    if (enemy.hp <= 0) {
      this.run.currency += enemy.reward;
      this.run.score += enemy.reward;
      const drop = this._rollLoot(enemy);     // may add to this.loot + return a drop descriptor
      this.enemies.delete(enemy.id);
      this.emit('enemy:killed', {
        id: enemy.id, reward: enemy.reward,
        currency: this.run.currency, score: this.run.score,
      });
      if (drop) {
        const a = this.enemyAxial(enemy);      // where to pop the pickup
        this.emit('loot:drop', { ...drop, q: a.q, r: a.r, loot: this.loot });
      }
    }
  }

  fireTowers() {
    const dt = TICK_MS / 1000;
    for (const tower of this.towers.values()) {
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      if (tower.cooldown > 0) continue;

      const target = this.pickTarget(tower);
      if (!target) continue;

      const dmg = this.effectiveStat(tower, 'damage');
      const rate = Math.max(0.1, this.effectiveStat(tower, 'fireRate'));
      const splash = this.effectiveStat(tower, 'splash');

      this.applyDamage(target, dmg);
      if (splash > 0) {
        const ta = this.enemyAxial(target);
        const tc = { q: Math.round(ta.q), r: Math.round(ta.r) };
        for (const e of [...this.enemies.values()]) {
          if (e.id === target.id) continue;
          const ea = this.enemyAxial(e);
          if (hexDistance(tc, { q: Math.round(ea.q), r: Math.round(ea.r) }) <= splash) {
            this.applyDamage(e, dmg * 0.5);
          }
        }
      }
      tower.cooldown = 1 / rate;
      this.emit('tower:fired', { towerId: tower.id, targetId: target.id, damage: dmg });
    }
  }

  pickTarget(tower) {
    const targeting = tower.towerDef.behavior?.targeting || 'first';
    const range = this.effectiveStat(tower, 'range');
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
      loot: this.loot,
    });
  }

  // Play an action card from the hand onto a placed tower (or the base).
  playActionCard(instanceId, towerId) {
    const idx = this.actionHand.findIndex(c => c && c.instanceId === instanceId);
    if (idx === -1) return { ok: false, error: 'card not in hand' };
    const card = this.actionHand[idx];
    const eff = card.effect || {};
    if (eff.kind === 'base-heal') {
      this.run.baseHealth = Math.min(100, this.run.baseHealth + (eff.value || 0));
      this.emit('base:healed', { baseHealth: this.run.baseHealth, amount: eff.value || 0 });
    } else {
      const tower = [...this.towers.values()].find(t => t.id === towerId);
      if (!tower) return { ok: false, error: 'no such tower' };
      tower.mods = tower.mods || [];
      tower.mods.push({
        stat: eff.stat, mode: eff.mode, value: eff.value,
        expiresAt: eff.durationMs ? Date.now() + eff.durationMs : 0,
      });
      this.emit('tower:buffed', {
        towerId: tower.id, slug: card.slug, icon: card.icon, name: card.name,
        stat: eff.stat, durationMs: eff.durationMs || 0,
      });
    }
    this.actionHand.splice(idx, 1);
    this.emit('action:hand', { hand: this.actionHand });
    return { ok: true };
  }

  // Reward a fresh generic action card when a wave is cleared (up to slots).
  rewardActionCard() {
    if (!this.drawCard || this.actionHand.length >= this.actionSlots) return;
    Promise.resolve(this.drawCard()).then(card => {
      if (card && this.actionHand.length < this.actionSlots) {
        this.actionHand.push(card);
        this.emit('action:hand', { hand: this.actionHand, drew: card.slug });
      }
    }).catch(() => {});
  }

  // ---- Bug-button: pause / resume / live tuning -------------------------
  pause() {
    if (this._stopped || this.paused) return;
    this.paused = true;
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.emit('run:paused', {});
  }

  resume() {
    if (this._stopped || !this.paused) return;
    this.paused = false;
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    this.emit('run:resumed', {});
  }

  // ---- PUBLIC tactical pause (any player) -------------------------------
  // Spends one pause from the budget, halts the loop, and ships an analysis
  // snapshot: every enemy's hp/aggro/ability + whether a disguised unit is on
  // the board (the Where's-Waldo target). Resume via resumeFromTactical().
  tacticalPause() {
    if (this._stopped) return { ok: false, error: 'run over' };
    if (this.paused) return { ok: false, error: 'already paused' };
    if (this.pausesUsed >= this.pauseBudget) return { ok: false, error: 'no pauses left' };
    this.pausesUsed++;
    this.paused = true; this._tacticalPaused = true;
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.emit('run:tactical', this.tacticalSnapshot());
    return { ok: true };
  }

  resumeFromTactical() {
    if (this._stopped || !this._tacticalPaused) return;
    this._tacticalPaused = false; this.paused = false;
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    this.emit('run:resumed', { tactical: true });
  }

  tacticalSnapshot() {
    const enemies = [];
    let disguisedOnBoard = false;
    for (const e of this.enemies.values()) {
      const a = this.enemyAxial(e);
      if (e.disguiseType && !e.exposed) disguisedOnBoard = true;
      enemies.push({
        id: e.id,
        type: e.disguiseType && !e.exposed ? e.disguiseType : e.type,
        realType: e.type,
        hp: Math.ceil(e.hp), hpMax: e.hpMax,
        speed: e.speed, armor: e.armor || 0, threat: e.threat || 1,
        aggro: e.aggro, ability: e.ability, ground: e.ground !== false,
        disguised: !!(e.disguiseType && !e.exposed),
        q: a.q, r: a.r, pathIndex: e.pathIndex,
      });
    }
    return {
      enemies,
      pausesUsed: this.pausesUsed,
      pauseBudget: this.pauseBudget,
      pausesLeft: Math.max(0, this.pauseBudget - this.pausesUsed),
      disguisedOnBoard,
      baseHealth: this.run.baseHealth,
      currency: this.run.currency,
      wave: this.waveIndex,
    };
  }

  // ---- Where's-Waldo: expose (and bounty-kill) a disguised infiltrator ----
  // Called when a player taps an enemy during a tactical pause. Correct guess
  // exposes it (drops its disguise) and pays a bounty; wrong guess wastes nothing
  // but reports a miss so the UI can react.
  exposeDisguised(enemyId) {
    const e = this.enemies.get(enemyId);
    if (!e) return { ok: false, error: 'no such enemy' };
    if (!e.disguiseType || e.exposed) return { ok: false, error: 'not disguised', miss: true };
    e.exposed = true;
    const bounty = Math.round((e.reward || 10) * 1.5);
    this.run.currency += bounty;
    this.run.score += bounty;
    this.emit('enemy:exposed', { id: e.id, realType: e.type, color: (ENEMY_TYPES[e.type] || {}).color, bounty, currency: this.run.currency, score: this.run.score });
    // fire a story objective hook if a director is listening
    if (this.story?.enabled) {
      this.story.onObjective('expose-infiltrator', true, { id: e.id }, (fx) => this._applyFx(fx))
        .then((b) => this._fireStory(b)).catch(() => {});
    }
    return { ok: true, bounty };
  }

  // Live-adjust a field on a tower, an enemy, a future-spawn enemy type, or the run.
  tune({ target, id, slug, field, value }) {
    const num = Number(value);
    if (Number.isNaN(num)) return { ok: false, error: 'value must be numeric' };
    if (target === 'tower') {
      const tower = [...this.towers.values()].find(t => t.id === id);
      if (!tower) return { ok: false, error: 'tower not found' };
      if (!['damage', 'range', 'fireRate', 'cost', 'projectileSpeed'].includes(field)) return { ok: false, error: 'bad field' };
      tower.towerDef.stats[field] = num;
      this.emit('tower:tuned', { towerId: id, field, value: num });
      return { ok: true };
    }
    if (target === 'enemy') {
      const e = this.enemies.get(id);
      if (!e) return { ok: false, error: 'enemy not found' };
      if (!['hp', 'speed', 'reward'].includes(field)) return { ok: false, error: 'bad field' };
      e[field] = num;
      if (field === 'hp') e.hpMax = Math.max(e.hpMax, num);
      this.emit('enemy:tuned', { id, field, value: num });
      return { ok: true };
    }
    if (target === 'enemyType') {
      this.enemyTypes = this.enemyTypes || {};
      this.enemyTypes[slug] = { ...(this.enemyTypes[slug] || {}), [field]: num };
      return { ok: true };
    }
    if (target === 'run') {
      if (!['baseHealth', 'currency', 'score'].includes(field)) return { ok: false, error: 'bad field' };
      this.run[field] = num;
      this.broadcastSnapshot();
      return { ok: true };
    }
    return { ok: false, error: 'unknown target' };
  }

  // Summarize upcoming waves for the 'incoming walls' forecast UI.
  forecast(count = 3) {
    const waves = this.map.waves || [];
    const start = Math.max(this.waveIndex, 0);
    const out = [];
    for (let i = start; i < waves.length && out.length < count; i++) {
      const groups = (waves[i].enemies || []).map(g => ({ type: g.type, count: g.count }));
      out.push({ index: i, total: groups.reduce((s, g) => s + g.count, 0), enemies: groups });
    }
    return out;
  }

  emitForecast() {
    this.emit('walls:forecast', { current: Math.max(this.waveIndex, 0), waves: this.forecast() });
  }

  win()  {
    this.say('run:won', { baseHealth: this.run.baseHealth, score: this.run.score });
    if (this.story?.enabled) this.story.onWon({ score: this.run.score }, (fx) => this._applyFx(fx)).then((b) => this._fireStory(b)).catch(() => {});
    this.stop('won');
  }
  lose() {
    this.say('run:lost', { score: this.run.score });
    if (this.story?.enabled) this.story.onLost({ score: this.run.score }, (fx) => this._applyFx(fx)).then((b) => this._fireStory(b)).catch(() => {});
    this.stop('lost');
  }
}


