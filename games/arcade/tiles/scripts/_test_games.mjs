/**
 * Full-game smoke test for the real variant implementations. Plays an all-bot
 * game per variant through the REAL runtime and reports outcome; catches errors.
 */
import { TileTableRuntime } from '../lib/table.js';
import { getVariant } from '../lib/variants/index.js';

function playGame(id) {
  const v = getVariant(id);
  if (!v) return `MISSING ${id}`;
  const seatCount = (v.meta && v.meta.seating && v.meta.seating.seats) || 4;
  const players = [];
  for (let i = 0; i < seatCount; i++) players.push({ seat: i, bot: true, displayName: `Bot ${i + 1}` });
  const t = new TileTableRuntime({ tableId: `t_${id}`, variant: v, config: {}, players });
  t.maybeStart();
  let events = 0, guard = 0;
  while (t.phase === 'playing' && guard < 20000) {
    guard++;
    const e = t.runBots();
    events += e.length;
    if (!e.length) break;
  }
  const ok = t.phase === 'gameOver' && t.winnerSeat != null;
  const stand = (typeof v.standings === 'function') ? v.standings(t).map((s) => `${s.seat}:${s.score}${s.won ? '*' : ''}`).join(' ') : t.scores.join(',');
  return `${ok ? 'OK ' : 'FAIL'} ${id}: seats=${seatCount} phase=${t.phase} winner=${t.winnerSeat} guard=${guard} events=${events} | ${stand}`;
}

for (const id of ['euchre', 'mahjong', 'craps', 'roulette']) {
  try { console.log(playGame(id)); }
  catch (e) { console.log(`THREW ${id}: ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`); }
}
