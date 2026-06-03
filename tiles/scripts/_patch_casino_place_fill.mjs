import fs from 'fs';
const F = '/srv/tiles/lib/tables.js';
let s = fs.readFileSync(F, 'utf8');

// placeAtCasinoTable: a continuous table fills empty seats with bots, so a seat
// with no human is either truly empty OR holds a bot. Either way a human can take
// it (displacing the bot). Prefer a truly-empty seat, then a bot seat.
s = s.replace(
  `export function placeAtCasinoTable(game, min) {
  for (const t of tables.values()) {
    if (t.game !== game || t.phase === 'gameOver') continue;
    if (t.config.betSize !== min) continue;
    const open = t.seats.find((s) => !s.platformId);
    if (open) return { tableId: t.tableId, seat: open.seat, created: false, min };
  }
  return { needCreate: true, min };
}`,
  `export function placeAtCasinoTable(game, min) {
  // a "human seat" = occupied by a real player (platformId set AND not a bot).
  const humanHeld = (st) => !!(st.platformId && !st.bot);
  for (const t of tables.values()) {
    if (t.game !== game || t.phase === 'gameOver') continue;
    if (t.config.betSize !== min) continue;
    // don't pile onto a table that's already full of humans
    const freeForHuman = t.seats.filter((st) => !humanHeld(st));
    if (!freeForHuman.length) continue;
    // prefer a truly-empty seat; otherwise displace a bot so the human joins the
    // SAME live table (this is how matchmaking adds you to an active game).
    const empty = freeForHuman.find((st) => !st.platformId);
    const target = empty || freeForHuman.find((st) => st.bot) || freeForHuman[0];
    return { tableId: t.tableId, seat: target.seat, created: false, min, displacedBot: !empty };
  }
  return { needCreate: true, min };
}`
);

fs.writeFileSync(F, s);
console.log('placeAtCasinoTable: now seats humans onto existing tables by displacing a bot');
