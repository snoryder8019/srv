/**
 * Provision the scaffold variant folders (euchre, mahjong, craps, roulette).
 * Writes meta.json + config.js + index.js for each, all built on the shared
 * makeScaffoldVariant factory. Idempotent: overwrites these generated files.
 */
import fs from 'fs';
import path from 'path';

const ROOT = '/srv/tiles';

const games = [
  {
    id: 'euchre', name: 'Euchre', actionLabel: 'play', seats: 4, players: 4,
    partnerships: [[0, 2], [1, 3]],
    blurb: 'Trick-taking with the right and left bower on a 24-card deck — call trump and march for points.',
    config: { deck: { ranks: ['9', '10', 'J', 'Q', 'K', 'A'] }, deal: { players: 4, cardsPer: 5 }, rules: { trump: true, bowers: true }, scoring: { winScore: 10 } },
  },
  {
    id: 'mahjong', name: 'Mahjong', actionLabel: 'draw', seats: 4, players: 4,
    partnerships: null,
    blurb: 'Draw and discard to build sets and pairs — race to a complete hand.',
    config: { tiles: { set: 'mahjong' }, deal: { players: 4, wallPer: 13 }, rules: { flowers: true } },
  },
  {
    id: 'craps', name: 'Craps', actionLabel: 'roll', seats: 4, players: 4,
    partnerships: null,
    blurb: "Casino dice — bet the pass line and ride the shooter's roll.",
    config: { dice: 2, rules: { passLine: true }, scoring: {} },
  },
  {
    id: 'roulette', name: 'Roulette', actionLabel: 'bet', seats: 6, players: 6,
    partnerships: null,
    blurb: 'Place your bets, spin the wheel, and watch the ball drop.',
    config: { wheel: 'european', pockets: 37, rules: { layout: 'european' } },
  },
];

for (const g of games) {
  const dir = path.join(ROOT, g.id);
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    id: g.id, name: g.name, blurb: g.blurb,
    players: g.players, partnerships: g.partnerships, fillWithBots: true,
    image: `/static/img/${g.id}.svg`, lobbyPath: `/lobby/${g.id}`,
    status: 'beta', scaffold: true,
    seating: { seats: g.seats },
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const cfgObj = { id: g.id, ...g.config, seating: { seats: g.seats, partnerships: g.partnerships, fillWithBots: true } };
  const configJs =
`/**
 * ${g.name} configuration — knobs kept separate from logic. SCAFFOLD: these are
 * placeholder rule fields for the provisioned skeleton; fill in real rules when
 * porting ${g.name} onto the engine (model on /srv/tiles/hearts + /srv/tiles/dominoes).
 */
export default ${JSON.stringify(cfgObj, null, 2)};
`;
  fs.writeFileSync(path.join(dir, 'config.js'), configJs);

  const indexJs =
`/**
 * ${g.name} — provisioned variant.
 *
 * SCAFFOLD: ships as a contract-complete skeleton via makeScaffoldVariant so the
 * table, sockets, bots, and end-game flow work today. Replace with real ${g.name}
 * rules (deal/legalActions/applyAction/views/botAction) following the reference
 * variants in /srv/tiles/hearts and /srv/tiles/dominoes.
 */
import { makeScaffoldVariant } from '../lib/variants/scaffold.js';
import cfg from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

const ${g.id} = makeScaffoldVariant({
  id: '${g.id}',
  name: '${g.name}',
  meta: cfg,
  catalog,
  actionLabel: '${g.actionLabel}',
});

export default ${g.id};
`;
  fs.writeFileSync(path.join(dir, 'index.js'), indexJs);
  console.log('provisioned', g.id);
}
console.log('done');
