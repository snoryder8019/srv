/**
 * bag.js — wall / boneyard mechanics for @mll/tiles-engine.
 *
 * The tile analogue of cards' deck.js. A "bag" is a shuffled array of tiles a
 * variant draws from: dominoes call it the *boneyard*, mahjong calls it the
 * *wall*. All draws are deterministic given the rng (seedable), so games replay.
 *
 *   const bag = shuffle(buildDominoSet(), rng);
 *   const { hands, rest } = deal(bag, { players: 4, tilesPer: 7 });
 *   const { drawn, rest: r2 } = draw(rest, 1);
 */

// Fisher–Yates with an injected rng (0..1). Returns a new array.
export function shuffle(tiles, rng) {
  const a = tiles.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Draw `n` tiles off the FRONT of the bag. Returns { drawn, rest }.
export function draw(bag, n = 1) {
  const drawn = bag.slice(0, n);
  const rest = bag.slice(n);
  return { drawn, rest };
}

// Draw one tile off the END of the bag (some games draw the "last tile").
export function drawBack(bag, n = 1) {
  const rest = bag.slice(0, bag.length - n);
  const drawn = bag.slice(bag.length - n);
  return { drawn, rest };
}

// Deal `players` hands of `tilesPer` tiles each (round-robin one at a time, the
// way tiles are actually dealt). Returns { hands, rest }.
export function deal(bag, { players = 4, tilesPer = 7 } = {}) {
  const hands = Array.from({ length: players }, () => []);
  let idx = 0;
  for (let t = 0; t < tilesPer; t++) {
    for (let p = 0; p < players; p++) {
      hands[p].push(bag[idx++]);
    }
  }
  return { hands, rest: bag.slice(idx) };
}

export function remaining(bag) { return bag.length; }
