/**
 * rng.js — deterministic, seedable PRNG.
 *
 * Card games must be reproducible: a recorded seed replays the exact same
 * shuffle, which makes hands auditable and bug reports reproducible. Never use
 * Math.random() inside the engine — always thread an rng created here.
 */

// mulberry32 — small, fast, good-enough distribution for shuffling.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash an arbitrary string (e.g. a table/hand id) into a 32-bit seed.
export function hashSeed(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

// Convenience: an rng from a string seed, or a random one if none given.
export function rngFromSeed(seed) {
  if (seed === undefined || seed === null) {
    seed = (Math.random() * 0xffffffff) >>> 0;
  }
  if (typeof seed === 'string') seed = hashSeed(seed);
  return makeRng(seed);
}
