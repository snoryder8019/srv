/**
 * Assert mahjong claiming actually fires: run several all-bot hands and tally the
 * claim/win events. Also sanity-check melds appear in the public view.
 */
import { TileTableRuntime } from '../lib/table.js';
import { getVariant } from '../lib/variants/index.js';

const v = getVariant('mahjong');
const tally = { claimOpen: 0, claimed: 0, pung: 0, kong: 0, chow: 0, ron: 0, tsumo: 0, wash: 0, games: 0 };

for (let g = 0; g < 8; g++) {
  const players = [0, 1, 2, 3].map((i) => ({ seat: i, bot: true, displayName: 'Bot ' + i }));
  const t = new TileTableRuntime({ tableId: 'mjc_' + g, variant: v, config: {}, players });
  t.maybeStart();
  let guard = 0;
  while (t.phase === 'playing' && guard < 5000) {
    guard++;
    const evs = t.runBots();
    if (!evs.length) break;
    for (const e of evs) {
      if (e.type === 'claimOpen') tally.claimOpen++;
      if (e.type === 'claimed') { tally.claimed++; tally[e.kind] = (tally[e.kind] || 0) + 1; }
      if (e.type === 'mahjong') tally[e.how] = (tally[e.how] || 0) + 1;
      if (e.type === 'wallExhausted') tally.wash++;
    }
  }
  if (t.phase === 'gameOver') tally.games++;
  // peek melds in last public view
  if (g === 0) {
    const pv = v.publicView(t);
    console.log('sample melds:', JSON.stringify(pv.melds));
  }
}
console.log('tally:', JSON.stringify(tally));
console.log(tally.claimed > 0 && tally.games === 8 ? 'CLAIMS OK' : 'CHECK');
