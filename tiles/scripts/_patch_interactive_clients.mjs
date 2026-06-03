/**
 * Point the four engine-backed games at the interactive client (game3d.html)
 * instead of the read-only scaffold (scaffold3d.html). dominoes/hearts keep
 * their bespoke clients; anything still unported falls back to scaffold3d.
 */
import fs from 'fs';
const FILE = '/srv/tiles/app.js';
const src = fs.readFileSync(FILE, 'utf8');

const anchor =
`  const clients3d = {
    dominoes: 'dominoes3d.html', hearts: 'hearts3d.html',
    euchre: 'scaffold3d.html', mahjong: 'scaffold3d.html',
    craps: 'scaffold3d.html', roulette: 'scaffold3d.html',
  };
  const clients2d = { dominoes: 'dominoes.html', hearts: 'hearts.html' };
  const want2d = req.query.r === '2d';
  const pick = (want2d ? clients2d : clients3d)[req.params.game];
  const file = pick || 'scaffold3d.html';`;

const replacement =
`  const clients3d = {
    dominoes: 'dominoes3d.html', hearts: 'hearts3d.html',
    euchre: 'game3d.html', mahjong: 'game3d.html',
    craps: 'game3d.html', roulette: 'game3d.html',
  };
  const clients2d = { dominoes: 'dominoes.html', hearts: 'hearts.html' };
  const want2d = req.query.r === '2d';
  const pick = (want2d ? clients2d : clients3d)[req.params.game];
  // engine-backed games without a bespoke client use the shared interactive client;
  // anything truly unprovisioned still falls back to the read-only scaffold.
  const file = pick || 'scaffold3d.html';`;

if (src.includes("euchre: 'game3d.html'")) { console.log('already patched'); process.exit(0); }
const n = src.split(anchor).length - 1;
if (n !== 1) throw new Error(`anchor count ${n} (expected 1)`);
fs.writeFileSync(FILE, src.replace(anchor, replacement));
console.log('patched app.js -> interactive client for the four games');
