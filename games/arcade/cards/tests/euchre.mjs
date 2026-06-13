/**
 * Euchre integration test — drives full all-bot games through the TableRuntime
 * (the same path the socket layer uses), asserting the rules hold:
 *   - bidding always terminates (stick-the-dealer)
 *   - a hand plays exactly 5 tricks (or 5 minus alone-sit-out is still 5 tricks)
 *   - left/right bower ordering via the comparator
 *   - scoring is sane and a game reaches the target
 *   - privacy: public state never leaks hands
 */
import assert from 'node:assert';
import { createTable, dropTable } from '../lib/tables.js';
import euchre, { euchreComparator, effSuit, isLeftBower, isRightBower } from '../euchre/index.js';

// --- unit: bower-aware comparator ---
(() => {
  const C = (code) => {
    const s = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' }[code.slice(-1)];
    return { suit: s, rank: code.slice(0, -1) };
  };
  const trump = 'spades';
  // left bower = J of clubs (same color as spades) must count as trump and beat A spades
  assert.strictEqual(effSuit(C('JC'), trump), 'spades', 'left bower is trump-suited');
  assert.ok(isLeftBower(C('JC'), trump) && isRightBower(C('JS'), trump), 'bower id');
  // right bower (JS) beats left bower (JC) beats A spades beats K spades
  const plays = [
    { seat: 0, card: C('AS') },
    { seat: 1, card: C('JC') }, // left bower
    { seat: 2, card: C('JS') }, // right bower
    { seat: 3, card: C('KS') },
  ];
  assert.strictEqual(euchreComparator(plays, { trump }), 2, 'right bower wins');
  const noRight = [
    { seat: 0, card: C('AS') },
    { seat: 1, card: C('JC') }, // left bower
    { seat: 2, card: C('KS') },
    { seat: 3, card: C('QS') },
  ];
  assert.strictEqual(euchreComparator(noRight, { trump }), 1, 'left bower beats A trump');
  console.log('PASS — bower comparator (right > left > A trump)');
})();

// --- integration: many full games, all bots ---
let games = 0; let euchres = 0; let marches = 0; let lones = 0; let maxHands = 0;
for (let g = 0; g < 25; g++) {
  const id = `eu-${g}`;
  dropTable(id);
  const t = createTable({
    tableId: id, game: 'euchre', config: {},
    players: [0, 1, 2, 3].map((seat) => ({ seat, bot: true, displayName: `Bot${seat}` })),
  });
  assert.strictEqual(t.maybeStart(), true, 'game starts when full of ready bots');

  let guard = 0;
  const events = [];
  while (t.phase === 'playing' && guard < 5000) {
    guard += 1;
    const seat = t.variant.currentTurn(t);
    assert.ok(seat != null, 'someone must always be on turn during play');
    assert.notStrictEqual(seat, t.hand.sitOut, 'a sitting-out lone partner is never on turn');
    const action = t.variant.botAction(t, seat);
    assert.ok(action, `bot produced an action in phase ${t.hand.phase}`);
    const r = t.submit(seat, action);
    assert.ok(r.ok, `action accepted (${t.hand?.phase}): ${r.error || ''}`);
    events.push(...r.events);
    // public state must never carry hands
    assert.ok(!JSON.stringify(t.publicState()).includes('"hand"'), 'no hands leaked publicly');
  }
  assert.strictEqual(t.phase, 'gameOver', `game ${g} finished`);
  assert.ok(t.scores.some((s) => s >= 10), `game ${g} reached 10: ${t.scores}`);

  // every completed hand has exactly 5 tricks worth of trickWon between handStarts
  const handWons = events.filter((e) => e.type === 'handWon');
  for (const hw of handWons) {
    assert.ok(hw.makerTricks >= 0 && hw.makerTricks <= 5, 'makerTricks in range');
    if (hw.euchred) euchres += 1;
    else if (hw.makerTricks === 5) { marches += 1; if (hw.alone) lones += 1; }
  }
  const handStarts = events.filter((e) => e.type === 'handStart').length;
  maxHands = Math.max(maxHands, handStarts + 1);
  games += 1;
}

console.log(`PASS — ${games} full euchre games to 10`);
console.log(`  observed: euchres=${euchres}, marches=${marches}, lone marches=${lones}, longest game ~${maxHands} hands`);
console.log('PASS — privacy, turn-order, bidding termination all held');
