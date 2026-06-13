// patch mahjong3d.js: handle the claim phase (pung/kong/chow/win/pass) + meld-aware copy
import fs from 'fs';
const FILE = '/srv/games/arcade/tiles/public/js/mahjong3d.js';
let s = fs.readFileSync(FILE, 'utf8');

// 1) replace renderActions body to add claim controls
const oldRA = `  renderActions(box, { priv, myTurn }) {
    if (!priv || !myTurn) return;
    const legal = priv.legal || [];
    const win = legal.find((a) => a.type === 'win');
    if (win) {
      const b = document.createElement('button'); b.className = 'act gold';
      b.textContent = '🀄 Declare Mahjong!';
      b.onclick = () => C.emitAction(win);
      box.appendChild(b);
    }
    const draw = legal.find((a) => a.type === 'draw');
    if (draw) {
      const b = document.createElement('button'); b.className = 'act';
      b.textContent = 'Draw tile';
      b.onclick = () => C.emitAction(draw);
      box.appendChild(b);
    } else if (legal.some((a) => a.type === 'discard')) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#bfe0cd;font-size:13px;align-self:center';
      hint.textContent = 'Tap a tile to discard';
      box.appendChild(hint);
    }
  },`;

const newRA = `  renderActions(box, { priv, myTurn }) {
    if (!priv || !myTurn) return;
    const legal = priv.legal || [];
    const mkBtn = (label, cls, action) => { const b = document.createElement('button'); b.className = 'act ' + cls; b.textContent = label; b.onclick = () => C.emitAction(action); box.appendChild(b); };

    // CLAIM phase: someone discarded a tile we can claim (or we pass)
    if (priv.phase === 'claim' && priv.claiming) {
      const t = priv.claiming.tile;
      const cw = legal.find((a) => a.type === 'claimWin'); if (cw) mkBtn('🀄 Win (Ron)!', 'gold', cw);
      const kong = legal.find((a) => a.type === 'kong'); if (kong) mkBtn('Kong ' + t, 'act', kong);
      const pung = legal.find((a) => a.type === 'pung'); if (pung) mkBtn('Pung ' + t, 'act', pung);
      for (const a of legal.filter((x) => x.type === 'chow')) mkBtn('Chow ' + a.with.join('+') + '·' + t, 'ghost', a);
      const pass = legal.find((a) => a.type === 'pass'); if (pass) mkBtn('Pass', 'ghost', pass);
      return;
    }

    const win = legal.find((a) => a.type === 'win');
    if (win) mkBtn('🀄 Declare Mahjong!', 'gold', win);
    const draw = legal.find((a) => a.type === 'draw');
    if (draw) { mkBtn('Draw tile', '', draw); }
    else if (legal.some((a) => a.type === 'discard')) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#bfe0cd;font-size:13px;align-self:center';
      hint.textContent = 'Tap a tile to discard';
      box.appendChild(hint);
    }
  },`;

if (!s.includes(newRA)) {
  if (s.split(oldRA).length - 1 !== 1) throw new Error('renderActions anchor not unique');
  s = s.replace(oldRA, newRA);
}

// 2) status line: mention claim opportunity
const oldStat = `  statusLine(v, c) {
    if (v.turn === c.mySeat) {
      const drew = c.priv && c.priv.drew;
      return drew ? '<b>YOUR TURN</b> · tap a tile to discard' : '<b>YOUR TURN</b> · draw a tile';
    }
    return \`seat \${v.turn} · wall \${v.wall}\`;
  },`;
const newStat = `  statusLine(v, c) {
    if (v.phase === 'claim' && v.claim && v.claim.waitingOn === c.mySeat) return '<b>CLAIM?</b> ' + v.claim.tile + ' discarded — pung/chow/win or pass';
    if (v.phase === 'claim') return 'claim window · ' + (v.claim ? v.claim.tile : '');
    if (v.turn === c.mySeat) {
      const drew = c.priv && c.priv.drew;
      return drew ? '<b>YOUR TURN</b> · tap a tile to discard' : '<b>YOUR TURN</b> · draw a tile';
    }
    return \`seat \${v.turn} · wall \${v.wall}\`;
  },`;
if (!s.includes(newStat)) {
  if (s.split(oldStat).length - 1 !== 1) throw new Error('statusLine anchor not unique');
  s = s.replace(oldStat, newStat);
}

// 3) info copy: claiming is now supported
s = s.replace(
  "        <li>When your 14 tiles form 4 melds + a pair, tap <b>Mahjong!</b> to win.</li>\n        <li>Honors (winds/dragons) can only form pungs, never runs.</li>\n        <li>This table is a self-draw race — no claiming others' discards yet.</li>",
  "        <li>When your tiles + exposed melds form 4 melds + a pair, win (tap <b>Mahjong!</b> on your draw, or <b>Win/Ron</b> on a discard).</li>\n        <li><b>Claim discards:</b> Pung (3 of a kind) or Kong (4) from anyone; Chow (a run) only from the player on your left.</li>\n        <li>Honors (winds/dragons) form pungs only, never runs.</li>"
);

fs.writeFileSync(FILE, s);
console.log('mahjong3d.js updated for claim phase + meld-aware copy');
