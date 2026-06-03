import fs from 'fs';
const F = '/srv/td/services/socket-handlers.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('inventory: player.inventory')) { console.log('already'); process.exit(0); }

// 1) import wallet + economy prices
s = s.replace(
  `import { reportScore } from './platform/report.js';`,
  `import { reportScore } from './platform/report.js';\nimport walletClient from './platform/wallet.js';\nimport { PRICES } from '../api/v1/routes/economy.js';`
);

// 2) pass inventory + armCost into the GameInstance
s = s.replace(
  `          game = new GameInstance({
            run, map, io, towers, enemyTypes, story,
            actionHand: hand, actionSlots: slots, level,
            drawCard: () => drawGeneric(level),
            onEnd: makeOnEnd(player._id, io),
          });`,
  `          game = new GameInstance({
            run, map, io, towers, enemyTypes, story,
            actionHand: hand, actionSlots: slots, level,
            drawCard: () => drawGeneric(level),
            inventory: player.inventory || {},
            armCost: PRICES.armCost,
            onEnd: makeOnEnd(player._id, io),
          });`
);

// 3) onEnd: accept loot + deployable-spent, persist to inventory, credit tokens.
//    The engine passes loot + the consumed pools so we can reconcile.
s = s.replace(
  `function makeOnEnd(userId, io) {
  return async ({ run, status, score = 0, waveReached = 0, towersBuilt = 0 }) => {`,
  `function makeOnEnd(userId, io) {
  return async ({ run, status, score = 0, waveReached = 0, towersBuilt = 0, loot = null, ammoLeft = null, deployableLeft = null }) => {`
);

// 4) after the stats $inc block's user update, persist economy: add looted
//    ammo+components to inventory, reconcile deployable spent, credit tokens.
s = s.replace(
  `      // Recompute level; emit level-up if it changed.
      const fresh = await User.findById(userId);`,
  `      // ---- Economy reconcile: looted ammo+components persist; tokens -> chips;
      //      remaining deployable inventory is written back (spent towers consumed). ----
      const econ = await User.findById(userId);
      if (econ) {
        econ.inventory = econ.inventory || { components: 0, ammo: 0, builtTowers: [] };
        if (loot) {
          econ.inventory.ammo = (econ.inventory.ammo || 0) + (loot.ammo || 0);
          econ.inventory.components = (econ.inventory.components || 0) + (loot.components || 0);
        }
        // write back the deployable pool the run ended with (built towers consumed
        // on placement are reflected here; base-loadout entries are not persisted).
        if (deployableLeft && typeof deployableLeft === 'object') {
          const builtIds = new Set((econ.inventory.builtTowers || []).map(t => String(t.towerId)));
          econ.inventory.builtTowers = (econ.inventory.builtTowers || []).map(t => ({
            towerId: String(t.towerId),
            count: Math.max(0, deployableLeft[String(t.towerId)] ?? t.count ?? 0),
          })).filter(t => t.count > 0);
        }
        // ammoLeft is the in-run remaining arm-stock; we already added loot ammo
        // above to the persisted pool, so DON'T double count — only loot persists.
        await econ.save();
        // tokens looted convert to global chips (the only money)
        if (loot && loot.tokens > 0) {
          walletClient.credit(econ.platformId, loot.tokens, 'towers-loot-tokens',
            { runId: String(run._id) }, econ.displayName).catch(() => {});
        }
      }

      // Recompute level; emit level-up if it changed.
      const fresh = await User.findById(userId);`
);

fs.writeFileSync(F, s);
console.log('socket-handlers.js: inventory passed in + loot/tokens persisted on run end');
