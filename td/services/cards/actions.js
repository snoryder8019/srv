/**
 * Action-card service: progression math + hand building + rewards.
 *
 * Layering recap:
 *   - Equipment (towers) -> placed on the board (services/cards/deck.js).
 *   - Action cards       -> dealt into a hand, played ONTO a placed tower.
 *
 * Loadout rule: hand = (collection picks chosen by player) + (generics dealt to
 * fill the remaining slots). Slots and picks grow with level; the generic pool
 * unlocks more cards with level.
 */
import ActionCard from '../../api/v1/models/ActionCard.js';

/* ----------------------------- progression ----------------------------- */

export function xpForNext(level) { return level * 120; }           // xp to go from `level` -> level+1

export function levelFromXp(xp) {
  let lvl = 1, acc = 0;
  while (xp >= acc + xpForNext(lvl)) { acc += xpForNext(lvl); lvl++; }
  return lvl;
}

export function handSlots(level) { return 5 + Math.floor((level - 1) / 3); }      // +1 slot / 3 levels
export function collectionPicks(level) { return 1 + Math.floor((level - 1) / 5); } // +1 pick / 5 levels

/* ----------------------------- hand building ----------------------------- */

let seq = 1;
export function toHandCard(def) {
  return {
    instanceId: `act_${seq++}`,
    slug: def.slug,
    name: def.name,
    icon: def.icon,
    rarity: def.rarity,
    source: def.source,
    description: def.description,
    effect: def.effect,
  };
}

export async function genericPool(level) {
  return ActionCard.find({ source: 'generic', minLevel: { $lte: level } }).lean();
}

export async function drawGeneric(level) {
  const pool = await genericPool(level);
  if (!pool.length) return null;
  return toHandCard(pool[Math.floor(Math.random() * pool.length)]);
}

/**
 * Build the starting action hand for a run.
 * @param {object} p { level, collectionSlugs:[], ownedSlugs:[] }
 */
export async function buildActionHand({ level = 1, collectionSlugs = [], ownedSlugs = [] }) {
  const slots = handSlots(level);
  const picks = collectionPicks(level);

  const chosen = [...new Set(collectionSlugs)].filter(s => ownedSlugs.includes(s)).slice(0, picks);
  const chosenDefs = chosen.length ? await ActionCard.find({ slug: { $in: chosen } }).lean() : [];

  const hand = chosenDefs.map(toHandCard);
  const generics = await genericPool(level);
  while (hand.length < slots && generics.length) {
    hand.push(toHandCard(generics[Math.floor(Math.random() * generics.length)]));
  }
  return { hand, slots, picks };
}

/* ----------------------------- rewards ----------------------------- */

const RARITY_WEIGHT = { common: 0, rare: 6, epic: 3, legendary: 1 };

/** Pick a reward card (collection-worthy) to grant after a good run. */
export async function rollRewardCard() {
  const pool = await ActionCard.find({ source: 'collection' }).lean();
  if (!pool.length) return null;
  const weighted = [];
  for (const c of pool) {
    const w = RARITY_WEIGHT[c.rarity] ?? 1;
    for (let i = 0; i < w; i++) weighted.push(c);
  }
  const list = weighted.length ? weighted : pool;
  return list[Math.floor(Math.random() * list.length)];
}

/** XP earned from a finished run. */
export function xpForRun({ status, score = 0, waveReached = 0 }) {
  let xp = Math.floor(score / 5) + waveReached * 10;
  if (status === 'won') xp += 100;
  return Math.max(10, xp);
}

/** Starter collection granted to brand-new players (so a pre-game pick exists). */
export const STARTER_COLLECTION = ['surge', 'precision-array'];

export default {
  xpForNext, levelFromXp, handSlots, collectionPicks,
  buildActionHand, drawGeneric, genericPool, rollRewardCard, xpForRun, STARTER_COLLECTION,
};
