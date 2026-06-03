/**
 * Patch matchmaking GAME_PLATFORM so the new tiles variants route to tiles.
 * euchre is the critical one (cards still advertises a euchre; first catalog
 * match would otherwise win). idempotent.
 */
import fs from 'fs';
const FILE = '/srv/matchmaking/app.js';
const src = fs.readFileSync(FILE, 'utf8');

const anchor =
`const GAME_PLATFORM = {
  hearts: 'tiles',
  dominoes: 'tiles',
  // euchre: stays on cards until ported
};`;

const replacement =
`const GAME_PLATFORM = {
  hearts: 'tiles',
  dominoes: 'tiles',
  euchre: 'tiles',     // ported to tiles (overrides the legacy cards euchre)
  mahjong: 'tiles',
  craps: 'tiles',
  roulette: 'tiles',
};`;

if (src.includes("euchre: 'tiles'")) { console.log('already patched'); process.exit(0); }
const n = src.split(anchor).length - 1;
if (n !== 1) throw new Error(`anchor count ${n} (expected 1)`);
fs.writeFileSync(FILE, src.replace(anchor, replacement));
console.log('patched matchmaking GAME_PLATFORM');
