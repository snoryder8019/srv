/**
 * Full roulette betting board for roulette3d.js:
 *  - a DOM overlay with the 0-36 number grid (colored), 2:1 columns, dozens,
 *    and even-money outsides; each cell places a bet at the selected stake
 *  - a stake selector (5/10/25/100) and a wallet balance pill
 *  - replaces the old quick-bet renderActions with a "Place bets ▾" launcher
 * Bets go straight to the server via C.emitAction; the server validates.
 */
import fs from 'fs';
const FILE = '/srv/games/arcade/tiles/public/js/roulette3d.js';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes('rouletteBoard')) { console.log('already has board'); process.exit(0); }

// 1) swap renderActions to open the board
const oldRA = `  renderActions(box, { priv, myTurn }) {
    if (!priv || !myTurn) return;
    const legal = priv.legal || [];
    const amt = (legal[0] && legal[0].amount) || 10;
    for (const o of OUTSIDE) {
      const a = legal.find((x) => x.type === 'bet' && x.side === o.side);
      if (!a) continue;
      const b = document.createElement('button'); b.className = 'act ' + o.cls; b.textContent = \`\${o.label} (\${a.amount})\`;
      b.onclick = () => C.emitAction(a); box.appendChild(b);
    }
    // quick straight-up bets (35:1) — full board can come later
    for (const num of [7, 0]) {
      const b = document.createElement('button'); b.className = 'act gold'; b.textContent = \`\${num} (35:1)\`;
      b.onclick = () => C.emitAction({ type: 'bet', side: 'number', n: num, amount: amt });
      box.appendChild(b);
    }
  },`;
const newRA = `  renderActions(box, { priv, myTurn }) {
    if (!priv || !myTurn) return;
    const b = document.createElement('button'); b.className = 'act gold';
    b.textContent = '🎯 Place a bet';
    b.onclick = () => openBoard();
    box.appendChild(b);
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#bfe0cd;font-size:12px;align-self:center';
    hint.textContent = 'one bet per spin';
    box.appendChild(hint);
  },`;
if (s.split(oldRA).length - 1 !== 1) throw new Error('renderActions anchor not found');
s = s.replace(oldRA, newRA);

// 2) append the board module at the end of the file
const board = `

// ───────────────────────── full betting board (DOM overlay) ─────────────────────────
const RED_N = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function numColor(n) { return n === 0 ? '#2f8f5b' : (RED_N.has(n) ? '#b5482f' : '#15171a'); }
let stake = 10;

function ensureBoard() {
  if (document.getElementById('rouletteBoard')) return;
  const wrap = document.createElement('div');
  wrap.id = 'rouletteBoard';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;background:rgba(4,7,5,.78);padding:12px';
  wrap.innerHTML = \`
    <div style="width:100%;max-width:520px;background:#0c1d14;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:16px;box-shadow:0 24px 70px rgba(0,0,0,.6)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:800;letter-spacing:.04em">PLACE YOUR BET</div>
        <button id="rbClose" style="width:32px;height:32px;border-radius:8px;background:#1d3b2b;color:#cfe7d8;border:none;font-size:14px;cursor:pointer">✕</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <span style="color:#9fb0a6;font-size:12px">Stake:</span>
        <div id="rbStakes" style="display:flex;gap:6px"></div>
        <span id="rbWallet" style="margin-left:auto;color:#e3c567;font-weight:800;font-size:13px">…chips</span>
      </div>
      <div id="rbGrid"></div>
    </div>\`;
  document.body.appendChild(wrap);
  document.getElementById('rbClose').onclick = () => { wrap.style.display = 'none'; };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.style.display = 'none'; });
  buildGrid();
  buildStakes();
}

function buildStakes() {
  const box = document.getElementById('rbStakes'); if (!box) return;
  box.innerHTML = '';
  [5, 10, 25, 100].forEach((v) => {
    const b = document.createElement('button');
    b.textContent = v;
    b.style.cssText = 'border:none;border-radius:8px;padding:6px 11px;font-weight:800;cursor:pointer;' + (v === stake ? 'background:#e3c567;color:#241d05' : 'background:#1d2733;color:#9fb0a6');
    b.onclick = () => { stake = v; buildStakes(); };
    box.appendChild(b);
  });
}

function bet(side, n) {
  const action = { type: 'bet', side, amount: stake };
  if (side === 'number') action.n = n;
  C.emitAction(action);
  const w = document.getElementById('rouletteBoard'); if (w) w.style.display = 'none';
}

function cell(label, bg, fg, onclick, flex) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:8px 0;font-weight:700;font-size:12.5px;cursor:pointer;color:' + (fg || '#f3efe2') + ';background:' + bg + ';flex:' + (flex || 1);
  b.onclick = onclick;
  return b;
}

function buildGrid() {
  const grid = document.getElementById('rbGrid'); if (!grid) return;
  grid.innerHTML = '';
  // zero (full width-ish)
  const zeroRow = document.createElement('div'); zeroRow.style.cssText = 'display:flex;gap:4px;margin-bottom:4px';
  zeroRow.appendChild(cell('0', numColor(0), '#fff', () => bet('number', 0), 1));
  grid.appendChild(zeroRow);
  // numbers 1..36 in three rows (top row 3,6,9..; standard layout) + a column bet at the end
  for (let row = 0; row < 3; row++) {
    const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:4px;margin-bottom:4px';
    for (let col = 0; col < 12; col++) {
      const n = col * 3 + (3 - row); // top row ends in 3,6,9.. ; standard orientation
      r.appendChild(cell(String(n), numColor(n), '#fff', () => bet('number', n), 1));
    }
    // column bet (2:1) at the right of each row: row0->col3 (3,6,9..), row1->col2, row2->col1
    const colSide = row === 0 ? 'col3' : (row === 1 ? 'col2' : 'col1');
    r.appendChild(cell('2:1', '#1d3b2b', '#cfe7d8', () => bet(colSide), 1));
    grid.appendChild(r);
  }
  // dozens
  const dz = document.createElement('div'); dz.style.cssText = 'display:flex;gap:4px;margin-bottom:4px';
  dz.appendChild(cell('1st 12', '#143726', '#cfe7d8', () => bet('dozen1'), 1));
  dz.appendChild(cell('2nd 12', '#143726', '#cfe7d8', () => bet('dozen2'), 1));
  dz.appendChild(cell('3rd 12', '#143726', '#cfe7d8', () => bet('dozen3'), 1));
  grid.appendChild(dz);
  // even-money outsides
  const ev = document.createElement('div'); ev.style.cssText = 'display:flex;gap:4px';
  ev.appendChild(cell('1-18', '#1d3b2b', '#cfe7d8', () => bet('low'), 1));
  ev.appendChild(cell('EVEN', '#1d3b2b', '#cfe7d8', () => bet('even'), 1));
  ev.appendChild(cell('RED', '#b5482f', '#fff', () => bet('red'), 1));
  ev.appendChild(cell('BLACK', '#15171a', '#fff', () => bet('black'), 1));
  ev.appendChild(cell('ODD', '#1d3b2b', '#cfe7d8', () => bet('odd'), 1));
  ev.appendChild(cell('19-36', '#1d3b2b', '#cfe7d8', () => bet('high'), 1));
  grid.appendChild(ev);
}

function refreshWallet() {
  const el = document.getElementById('rbWallet'); if (!el) return;
  fetch('/api/wallet/me', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d && d.ok) el.textContent = d.chips + ' chips'; else el.textContent = ''; })
    .catch(() => { el.textContent = ''; });
}

function openBoard() {
  ensureBoard();
  buildStakes();
  refreshWallet();
  document.getElementById('rouletteBoard').style.display = 'flex';
}
`;
s = s + board;
fs.writeFileSync(FILE, s);
console.log('roulette3d.js: full betting board added');
