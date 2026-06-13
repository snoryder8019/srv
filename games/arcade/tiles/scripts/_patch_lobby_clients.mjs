/**
 * One-shot patch: route the provisioned scaffold games to a shared generic 3D
 * client and fix the lobby fallback. dominoes/hearts keep their bespoke clients.
 */
import fs from 'fs';
const FILE = '/srv/games/arcade/tiles/app.js';
const src = fs.readFileSync(FILE, 'utf8');

const anchor =
`  const clients3d = { dominoes: 'dominoes3d.html', hearts: 'hearts3d.html', euchre: 'euchre.html' };
  const clients2d = { dominoes: 'dominoes.html', hearts: 'hearts.html', euchre: 'euchre.html' };
  const want2d = req.query.r === '2d';
  const pick = (want2d ? clients2d : clients3d)[req.params.game];
  const file = pick || (want2d ? 'table.html' : 'dominoes3d.html');`;

const replacement =
`  const clients3d = {
    dominoes: 'dominoes3d.html', hearts: 'hearts3d.html',
    euchre: 'scaffold3d.html', mahjong: 'scaffold3d.html',
    craps: 'scaffold3d.html', roulette: 'scaffold3d.html',
  };
  const clients2d = { dominoes: 'dominoes.html', hearts: 'hearts.html' };
  const want2d = req.query.r === '2d';
  const pick = (want2d ? clients2d : clients3d)[req.params.game];
  const file = pick || 'scaffold3d.html';`;

if (src.includes("euchre: 'scaffold3d.html'")) { console.log('already patched'); process.exit(0); }
const n = src.split(anchor).length - 1;
if (n !== 1) throw new Error(`anchor count ${n} (expected 1)`);
fs.writeFileSync(FILE, src.replace(anchor, replacement));
console.log('patched app.js lobby client map');
