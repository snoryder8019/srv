import { io } from 'socket.io-client';
import assert from 'node:assert';

const BASE = 'http://localhost:3600';

const res = await fetch(`${BASE}/dev/table`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ game: 'trial', config: { target: 4 }, seats: [{ name: 'Me' }, { bot: true }, { bot: true }, { bot: true }] }),
});
const table = await res.json();
assert.ok(table.ok && table.tickets.length === 1, 'dev table created with 1 human ticket');
const ticket = table.tickets[0].ticket;
console.log('table', table.tableId, '— joining seat', table.tickets[0].seat);

const socket = io(BASE, { transports: ['websocket', 'polling'], withCredentials: true });
let mySeat = null, state = null, plays = 0, readied = false, lastDecision = null;
const events = [];

// Authoritative decision id: a play decision is uniquely identified by the hand,
// how many tricks have completed, and how many cards are already in the trick.
// This makes the client idempotent to duplicated/reordered state broadcasts.
function decisionId(s) {
  const tricks = (s.view?.trickWins || []).reduce((a, b) => a + b, 0);
  return `${s.handNo}:${tricks}:${s.view?.trick?.length ?? 0}`;
}

const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout — game did not finish')), 10000);
  socket.on('connect', () => socket.emit('table:join', { ticket }));
  socket.on('table:error', (e) => { clearTimeout(timer); reject(new Error('server error: ' + e.message)); });
  socket.on('table:state', (s) => {
    state = s;
    if (s.phase === 'lobby' && !readied) { readied = true; socket.emit('seat:ready', { ready: true }); }
  });
  socket.on('seat:hand', (h) => {
    mySeat = h.seat;
    const legal = h.legal || [];
    if (!state || state.phase !== 'playing') return;
    if (state.view?.turn !== mySeat || !legal.length) return;
    const id = decisionId(state);
    if (id === lastDecision) return;       // duplicate broadcast for the same decision
    lastDecision = id;
    plays += 1;
    socket.emit('game:action', { action: { type: 'play', card: legal[0] } });
  });
  socket.on('table:event', (ev) => {
    events.push(ev);
    if (ev.type === 'gameOver') { clearTimeout(timer); resolve(ev); }
  });
});

const over = await done;
socket.close();

assert.strictEqual(mySeat, 0, 'seated at 0');
assert.ok(plays >= 5, `human made plays over the wire: ${plays}`);
assert.ok(over.scores.some((s) => s >= 4), `game reached target: ${over.scores}`);
console.log('PASS — live socket table (trial)');
console.log(`  human plays over socket: ${plays}`);
console.log(`  trickWon: ${events.filter((e) => e.type === 'trickWon').length}, handWon: ${events.filter((e) => e.type === 'handWon').length}`);
console.log(`  final scores: ${over.scores}`);
process.exit(0);
