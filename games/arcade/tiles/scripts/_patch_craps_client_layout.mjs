import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('CRAPS_LAYOUT')) { console.log('already'); process.exit(0); }

// import the shared layout
s = s.replace(
  /import \{ buildCrapsFelt \} from '\.\/felt3d\.js(\?v=\d+)?';/,
  "import { buildCrapsFelt, CRAPS_LAYOUT } from './felt3d.js$1';"
);
// (the $1 backref in the string won't be evaluated by replace's pattern when the
//  replacement is a literal — redo plainly to be safe)
s = s.replace(/import \{ buildCrapsFelt \} from '\.\/felt3d\.js/, "import { buildCrapsFelt, CRAPS_LAYOUT } from './felt3d.js");

// Replace betToTex with a layout-driven version (place boxes, props grid, lines).
const oldBetToTex = `// center px/py for each craps bet band (mirror of felt3d.buildCrapsFelt)
function betToTex(bet) {
  const side = bet.side;
  if (side === 'field') return { px: 1024, py: 447 };
  if (side === 'dontpass') return { px: 1024, py: 719 };
  if (side === 'pass') return { px: 1024, py: 859 };
  // props/hardways live in the center prop box
  if (['any7','anycraps','ce','hard4','hard6','hard8','hard10'].includes(side)) return { px: 1024, py: 572 };
  return { px: 1024, py: 572 };
}`;
const newBetToTex = `// center px/py for a bet, from the shared CRAPS_LAYOUT (single source of truth)
function boxCenter(b) { return { px: b.x + b.w / 2, py: b.y + b.h / 2 }; }
function betToTex(bet) {
  const L = CRAPS_LAYOUT;
  const side = bet.side;
  if (side === 'field') return boxCenter(L.field);
  if (side === 'dontpass') return boxCenter(L.dontpass);
  if (side === 'pass') return boxCenter(L.pass);
  const pl = L.place.find((b) => b.side === side);
  if (pl) return boxCenter(pl);
  const pr = L.props.find((b) => b.side === side);
  if (pr) return boxCenter(pr);
  return null;
}`;
s = s.replace(oldBetToTex, newBetToTex);

// Replace zoneAt with a layout-driven hit test that covers place boxes, props,
// field, don't-pass and pass.
const oldZone = `function zoneAt(px, py) {
  // mirror felt3d.buildCrapsFelt bands (H=1024):
  //   FIELD strip ~ y 392..502, DON'T PASS ~ y 664..774, PASS LINE ~ y 784..934
  if (py >= 392 && py < 502) return { side: 'field' };
  if (py >= 664 && py < 774) return { side: 'dontpass' };
  if (py >= 784 && py < 934) return { side: 'pass' };
  return null;
}`;
const newZone = `function inBox(b, px, py) { return px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h; }
function zoneAt(px, py) {
  const L = CRAPS_LAYOUT;
  // point-number PLACE boxes (top row)
  for (const b of L.place) if (inBox(b, px, py)) return { side: b.side };
  // center PROP GRID (hardways + combos)
  for (const b of L.props) if (inBox(b, px, py)) return { side: b.side };
  // line / field bands
  if (inBox(L.field, px, py)) return { side: 'field' };
  if (inBox(L.dontpass, px, py)) return { side: 'dontpass' };
  if (inBox(L.pass, px, py)) return { side: 'pass' };
  return null;
}`;
s = s.replace(oldZone, newZone);

fs.writeFileSync(F, s);
console.log('craps client: zoneAt + betToTex now layout-driven (place boxes + prop grid tappable)');
