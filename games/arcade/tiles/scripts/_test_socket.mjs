/**
 * Protocol test: drive a live table over socket.io exactly as the browser client
 * (game3d.js) does — join via dev ticket, ready up, read seat:hand, submit a move
 * from priv.legal, and play to table:over against bots. Validates the
 * client/server contract for an engine-backed game without a browser.
 *
 *   node scripts/_test_socket.mjs <game>
 */
import { io } from 'socket.io-client';

const GAME = process.argv[2] || 'euchre';
const BASE = 'http://127.0.0.1:3625';

function pickAction(priv) {
  const legal = priv && priv.legal ? priv.legal : [];
  if (!legal.length) return null;
  const win = legal.find((a) => a.type === 'win');
  if (win) return win;
  return legal[Math.floor(Math.random() * legal.length)];
}

async function main() {
  const seats = [{}];
  const sc = GAME === 'roulette' ? 6 : 4;
  for (let i = 1; i < sc; i++) seats.push({ bot: true, name: `Bot ${i + 1}` });
  const res = await fetch(`${BASE}/dev/table`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game: GAME, seats }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error('dev/table failed: ' + JSON.stringify(data));
  const ticket = data.tickets[0].ticket;

  const socket = io(BASE, { transports: ['websocket', 'polling'] });
  let moves = 0, done = false, readied = false;
  const log = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout; moves=' + moves + ' log=' + log.join('|'))), 30000);

    socket.on('connect', () => socket.emit('table:join', { ticket }));
    socket.on('table:error', (e) => log.push('ERR:' + e.message));

    socket.on('table:state', (s) => {
      if (!readied && s.phase === 'lobby') { readied = true; socket.emit('seat:ready', { ready: true }); }
    });

    socket.on('seat:hand', (h) => {
      if (done) return;
      if (h.yourTurn) {
        const a = pickAction(h);
        if (a) { moves++; socket.emit('game:action', { action: a }); }
      }
    });

    socket.on('table:event', (ev) => {
      if (['gameWon', 'mahjong', 'handScored', 'settle', 'trickWon', 'spin', 'roll'].includes(ev.type)) log.push(ev.type);
    });

    socket.on('table:over', (o) => {
      done = true; clearTimeout(timeout);
      const mine = (o.standings || []).find((s) => s.seat === 0);
      console.log(`OK ${GAME}: game over · moves_by_me=${moves} · myScore=${mine ? mine.score : '?'} · won=${mine ? !!mine.won : '?'}`);
      console.log(`   standings: ${(o.standings || []).map((s) => `${s.seat}:${s.score}${s.won ? '*' : ''}`).join(' ')}`);
      console.log(`   events seen: ${log.slice(0, 12).join(' ')}${log.length > 12 ? ' …' : ''}`);
      socket.close(); resolve();
    });
  });
}

main().catch((e) => { console.error('FAIL', GAME, e.message); process.exit(1); });
