/**
 * Scaffold variant factory.
 *
 * /srv/tiles is the platform scaffolding; hearts and dominoes are the two
 * REFERENCE variants that show the full contract (../../hearts, ../../dominoes).
 * New games are provisioned against that same contract. Until a game's real
 * rules are written, it ships as a *contract-complete scaffold*: it seats
 * players, runs turn-based hands to completion, scores, and ends a game — so the
 * runtime, socket transport, bots, reconnect, votes and end-game flow all work
 * end-to-end on day one. Swap the real logic in later (deal/legalActions/
 * applyAction/views/botAction), exactly as hearts does.
 *
 * makeScaffoldVariant({ id, name, meta, catalog, actionLabel, handsToWin })
 *   -> an object implementing the variant contract consumed by ../table.js.
 *
 * The skeleton hand: each seat takes one generic turn (`{ type:'act' }` — a
 * stand-in for play/roll/bet/draw); when every seat has acted the hand ends,
 * the dealer is awarded a point, and the first to `handsToWin` wins the game.
 */
export function makeScaffoldVariant({ id, name, meta, catalog, actionLabel = 'act', handsToWin = 3 }) {
  if (!id || !name) throw new Error('scaffold variant needs id + name');

  return {
    id,
    name,
    meta,
    catalog,
    scaffold: true,                 // flag so clients/diagnostics can label it
    defaults: { handsToWin, actionLabel },

    startHand(table /*, rng */) {
      table.hand = {
        phase: 'playing',
        turn: table.dealer ?? 0,
        acted: new Array(table.seatCount).fill(false),
        actions: 0,
      };
      return table.hand;
    },

    currentTurn(table) {
      const h = table.hand;
      if (!h || h.phase !== 'playing') return null;
      return h.turn;
    },

    botSeatsToAct(table) {
      const seat = this.currentTurn(table);
      return seat == null ? [] : [seat];
    },

    legalActions(table, seat) {
      const h = table.hand;
      if (!h || h.phase !== 'playing' || h.turn !== seat) return [];
      return [{ type: 'act', label: table.config.actionLabel || actionLabel }];
    },

    applyAction(table, seat, action) {
      const h = table.hand;
      if (!h || h.phase !== 'playing') return { ok: false, error: 'no hand in progress' };
      if (seat !== h.turn) return { ok: false, error: 'not your turn' };
      if (!action || action.type !== 'act') return { ok: false, error: 'expected an act action' };

      h.acted[seat] = true;
      h.actions += 1;
      const events = [{ type: 'acted', seat }];

      if (h.acted.every(Boolean)) {
        // hand complete — award the dealer a point (dealer rotates each hand)
        const winner = table.dealer ?? 0;
        table.scores[winner] += 1;
        events.push({ type: 'handScored', seat: winner, scores: table.scores.slice() });
        const target = table.config.handsToWin || handsToWin;
        if (table.scores[winner] >= target) {
          events.push({ type: 'gameWon', winnerSeat: winner, totals: table.scores.slice() });
          return { ok: true, events, handOver: false, gameOver: true };
        }
        return { ok: true, events, handOver: true, gameOver: false };
      }

      h.turn = table.next(seat);
      return { ok: true, events, handOver: false, gameOver: false };
    },

    publicView(table) {
      const h = table.hand;
      if (!h) return { phase: 'lobby' };
      return {
        phase: h.phase,
        scaffold: true,
        game: id,
        note: `${name} — scaffold (rules pending)`,
        turn: this.currentTurn(table),
        dealer: table.dealer,
        scores: table.scores.slice(),
        handsToWin: table.config.handsToWin || handsToWin,
      };
    },

    privateView(table, seat) {
      const h = table.hand;
      if (!h) return { seat, hand: [], legal: [] };
      return {
        seat,
        scaffold: true,
        phase: h.phase,
        turn: h.turn,
        yourTurn: h.turn === seat,
        legal: this.legalActions(table, seat),
        hand: [],
      };
    },

    botAction(table, seat) {
      const legal = this.legalActions(table, seat);
      return legal.length ? { type: 'act' } : null;
    },
  };
}

export default makeScaffoldVariant;
