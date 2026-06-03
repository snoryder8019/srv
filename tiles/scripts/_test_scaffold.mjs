/**
 * Smoke test: load each provisioned scaffold through the REAL runtime and play a
 * full all-bot game, asserting it reaches gameOver with a winner. No server/socket.
 */
import { TileTableRuntime } from '../lib/table.js';
import { getVariant, listVariants } from '../lib/variants/index.js';

console.log('registry:', listVariants().map((v) => `${v.id}[${v.status}${v.scaffold ? ',scaffold' : ''}]`).join(', '));

let allOk = true;
for (const id of ['euchre', 'mahjong', 'craps', 'roulette']) {
  const v = getVariant(id);
  if (!v) { console.log('MISSING', id); allOk = false; continue; }
  const seatCount = (v.meta && v.meta.seating && v.meta.seating.seats) || 4;
  const players = [];
  for (let i = 0; i < seatCount; i++) players.push({ seat: i, bot: true, displayName: `Bot ${i + 1}` });

  const t = new TileTableRuntime({ tableId: `test_${id}`, variant: v, config: {}, players });
  t.maybeStart();

  let events = 0, guard = 0;
  while (t.phase === 'playing' && guard < 2000) {
    guard++;
    const e = t.runBots();
    events += e.length;
    if (!e.length) break;
  }
  const ok = t.phase === 'gameOver' && t.winnerSeat != null;
  if (!ok) allOk = false;
  console.log(
    `${ok ? 'OK ' : 'FAIL'} ${id}: seats=${seatCount} phase=${t.phase} ` +
    `scores=${JSON.stringify(t.scores)} winnerSeat=${t.winnerSeat} events=${events}`
  );
}
console.log(allOk ? 'ALL OK' : 'FAILURES PRESENT');
