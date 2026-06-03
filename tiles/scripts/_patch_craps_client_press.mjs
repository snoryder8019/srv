import fs from 'fs';
const F = '/srv/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('renderPressPrompt')) { console.log('already'); process.exit(0); }

// ── 1) Pass a friendly per-bet breakdown to the result banner. ──
// Build labels for sides and feed ev.breakdown (filtered to my seat) to showResult.
s = s.replace(
  `    showResult({
      title: String(sum),
      titleColor: (d > 0 ? 'green' : (d < 0 ? 'red' : null)),
      sub,
      delta: d,
      balance: bal,
    });`,
  `    const myBreak = Array.isArray(ev.breakdown)
      ? ev.breakdown.filter((r) => r.seat === C.mySeat).map((r) => ({ label: betLabel(r.side), delta: r.delta }))
      : null;
    showResult({
      title: String(sum),
      titleColor: (d > 0 ? 'green' : (d < 0 ? 'red' : null)),
      sub,
      delta: d,
      balance: bal,
      breakdown: myBreak,
    });`
);

// add a betLabel helper near numberWord
s = s.replace(
  `function numberWord(n) {`,
  `function betLabel(side) {
  const map = {
    pass: 'Pass', dontpass: "Don't Pass", field: 'Field', any7: 'Any 7',
    anycraps: 'Any Craps', ce: 'C & E',
    hard4: 'Hard 4', hard6: 'Hard 6', hard8: 'Hard 8', hard10: 'Hard 10',
    place4: 'Place 4', place5: 'Place 5', place6: 'Place 6',
    place8: 'Place 8', place9: 'Place 9', place10: 'Place 10',
  };
  return map[side] || side;
}
function numberWord(n) {`
);

// ── 2) Press/Pull prompt. A small DOM overlay shown when priv.pressable is set.
// Press adds the won profit back onto the riding bet; Pull keeps the winnings.
// Build the prompt element lazily and render from priv on each onPriv/onState.
const promptBlock = `
// ── Press / Pull prompt (riding place-bet wins) ─────────────────────────────
let _pressEl = null;
function ensurePressEl() {
  if (_pressEl) return _pressEl;
  const el = document.createElement('div');
  el.id = 'press-prompt';
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:120px', 'transform:translateX(-50%)',
    'z-index:120', 'display:none', 'flex-direction:column', 'gap:8px',
    'background:rgba(6,12,9,.92)', 'border:1px solid #e3c567', 'border-radius:16px',
    'padding:14px 18px', 'box-shadow:0 18px 60px rgba(0,0,0,.6)', 'min-width:240px',
    'font-family:system-ui',
  ].join(';');
  document.body.appendChild(el);
  _pressEl = el; return el;
}
let _pressKey = '';
function renderPressPrompt(priv) {
  const list = (priv && priv.pressable) || [];
  const key = JSON.stringify(list.map((p) => [p.id, p.won]));
  if (key === _pressKey) return;     // no change
  _pressKey = key;
  const el = ensurePressEl();
  if (!list.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML = '';
  const title = document.createElement('div');
  title.style.cssText = 'color:#ffe9a8;font-weight:800;text-align:center;letter-spacing:.06em';
  title.textContent = list.length > 1 ? 'YOUR NUMBERS HIT!' : (betLabel(list[0].side).toUpperCase() + ' HIT!');
  el.appendChild(title);
  for (const p of list) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'color:#cfe7d8;font-size:14px;flex:1';
    lbl.textContent = betLabel(p.side) + ' won +' + p.won;
    const press = document.createElement('button');
    press.textContent = 'PRESS';
    press.style.cssText = 'background:#2f8f5b;color:#06210f;border:none;border-radius:10px;padding:8px 14px;font-weight:800;cursor:pointer';
    press.onclick = () => { C.emitAction({ type: 'press', id: p.id }); if (T.Sound) T.Sound.click && T.Sound.click(); };
    const pull = document.createElement('button');
    pull.textContent = 'PULL';
    pull.style.cssText = 'background:#243; color:#cfe7d8;border:1px solid #6f8478;border-radius:10px;padding:8px 14px;font-weight:800;cursor:pointer';
    pull.onclick = () => { C.emitAction({ type: 'pull', id: p.id }); if (T.Sound) T.Sound.click && T.Sound.click(); };
    row.appendChild(lbl); row.appendChild(press); row.appendChild(pull);
    el.appendChild(row);
  }
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#9fb0a6;font-size:11px;text-align:center';
  hint.textContent = 'PRESS rides the winnings · PULL banks them';
  el.appendChild(hint);
}
`;
// inject the press prompt block right before the felt section divider
s = s.replace(
  `// ───────────────────────── tappable felt + chip stacks (craps) ─────────────────────────`,
  promptBlock + `\n// ───────────────────────── tappable felt + chip stacks (craps) ─────────────────────────`
);

// call renderPressPrompt from onPriv and onState
s = s.replace(
  `  onPriv() { HUD.render(); renderRollPrompt(C.priv); },`,
  `  onPriv() { HUD.render(); renderRollPrompt(C.priv); renderPressPrompt(C.priv); },`
);
s = s.replace(
  `  renderRollPrompt(C.priv);
  HUD.render();
  HUD.renderVote(s.vote);`,
  `  renderRollPrompt(C.priv);
  renderPressPrompt(C.priv);
  HUD.render();
  HUD.renderVote(s.vote);`
);

fs.writeFileSync(F, s);
console.log('craps client: per-bet breakdown in banner + press/pull prompt wired');
