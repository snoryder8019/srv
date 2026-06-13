/**
 * Variant registry. /srv/tiles is the scaffolding; each tile/card/casino variant
 * lives in its own folder inside tiles (e.g. ../../dominoes) with its logic +
 * config, and registers here. The runtime looks variants up by id; matchmaking
 * reads their meta to seat players. Mirrors the cards variant registry.
 *
 * hearts + dominoes are the REFERENCE variants (full rules). euchre, mahjong,
 * craps and roulette are provisioned as contract-complete scaffolds (see
 * ./scaffold.js) and get fleshed out onto the engine next, in that order.
 */
import dominoes from '../../dominoes/index.js';
import hearts from '../../hearts/index.js';
import euchre from '../../euchre/index.js';
import mahjong from '../../mahjong/index.js';
import craps from '../../craps/index.js';
import roulette from '../../roulette/index.js';
import blackjack from '../../blackjack/index.js';
import baccarat from '../../baccarat/index.js';

const registry = new Map();

export function registerVariant(v) {
  if (!v || !v.id) throw new Error('variant must have an id');
  registry.set(v.id, v);
  return v;
}

export function getVariant(id) { return registry.get(id) || null; }
export function listVariants() {
  return [...registry.values()].map((v) => ({
    id: v.id, name: v.name,
    status: (v.catalog && v.catalog.status) || 'live',
    scaffold: !!v.scaffold,
  }));
}

// Reference variants (full rules).
registerVariant(dominoes);
registerVariant(hearts);
// Provisioned scaffolds (rules pending — euchre, mahjong, craps, then roulette).
registerVariant(euchre);
registerVariant(mahjong);
registerVariant(craps);
registerVariant(roulette);
registerVariant(blackjack);
registerVariant(baccarat);
