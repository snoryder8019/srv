/**
 * @mll/cards-engine — public API.
 *
 * Versioned, game-agnostic table mechanics for the MadLadsLab cards platform.
 * A variant (e.g. /srv/euchre) imports this and supplies the rules that the
 * engine leaves open: which ranks to deal, what counts as a legal play, the
 * trick comparator (trump/bowers), and scoring.
 *
 *   import * as cards from '@mll/cards-engine';
 *
 * The contract a variant implements (the "Variant" shape) is documented in
 * /srv/cards/CARDGAMES_PROTOCOL.md §Engine API. The engine never imports a
 * variant — dependencies point one way (variant -> engine) so an engine bump
 * upgrades every game without touching variant code, per the protocol.
 */

export const ENGINE_VERSION = '0.1.0';
export const PROTOCOL = 'cardgames/v1';

export {
  SUITS,
  RANKS,
  SUIT_COLOR,
  color,
  sameColorSuit,
  rankValue,
  makeCard,
  cardCode,
  sameCard,
} from './card.js';

export { makeRng, hashSeed, rngFromSeed } from './rng.js';
export { buildDeck, shuffle, deal } from './deck.js';
export { Trick, naturalComparator } from './trick.js';
export { Table } from './table.js';
