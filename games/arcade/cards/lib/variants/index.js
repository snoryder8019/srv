/**
 * Variant registry. /srv/cards is the scaffolding; each card variant lives in
 * its own folder inside cards (e.g. ../../euchre) with its logic + config, and
 * registers here. The runtime looks variants up by id; matchmaking reads their
 * meta to seat players.
 */
import trial from './trial.js';
import euchre from '../../euchre/index.js';
import hearts from '../../hearts/index.js';

const registry = new Map();

export function registerVariant(v) {
  if (!v || !v.id) throw new Error('variant must have an id');
  registry.set(v.id, v);
  return v;
}

export function getVariant(id) {
  return registry.get(id) || null;
}

export function listVariants() {
  return [...registry.values()].map((v) => ({ id: v.id, name: v.name }));
}

registerVariant(trial);
registerVariant(euchre);
registerVariant(hearts);
