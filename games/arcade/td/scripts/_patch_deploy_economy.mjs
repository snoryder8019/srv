import fs from 'fs';
const F = '/srv/td/services/game/instance.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('this.deployable')) { console.log('already'); process.exit(0); }

// 1) Accept inventory in the constructor (built towers + ammo + arm cost) and
//    set up the in-run deployable pools. Currency no longer gates placement.
s = s.replace(
  `  constructor({ run, map, io, towers = [], onEnd = null, actionHand = [], actionSlots = 5, level = 1, drawCard = null, enemyTypes = null }) {`,
  `  constructor({ run, map, io, towers = [], onEnd = null, actionHand = [], actionSlots = 5, level = 1, drawCard = null, enemyTypes = null, inventory = null, armCost = 5 }) {`
);
s = s.replace(
  `    this._tacticalPaused = false;

    // ---- LOOT: drops on kill`,
  `    this._tacticalPaused = false;

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

    // ---- LOOT: drops on kill`
);

// 2) Rewrite placeTower: gate on deployable inventory + ammo arm cost, not currency.
s = s.replace(
  `  placeTower(towerDef, q, r) {
    const key = hexKey(q, r);
    if (this.towers.has(key)) return { ok: false, error: 'occupied' };
    if (this.run.currency < towerDef.stats.cost) return { ok: false, error: 'insufficient currency' };

    // Cannot place on path/spawn/base/blocked
    const role = this.roleAt(q, r);
    if (['path', 'spawn', 'base', 'blocked'].includes(role)) {
      return { ok: false, error: \`cannot place on \${role}\` };
    }

    this.run.currency -= towerDef.stats.cost;
    const tower = {`,
  `  placeTower(towerDef, q, r) {
    const key = hexKey(q, r);
    if (this.towers.has(key)) return { ok: false, error: 'occupied' };

    // Cannot place on path/spawn/base/blocked
    const role = this.roleAt(q, r);
    if (['path', 'spawn', 'base', 'blocked'].includes(role)) {
      return { ok: false, error: \`cannot place on \${role}\` };
    }

    // Economy v2: must own a built/loadout tower of this type, and have ammo to arm it.
    const tid = String(towerDef._id || '');
    const have = this.deployable.get(tid) || 0;
    if (have <= 0) return { ok: false, error: 'none in inventory — build one in the lobby' };
    if (this.ammo < this.armCost) return { ok: false, error: 'out of ammo' };

    this.deployable.set(tid, have - 1);
    this.ammo -= this.armCost;
    const tower = {`
);

// 3) After emitting tower:placed, broadcast the updated deployable/ammo state.
s = s.replace(
  `    const card = this.deck.findByTower(towerDef._id);
    if (card) this.emit("cards:hand", { hand: this.deck.replace(card.cardId) });
    this.towersBuilt++;
    return { ok: true, tower };`,
  `    const card = this.deck.findByTower(towerDef._id);
    if (card) this.emit("cards:hand", { hand: this.deck.replace(card.cardId) });
    this.towersBuilt++;
    this.emitDeployState();
    return { ok: true, tower };`
);

// 4) Add emitDeployState + emit it at start; expose for snapshots.
s = s.replace(
  `  enemyPath(enemy) { return this.paths[enemy.pathId] || this.path; }`,
  `  // Tell the client what it can still deploy + how much ammo remains.
  emitDeployState() {
    this.emit('run:deploy-state', {
      ammo: this.ammo,
      armCost: this.armCost,
      deployable: Object.fromEntries(this.deployable),
    });
  }

  enemyPath(enemy) { return this.paths[enemy.pathId] || this.path; }`
);

// 5) Emit the initial deploy state at run start (right after action:hand).
s = s.replace(
  `    this.emit("action:hand", { hand: this.actionHand });
    this.emitForecast();`,
  `    this.emit("action:hand", { hand: this.actionHand });
    this.emitDeployState();
    this.emitForecast();`
);

fs.writeFileSync(F, s);
console.log('instance.js: placeTower now uses deployable inventory + ammo arm cost (no currency gate)');
