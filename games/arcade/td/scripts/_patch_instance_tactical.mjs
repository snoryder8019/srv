import fs from 'fs';
const F = '/srv/td/services/game/instance.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('tacticalPause')) { console.log('already'); process.exit(0); }

// 1) pause budget + tactical state in the constructor
s = s.replace(
  `    this.paused = false;
    this.story = new StoryDirector(arguments[0].story || null);
    this._lastBasePct = 100;
  }`,
  `    this.paused = false;
    this.story = new StoryDirector(arguments[0].story || null);
    this._lastBasePct = 100;
    // public tactical pause: a budget of pauses per run (default 3, +1 each wave clear up to a cap)
    this.pauseBudget = arguments[0].pauseBudget ?? 3;
    this.pausesUsed = 0;
    this.pauseCapBonusPerWave = 1;
    this.pauseMaxBudget = arguments[0].pauseMaxBudget ?? 8;
    this._tacticalPaused = false;
  }`
);

// 2) keep enemy analysis fields on spawn so the tactical readout has data, and
//    carry a `disguise` (the unit renders as another type) for the Waldo objective.
s = s.replace(
  `  spawnEnemy(type) {
    const tpl = (this.enemyTypes && this.enemyTypes[type]) || ENEMY_TYPES[type] || ENEMY_TYPES.basic;
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
  }`,
  `  spawnEnemy(type, opts = {}) {
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
  }`
);

// 3) apply armor in applyDamage (so the analysis 'armor' value matters)
s = s.replace(
  `  applyDamage(enemy, dmg) {
    if (!this.enemies.has(enemy.id)) return;
    enemy.hp -= dmg;`,
  `  applyDamage(enemy, dmg) {
    if (!this.enemies.has(enemy.id)) return;
    const eff = Math.max(1, dmg - (enemy.armor || 0));   // armor reduces each hit (min 1)
    enemy.hp -= eff;`
);

// 4) PUBLIC tactical pause + resume + analysis snapshot, placed after the
//    admin pause/resume block.
s = s.replace(
  `  resume() {
    if (this._stopped || !this.paused) return;
    this.paused = false;
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    this.emit('run:resumed', {});
  }`,
  `  resume() {
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
  }`
);

// 5) grant a pause back on each wave clear (up to the cap)
s = s.replace(
  `      this.emit('wave:cleared', { wave: this.waveIndex });
      this.rewardActionCard();`,
  `      this.emit('wave:cleared', { wave: this.waveIndex });
      this.rewardActionCard();
      // reward tactical pauses for surviving a wave (capped)
      if (this.pauseBudget < this.pauseMaxBudget) {
        this.pauseBudget = Math.min(this.pauseMaxBudget, this.pauseBudget + this.pauseCapBonusPerWave);
        this.emit('run:pause-budget', { pauseBudget: this.pauseBudget, pausesLeft: Math.max(0, this.pauseBudget - this.pausesUsed) });
      }`
);

fs.writeFileSync(F, s);
console.log('instance.js: public tactical pause + budget + analysis + disguise expose');
