/**
 * felt3d.js — canvas-painted casino felt layouts laid flat on the table.
 *
 * Each builder returns a THREE.Mesh (a thin plane just above the felt) carrying a
 * high-res canvas texture of the betting layout — the real "table felt" look.
 * Purely decorative; betting still happens through the HUD/board. Two layouts:
 *   buildCrapsFelt()    — pass / don't-pass bar, FIELD, the 4·5·6·8·9·10 point
 *                         boxes, BIG 6/8, and the center prop grid (hardways,
 *                         single-number props 2·3·11·12, any-bets, horn)
 *   buildRouletteFelt() — the classic 0-36 grid + 2:1 columns, dozens, and the
 *                         even-money outside bar (red/black, even/odd, 1-18/19-36)
 */
import * as THREE from 'three';

const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function numColor(n) { return n === 0 ? '#1f7a4d' : (RED.has(n) ? '#a23824' : '#161616'); }

function makeFeltMesh(canvas, w, h) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, transparent: true })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  mesh.receiveShadow = true;
  return mesh;
}

function feltBase(c, W, H, tint) {
  c.fillStyle = tint || '#0c5a38'; c.fillRect(0, 0, W, H);
  // subtle felt vignette
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,.05)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}
function box(c, x, y, w, h, label, opt = {}) {
  c.strokeStyle = opt.stroke || '#e8d48a'; c.lineWidth = opt.lw || 3;
  c.fillStyle = opt.fill || 'rgba(0,0,0,0)';
  c.beginPath(); c.rect(x, y, w, h); c.fill(); c.stroke();
  if (label) {
    c.fillStyle = opt.color || '#f3eccf';
    c.font = (opt.font || 'bold 26px Georgia'); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.save(); c.translate(x + w / 2, y + h / 2); if (opt.rot) c.rotate(opt.rot); c.fillText(label, 0, 0); c.restore();
  }
}

// ───────────────────────── CRAPS ─────────────────────────
// Shared layout geometry (texture px on a 2048x1024 canvas). The client imports
// this to map felt taps + place chips on the exact same boxes.
export const CRAPS_LAYOUT = {
  W: 2048, H: 1024,
  // top row: point-number PLACE boxes (4 5 6 8 9 10)
  place: (() => {
    const by = 80, bh = 120, n = 6, pad = 60, gap = 12;
    const bw = (2048 - pad * 2) / n;
    const nums = [4, 5, 6, 8, 9, 10];
    return nums.map((num, i) => ({ num, side: 'place' + num, x: pad + i * bw, y: by, w: bw - gap, h: bh }));
  })(),
  // center PROP GRID: 3 rows × 4 cols
  //   row1 hardways · row2 single-number one-roll props · row3 any-bets + horn
  props: (() => {
    const cols = 4, bw = 300, bh = 80, gap = 12;
    const gridW = cols * bw + (cols - 1) * gap;
    const gx = (2048 - gridW) / 2, gy = 220;
    const rows = [
      [ { side: 'hard4', label: 'HARD 4', pay: '7:1' }, { side: 'hard6', label: 'HARD 6', pay: '9:1' },
        { side: 'hard8', label: 'HARD 8', pay: '9:1' }, { side: 'hard10', label: 'HARD 10', pay: '7:1' } ],
      [ { side: 'two', label: 'ACES · 2', pay: '30:1' }, { side: 'three', label: 'ACE-DEUCE · 3', pay: '15:1' },
        { side: 'yo', label: 'YO · 11', pay: '15:1' }, { side: 'twelve', label: 'BOXCARS · 12', pay: '30:1' } ],
      [ { side: 'any7', label: 'ANY 7', pay: '4:1' }, { side: 'anycraps', label: 'ANY CRAPS', pay: '7:1' },
        { side: 'ce', label: 'C & E', pay: '3:1' }, { side: 'horn', label: 'HORN', pay: 'split' } ],
    ];
    const out = [];
    rows.forEach((row, r) => row.forEach((b, ci) =>
      out.push({ ...b, x: gx + ci * (bw + gap), y: gy + r * (bh + gap), w: bw, h: bh })));
    return out;
  })(),
  // BIG 6 / BIG 8 — even-money, ride until they hit or seven-out
  big: (() => {
    const bw = 300, bh = 72, gap = 12, gy = 504;
    const totW = 2 * bw + gap, gx = (2048 - totW) / 2;
    return [
      { side: 'big6', label: 'BIG 6', pay: '1:1', x: gx, y: gy, w: bw, h: bh },
      { side: 'big8', label: 'BIG 8', pay: '1:1', x: gx + bw + gap, y: gy, w: bw, h: bh },
    ];
  })(),
  // FIELD strip
  field: { side: 'field', x: 60, y: 596, w: 2048 - 120, h: 100 },
  // DON'T PASS + PASS LINE
  dontpass: { side: 'dontpass', x: 60, y: 716, w: 2048 - 120, h: 96 },
  pass: { side: 'pass', x: 60, y: 832, w: 2048 - 120, h: 136 },
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
    box(c, b.x, b.y, b.w, b.h, String(b.num), { font: 'bold 60px Georgia', color: '#f3eccf' });
    c.fillStyle = 'rgba(243,236,207,.6)'; c.font = '20px Georgia'; c.textAlign = 'center';
    c.fillText('PLACE', b.x + b.w / 2, b.y + b.h - 20);
  }

  // center PROP GRID (hardways · single-number props · any-bets + horn)
  const ANY = new Set(['any7', 'anycraps', 'ce', 'horn']);
  for (const b of L.props) {
    const fill = b.side.startsWith('hard') ? 'rgba(70,40,20,.45)'
      : ANY.has(b.side) ? 'rgba(60,22,48,.42)'
      : 'rgba(20,40,60,.45)';   // single-number props
    box(c, b.x, b.y, b.w, b.h, b.label, { fill, font: 'bold 26px Georgia', color: '#ffe9a8' });
    c.fillStyle = 'rgba(243,236,207,.7)'; c.font = '17px Georgia'; c.textAlign = 'center';
    c.fillText(b.pay, b.x + b.w / 2, b.y + b.h - 14);
  }

  // BIG 6 / BIG 8 even-money boxes
  for (const b of L.big) {
    box(c, b.x, b.y, b.w, b.h, b.label, { fill: 'rgba(20,55,35,.5)', font: 'bold 34px Georgia', color: '#cfe7d8' });
    c.fillStyle = 'rgba(243,236,207,.7)'; c.font = '16px Georgia'; c.textAlign = 'center';
    c.fillText(b.pay + ' · before 7', b.x + b.w / 2, b.y + b.h - 13);
  }

  // FIELD strip
  box(c, L.field.x, L.field.y, L.field.w, L.field.h, 'FIELD  2 3 4 9 10 11 12  (2x on 2 · 12)', { font: 'bold 38px Georgia', color: '#cfe7d8' });

  // DON'T PASS + PASS LINE
  box(c, L.dontpass.x, L.dontpass.y, L.dontpass.w, L.dontpass.h, "DON'T PASS BAR", { font: 'bold 48px Georgia', color: '#dfe7df' });
  box(c, L.pass.x, L.pass.y, L.pass.w, L.pass.h, 'PASS LINE', { font: 'bold 72px Georgia', color: '#ffe9a8', stroke: '#ffe9a8', lw: 5 });

  // title
  c.fillStyle = 'rgba(243,236,207,.5)'; c.font = 'italic 28px Georgia'; c.textAlign = 'center';
  c.fillText('madLadsLab · CRAPS', W / 2, 50);

  return makeFeltMesh(cvs, 64, 32);
}

// ───────────────────────── ROULETTE ─────────────────────────
export function buildRouletteFelt() {
  const W = 2048, H = 1024;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const c = cvs.getContext('2d');
  feltBase(c, W, H, '#0b4d31');
  c.strokeStyle = '#e8d48a'; c.lineWidth = 5; c.strokeRect(24, 24, W - 48, H - 48);

  // layout occupies the lower 2/3 (wheel mesh floats over the top third)
  const gridX = 220, gridY = 360, cellW = 130, cellH = 130;
  // zero (tall, left)
  box(c, gridX - cellW, gridY, cellW, cellH * 3, '0', { fill: numColor(0), font: 'bold 70px Georgia', color: '#fff' });
  // 1..36 in 3 rows × 12 cols (top row 3,6,9..)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 12; col++) {
      const n = col * 3 + (3 - row);
      const x = gridX + col * cellW, y = gridY + row * cellH;
      box(c, x, y, cellW, cellH, String(n), { fill: numColor(n), font: 'bold 56px Georgia', color: '#fff', stroke: '#d8cea0' });
    }
    // 2:1 column bet at the right
    box(c, gridX + 12 * cellW, gridY + row * cellH, cellW, cellH, '2:1', { font: 'bold 40px Georgia', color: '#f3eccf' });
  }
  // dozens
  const dy = gridY + 3 * cellH;
  ['1st 12', '2nd 12', '3rd 12'].forEach((d, i) => box(c, gridX + i * 4 * cellW, dy, 4 * cellW, 90, d, { font: 'bold 40px Georgia', color: '#f3eccf' }));
  // even-money bar
  const ey = dy + 90;
  ['1-18', 'EVEN', 'RED', 'BLACK', 'ODD', '19-36'].forEach((lbl, i) => {
    const fill = lbl === 'RED' ? numColor(1) : lbl === 'BLACK' ? numColor(2) : 'rgba(0,0,0,0)';
    box(c, gridX + i * 2 * cellW, ey, 2 * cellW, 90, lbl, { fill, font: 'bold 38px Georgia', color: '#f3eccf' });
  });

  c.fillStyle = 'rgba(243,236,207,.5)'; c.font = 'italic 28px Georgia'; c.textAlign = 'center';
  c.fillText('madLadsLab · ROULETTE', W / 2, 60);

  return makeFeltMesh(cvs, 64, 32);
}

export default { buildCrapsFelt, buildRouletteFelt };
