import fs from 'fs';
const F = '/srv/td/services/game/instance.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('loot:drop')) { console.log('already'); process.exit(0); }

// 1) Initialize loot accumulators + drop odds in the constructor.
s = s.replace(
  `    this._tacticalPaused = false;
  }`,
  `    this._tacticalPaused = false;

    // ---- LOOT: drops on kill ----------------------------------------------
    // ~1/8 kills drop ammo OR a tower component; ~1/16–1/32 drop token currency.
    // Loot accumulates on the run; the client shows a pickup pop at the kill spot.
    this.loot = { ammo: 0, components: 0, tokens: 0 };
    this.lootOdds = {
      supply: 1 / 8,        // ammo or component (split 50/50)
      token: 1 / 24,        // token currency (between 1/16 and 1/32)
    };
  }`
);

// 2) Roll loot inside applyDamage on kill (after currency/score, before delete-emit).
s = s.replace(
  `    if (enemy.hp <= 0) {
      this.run.currency += enemy.reward;
      this.run.score += enemy.reward;
      this.enemies.delete(enemy.id);
      this.emit('enemy:killed', {
        id: enemy.id, reward: enemy.reward,
        currency: this.run.currency, score: this.run.score,
      });
    }`,
  `    if (enemy.hp <= 0) {
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
    }`
);

// 3) Add the _rollLoot helper (placed right before applyDamage).
s = s.replace(
  `  applyDamage(enemy, dmg) {`,
  `  // Roll loot for a kill. Returns a drop descriptor {kind, item, amount} or null.
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

  applyDamage(enemy, dmg) {`
);

// 4) Surface loot in the periodic snapshot so the HUD can show running totals.
s = s.replace(
  `    this.emit('state:tick', {
      tick: this.tickCount,
      enemies,
      baseHealth: this.run.baseHealth,
      currency: this.run.currency,
      score: this.run.score,
      wave: this.waveIndex,
      intermission: this.intermissionUntil > 0,
    });`,
  `    this.emit('state:tick', {
      tick: this.tickCount,
      enemies,
      baseHealth: this.run.baseHealth,
      currency: this.run.currency,
      score: this.run.score,
      wave: this.waveIndex,
      intermission: this.intermissionUntil > 0,
      loot: this.loot,
    });`
);

fs.writeFileSync(F, s);
console.log('instance.js: loot drop system (1/8 supply, ~1/24 token) wired into kills');
