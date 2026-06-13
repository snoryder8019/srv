import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/roulette3d.js';
let s = fs.readFileSync(F, 'utf8');

// import seatColor alongside dropStack
s = s.replace(
  /import \{ dropStack \} from '\.\/chip3d\.js(\?v=\d+)?';/,
  "import { dropStack, seatColor } from './chip3d.js$1';"
);
// the regex backref won't substitute inside a string literal; do it plainly:
s = s.replace(/import \{ dropStack \} from '\.\/chip3d\.js/, "import { dropStack, seatColor } from './chip3d.js");

// pass per-seat colour in renderAllBets
s = s.replace(
  "dropStack(CHIPS, w.x + ox, w.z + oz, bet.amount, { dur: 1 });",
  "dropStack(CHIPS, w.x + ox, w.z + oz, bet.amount, { dur: 1, seatColor: seatColor(seat) });"
);

fs.writeFileSync(F, s);
console.log('roulette: per-seat chip colours wired');
