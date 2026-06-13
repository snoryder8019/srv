import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/felt3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('CRAPS_LAYOUT')) { console.log('already'); process.exit(0); }

// Replace the craps felt builder with one that paints distinct, tappable boxes for
// the point-number PLACE bets (top row) and a center PROP GRID with individual
// hardway + combo boxes. Export CRAPS_LAYOUT so the client maps taps to the same
// geometry (single source of truth).
const oldBuilder = s.slice(s.indexOf('// ───────────────────────── CRAPS ─────────────────────────'), s.indexOf('// ───────────────────────── ROULETTE ─────────────────────────'));

const newBuilder = `// ───────────────────────── CRAPS ─────────────────────────
// Shared layout geometry (texture px on a 2048x1024 canvas). The client imports
// this to map felt taps + place chips on the exact same boxes.
export const CRAPS_LAYOUT = {
  W: 2048, H: 1024,
  // top row: point-number PLACE boxes (4 5 6 8 9 10)
  place: (() => {
    const by = 70, bh = 150, n = 6, pad = 60, gap = 12;
    const bw = (2048 - pad * 2) / n;
    const nums = [4, 5, 6, 8, 9, 10];
    return nums.map((num, i) => ({ num, side: 'place' + num, x: pad + i * bw, y: by, w: bw - gap, h: bh }));
  })(),
  // FIELD strip
  field: { side: 'field', x: 60, y: 392, w: 2048 - 120, h: 110 },
  // DON'T PASS + PASS LINE
  dontpass: { side: 'dontpass', x: 60, y: 664, w: 2048 - 120, h: 110 },
  pass: { side: 'pass', x: 60, y: 784, w: 2048 - 120, h: 150 },
  // center PROP GRID: 7 boxes (hard4 hard6 hard8 hard10 | any7 anycraps ce)
  props: (() => {
    const gx = 2048 / 2 - 540, gy = 250, bw = 270, bh = 90, gap = 10;
    const top = [
      { side: 'hard4', label: 'HARD 4', pay: '7:1' },
      { side: 'hard6', label: 'HARD 6', pay: '9:1' },
      { side: 'hard8', label: 'HARD 8', pay: '9:1' },
      { side: 'hard10', label: 'HARD 10', pay: '7:1' },
    ];
    const bot = [
      { side: 'any7', label: 'ANY 7', pay: '4:1' },
      { side: 'anycraps', label: 'ANY CRAPS', pay: '7:1' },
      { side: 'ce', label: 'C & E', pay: '3:1' },
    ];
    const out = [];
    top.forEach((b, i) => out.push({ ...b, x: gx + i * (bw + gap), y: gy, w: bw, h: bh }));
    const bw2 = (top.length * (bw + gap) - gap) / bot.length;
    bot.forEach((b, i) => out.push({ ...b, x: gx + i * (bw2 + gap), y: gy + bh + gap, w: bw2 - gap + gap, h: bh }));
    return out;
  })(),
};

export function buildCrapsFelt() {
  const W = 2048, H = 1024;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const c = cvs.getContext('2d');
  feltBase(c, W, H, '#0b4d31');
  c.strokeStyle = '#e8d48a'; c.lineWidth = 5; c.strokeRect(24, 24, W - 48, H - 48);

  const L = CRAPS_LAYOUT;

  // point-number PLACE boxes across the top
  for (const b of L.place) {
    box(c, b.x, b.y, b.w, b.h, String(b.num), { font: 'bold 64px Georgia', color: '#f3eccf' });
    c.fillStyle = 'rgba(243,236,207,.6)'; c.font = '20px Georgia'; c.textAlign = 'center';
    c.fillText('PLACE', b.x + b.w / 2, b.y + b.h - 22);
  }

  // center PROP GRID (hardways + combos), each its own labelled box
  for (const b of L.props) {
    const isHard = b.side.startsWith('hard');
    box(c, b.x, b.y, b.w, b.h, b.label, {
      fill: isHard ? 'rgba(70,40,20,.45)' : 'rgba(20,40,60,.45)',
      font: 'bold 30px Georgia', color: '#ffe9a8',
    });
    c.fillStyle = 'rgba(243,236,207,.7)'; c.font = '18px Georgia'; c.textAlign = 'center';
    c.fillText(b.pay, b.x + b.w / 2, b.y + b.h - 16);
  }

  // FIELD strip
  box(c, L.field.x, L.field.y, L.field.w, L.field.h, 'FIELD  2 3 4 9 10 11 12', { font: 'bold 40px Georgia', color: '#cfe7d8' });
  // COME bar (decorative, sits between field and props — not bettable yet)
  box(c, 60, 520, W - 120, 120, 'C O M E', { font: 'bold 56px Georgia', color: '#9fb0a6', stroke: '#6f8478' });

  // DON'T PASS + PASS LINE
  box(c, L.dontpass.x, L.dontpass.y, L.dontpass.w, L.dontpass.h, "DON'T PASS BAR", { font: 'bold 48px Georgia', color: '#dfe7df' });
  box(c, L.pass.x, L.pass.y, L.pass.w, L.pass.h, 'PASS LINE', { font: 'bold 72px Georgia', color: '#ffe9a8', stroke: '#ffe9a8', lw: 5 });

  // title
  c.fillStyle = 'rgba(243,236,207,.5)'; c.font = 'italic 28px Georgia'; c.textAlign = 'center';
  c.fillText('madLadsLab · CRAPS', W / 2, 50);

  return makeFeltMesh(cvs, 64, 32);
}

`;

s = s.replace(oldBuilder, newBuilder);
fs.writeFileSync(F, s);
console.log('felt3d: craps felt repainted with place boxes + prop grid; CRAPS_LAYOUT exported');
