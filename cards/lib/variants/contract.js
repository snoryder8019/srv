/**
 * Variant contract — what a card game implements to run on the cards platform.
 * The TableRuntime (lib/table.js) is game-agnostic and delegates all card logic
 * here. Euchre (in /srv/euchre) will implement this same shape and register.
 *
 * All card values cross the wire as compact codes ("9H","10S","JD","AC"); the
 * variant works in engine Card objects internally and converts at the edges.
 *
 * Interface:
 *   id            : string
 *   name          : string
 *   defaults      : object         // config defaults; table params override
 *   startHand(table, rng)          // set up table.hand (variant-owned state)
 *   currentTurn(table) -> seat|null
 *   legalActions(table, seat) -> [{ type, ... }]
 *   applyAction(table, seat, action) -> { ok, error?, events?, handOver?, gameOver? }
 *   publicView(table) -> object    // safe to broadcast to everyone (no hidden cards)
 *   privateView(table, seat) -> object   // that seat's hand + legal plays only
 *   botAction(table, seat) -> action|null
 *
 * The runtime owns: seats, connections, phase, dealer rotation, team scores, and
 * advancing to the next hand. The variant owns everything inside a hand.
 */
export const VARIANT_CONTRACT = 'cardgames/v1';
