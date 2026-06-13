import fs from 'fs';
const F = '/srv/td/services/game/instance.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('StoryDirector')) { console.log('already'); process.exit(0); }

// import
s = s.replace(
  `import { ENEMY_TYPES } from './enemy-types.js';`,
  `import { ENEMY_TYPES } from './enemy-types.js';\nimport { StoryDirector } from './story-director.js';`
);

// accept story in constructor + build director + track base pct for thresholds
s = s.replace(
  `    this.enemyTypes = enemyTypes;
    this.paused = false;
  }`,
  `    this.enemyTypes = enemyTypes;
    this.paused = false;
    this.story = new StoryDirector(arguments[0].story || null);
    this._lastBasePct = 100;
  }`
);

// helper to apply beat effects + an emitter that pauses the loop if a beat asks
s = s.replace(
  `  emit(event, payload) {
    if (this.io) this.io.to(this.room).emit(event, payload);
  }`,
  `  emit(event, payload) {
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
  }`
);

// fire run-start beats right after the deck/forecast setup
s = s.replace(
  `    this.emitForecast();
    this.startNextWave();`,
  `    this.emitForecast();
    if (this.story?.enabled) {
      this.story.onRunStart({ mapName: this.map.name }, (fx) => this._applyFx(fx))
        .then((beats) => this._fireStory(beats)).catch(() => {});
    }
    this.startNextWave();`
);

// fire wave-start beats
s = s.replace(
  `    this.emit('wave:start', { wave: this.waveIndex, totalEnemies: this.waveQueue.length });
    this.say('wave:start', { wave: this.waveIndex, totalEnemies: this.waveQueue.length });`,
  `    this.emit('wave:start', { wave: this.waveIndex, totalEnemies: this.waveQueue.length });
    this.say('wave:start', { wave: this.waveIndex, totalEnemies: this.waveQueue.length });
    if (this.story?.enabled) {
      this.story.onWaveStart(this.waveIndex, { wave: this.waveIndex }, (fx) => this._applyFx(fx))
        .then((beats) => this._fireStory(beats)).catch(() => {});
    }`
);

// fire wave-cleared beats
s = s.replace(
  `      this.emit('wave:cleared', { wave: this.waveIndex });
      this.rewardActionCard();`,
  `      this.emit('wave:cleared', { wave: this.waveIndex });
      this.rewardActionCard();
      if (this.story?.enabled) {
        this.story.onWaveCleared(this.waveIndex, { wave: this.waveIndex }, (fx) => this._applyFx(fx))
          .then((beats) => this._fireStory(beats)).catch(() => {});
      }`
);

// fire base-below threshold beats whenever base health drops
s = s.replace(
  `        this.emit('enemy:reached-base', { id: enemy.id, baseHealth: this.run.baseHealth });
        this.say('base:hit', { baseHealth: this.run.baseHealth });`,
  `        this.emit('enemy:reached-base', { id: enemy.id, baseHealth: this.run.baseHealth });
        this.say('base:hit', { baseHealth: this.run.baseHealth });
        if (this.story?.enabled) {
          const pct = this.run.baseHealth;
          if (pct < this._lastBasePct) {
            this._lastBasePct = pct;
            this.story.onBaseChanged(pct, { baseHealth: pct }, (fx) => this._applyFx(fx))
              .then((beats) => this._fireStory(beats)).catch(() => {});
          }
        }`
);

// fire win/lose beats
s = s.replace(
  `  win()  { this.say('run:won', { baseHealth: this.run.baseHealth, score: this.run.score }); this.stop('won'); }
  lose() { this.say('run:lost', { score: this.run.score }); this.stop('lost'); }`,
  `  win()  {
    this.say('run:won', { baseHealth: this.run.baseHealth, score: this.run.score });
    if (this.story?.enabled) this.story.onWon({ score: this.run.score }, (fx) => this._applyFx(fx)).then((b) => this._fireStory(b)).catch(() => {});
    this.stop('won');
  }
  lose() {
    this.say('run:lost', { score: this.run.score });
    if (this.story?.enabled) this.story.onLost({ score: this.run.score }, (fx) => this._applyFx(fx)).then((b) => this._fireStory(b)).catch(() => {});
    this.stop('lost');
  }`
);

fs.writeFileSync(F, s);
console.log('instance.js: StoryDirector wired into lifecycle');
