import assert from 'node:assert';
import { createTable } from '../lib/tables.js';

// 4 bots, low target for a quick full game.
const t = createTable({
  tableId: 'test-1',
  game: 'trial',
  config: { target: 4 },
  players: [0, 1, 2, 3].map((seat) => ({ seat, bot: true, displayName: `Bot${seat}` })),
});

assert.strictEqual(t.allSeated(), true, 'all seated');
assert.strictEqual(t.allReady(), true, 'bots auto-ready');

// determinism: same table id reproduces the same opening deal
const started = t.maybeStart();
assert.strictEqual(started, true, 'maybeStart launched');
assert.strictEqual(t.phase, 'playing', 'phase playing');
const seat0Open = t.privateState(0).hand.slice();
assert.strictEqual(seat0Open.length, 5, 'seat 0 has 5 cards');

// privacy: public state must not leak hands
const pub = t.publicState();
assert.ok(!JSON.stringify(pub).includes('"hand"'), 'public state has no hands');

// illegal action is rejected
const bad = t.submit(t.variant.currentTurn(t), { type: 'play', card: 'ZZ' });
assert.strictEqual(bad.ok, false, 'illegal play rejected');

// drive all bot turns to completion
const events = t.runBots();
assert.strictEqual(t.phase, 'gameOver', 'game completed');
assert.ok(t.scores.some((s) => s >= 4), `a team reached target: ${t.scores}`);

const handStarts = events.filter((e) => e.type === 'handStart').length;
const handWins = events.filter((e) => e.type === 'handWon').length;
const trickWins = events.filter((e) => e.type === 'trickWon').length;
assert.strictEqual(trickWins % 5, 0, 'tricks come in fives (5 per hand)');

// determinism check: a fresh table with the same id deals seat 0 identically
import { dropTable } from '../lib/tables.js';
dropTable('test-1');
const t2 = createTable({ tableId: 'test-1', game: 'trial', config: { target: 4 },
  players: [0, 1, 2, 3].map((seat) => ({ seat, bot: true })) });
t2.maybeStart();
assert.deepStrictEqual(t2.privateState(0).hand, seat0Open, 'deterministic deal by tableId');

console.log('PASS — table runtime + trial variant');
console.log(`  hands played: ${handWins}, handStarts: ${handStarts}, tricks: ${trickWins}`);
console.log(`  final scores (team0,team1): ${t.scores}`);
console.log(`  seat0 opening hand: ${seat0Open.join(' ')}`);
