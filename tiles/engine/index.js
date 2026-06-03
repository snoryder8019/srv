/**
 * @mll/tiles-engine — public API.
 *
 * Versioned, game-agnostic TILE mechanics for the MadLadsLab tiles platform.
 * A variant (e.g. /srv/tiles/dominoes) imports this and supplies the rules the
 * engine leaves open: which tile set to build, what counts as a legal placement,
 * draw/pass logic, and scoring. Dependencies point one way (variant -> engine).
 *
 *   import * as tiles from '@mll/tiles-engine';
 *
 * The platform-generic seating / phases / end-game / sync live in /srv/tiles/lib,
 * exactly mirroring the cards platform; only this engine differs from cards.
 */

export const ENGINE_VERSION = '0.1.0';
export const PROTOCOL = 'tilegames/v1';

export {
  makeBone, buildDominoSet,
  buildMahjongSet,
  tileCode, sameTile, sameFace,
} from './tile.js';

export { makeRng, hashSeed, rngFromSeed } from './rng.js';
export { shuffle, draw, drawBack, deal, remaining } from './bag.js';
