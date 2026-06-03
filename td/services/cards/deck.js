/**
 * Deck / hand system for Towers (TD).
 *
 * Instead of an always-available tower list, each run is DEALT a hand of tower
 * cards drawn from the map's available towers. Playing a card (placing its
 * tower) consumes it and draws a fresh one - a light roguelike deal loop. The
 * server owns the deck so the hand is authoritative and can't be spoofed.
 */
let cardSeq = 1;
const newCardId = () => `card_${cardSeq++}`;

/** Project a Tower document down to a lightweight, client-safe card. */
export function toCard(towerDef) {
  if (!towerDef) return null;
  return {
    cardId: newCardId(),
    towerId: String(towerDef._id),
    name: towerDef.name,
    category: towerDef.category || 'kinetic',
    gltfUrl: towerDef.gltfUrl || '',
    scale: towerDef.scale ?? 1,
    cost: towerDef.stats?.cost ?? 0,
    stats: {
      damage: towerDef.stats?.damage ?? 0,
      range: towerDef.stats?.range ?? 0,
      fireRate: towerDef.stats?.fireRate ?? 0,
    },
  };
}

export class Deck {
  constructor(towerDefs = [], handSize = 5) {
    this.pool = (towerDefs || []).filter(Boolean);
    this.handSize = handSize;
    this.hand = [];
  }

  get available() { return this.pool.length > 0; }

  /** Draw a single random card from the pool (with replacement). */
  draw() {
    if (!this.pool.length) return null;
    const def = this.pool[Math.floor(Math.random() * this.pool.length)];
    return toCard(def);
  }

  /** Deal a fresh full hand. */
  deal() {
    this.hand = [];
    for (let i = 0; i < this.handSize; i++) {
      const c = this.draw();
      if (c) this.hand.push(c);
    }
    return this.hand;
  }

  /** Find a held card matching a tower id (client plays by towerId). */
  findByTower(towerId) {
    const t = String(towerId);
    return this.hand.find(c => c && c.towerId === t) || null;
  }

  /** Replace a played card with a freshly drawn one, preserving slot order. */
  replace(cardId) {
    const i = this.hand.findIndex(c => c && c.cardId === cardId);
    if (i !== -1) this.hand[i] = this.draw();
    return this.hand;
  }
}

export default Deck;
