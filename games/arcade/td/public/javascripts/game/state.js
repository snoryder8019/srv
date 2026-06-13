/**
 * Client-side game state mirror (never authoritative) + shared UI constants.
 * The `state` object is a single shared reference imported across the game
 * modules; mutating it anywhere is visible everywhere.
 */
export const CAT_COLOR = { kinetic: '#9aa7ff', energy: '#66e0ff', support: '#66ff99', special: '#ff6b9d' };
export const ENEMY_ICON = { basic: '●', fast: '▲', tank: '⬛' };
export const RARITY_COLOR = { common: '#9aa7ff', rare: '#66e0ff', epic: '#ff6b9d', legendary: '#ffcc33' };

export const state = {
  runId: null,
  mapId: null,
  levelId: null,
  level: null,
  selectedTowerDef: null,
  selectedCardId: null,
  currency: Infinity,
  lastHand: [],
  selectedActionCard: null,
  lastActionHand: [],
  towersByHex: new Map(),
  tiles: null,
  pathHexes: new Set(),
  spawnHexes: new Set(),
  baseHexes: new Set(),
  blockedHexes: new Set(),
};
