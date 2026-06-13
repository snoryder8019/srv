/**
 * tile.js — the tile model for @mll/tiles-engine.
 *
 * One general Tile shape covers both tile families the platform hosts:
 *   - dominoes: a "bone" with two ends, each 0..6 (double-six set). kind='bone'.
 *   - mahjong:  a suited/honor/bonus tile. kind='suit'|'honor'|'bonus'.
 *
 * A Tile is a plain object: { id, kind, ...fields, code }. `id` is unique within
 * a set (so identical faces — e.g. four copies of a mahjong tile — are distinct
 * pieces). `code` is a short stable string for transport/rendering.
 *
 * Variants build their own sets via the factories here; the engine's bag.js
 * shuffles/draws from whatever array of tiles a variant hands it.
 */

// ---- dominoes ----------------------------------------------------------------
// A bone has ends [a,b] with 0<=b<=a<=6. Code "a-b" with a>=b (canonical), e.g.
// "6-3", "0-0". A double has a===b.
export function makeBone(a, b, id) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return { id, kind: 'bone', a: hi, b: lo, double: hi === lo, pips: hi + lo, code: `${hi}-${lo}` };
}

// The standard double-six set: 28 unique bones (0-0 … 6-6).
export function buildDominoSet(max = 6) {
  const tiles = [];
  let id = 0;
  for (let a = 0; a <= max; a++) {
    for (let b = 0; b <= a; b++) {
      tiles.push(makeBone(a, b, `d${id++}`));
    }
  }
  return tiles;
}

// ---- mahjong -----------------------------------------------------------------
// Suits: 'bamboo'(b) 'circle'(c) 'character'(k), ranks 1..9, 4 copies each.
// Honors: winds E/S/W/N, dragons red/green/white, 4 copies each.
// Bonus: flowers f1..f4, seasons s1..s4, 1 copy each (no duplicates).
const MJ_SUITS = { bamboo: 'B', circle: 'C', character: 'K' };
const MJ_WINDS = ['E', 'S', 'W', 'N'];
const MJ_DRAGONS = { red: 'DR', green: 'DG', white: 'DW' };

export function buildMahjongSet({ bonus = true } = {}) {
  const tiles = [];
  let id = 0;
  const push = (t) => tiles.push({ id: `m${id++}`, ...t });
  // suits 1..9 x4
  for (const [suit, ini] of Object.entries(MJ_SUITS)) {
    for (let r = 1; r <= 9; r++) {
      for (let k = 0; k < 4; k++) push({ kind: 'suit', suit, rank: r, code: `${ini}${r}` });
    }
  }
  // winds x4
  for (const w of MJ_WINDS) for (let k = 0; k < 4; k++) push({ kind: 'honor', honor: 'wind', wind: w, code: `W${w}` });
  // dragons x4
  for (const [d, code] of Object.entries(MJ_DRAGONS)) for (let k = 0; k < 4; k++) push({ kind: 'honor', honor: 'dragon', dragon: d, code });
  // bonus (1 each)
  if (bonus) {
    for (let f = 1; f <= 4; f++) push({ kind: 'bonus', bonus: 'flower', n: f, code: `F${f}` });
    for (let s = 1; s <= 4; s++) push({ kind: 'bonus', bonus: 'season', n: s, code: `S${s}` });
  }
  return tiles; // 136 with bonus, 144 standard? -> 34*4=136 + 8 bonus = 144
}

// ---- shared helpers ----------------------------------------------------------
export function tileCode(t) { return t.code; }
export function sameTile(a, b) { return a && b && a.id === b.id; }
export function sameFace(a, b) { return a && b && a.code === b.code; }
