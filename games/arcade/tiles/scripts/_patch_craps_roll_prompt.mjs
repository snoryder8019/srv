import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('ROLLPROMPT')) { console.log('already has roll prompt'); process.exit(0); }

// Add a visible, tappable roll prompt mesh in the center. It appears whenever the
// local player is the shooter in the roll phase (or can finish betting), giving a
// clear affordance instead of relying on tapping invisible/empty dice.
s = s.replace(
  `const DICE = new THREE.Group(); T.scene.add(DICE);
const PUCK = new THREE.Group(); T.scene.add(PUCK);`,
  `const DICE = new THREE.Group(); T.scene.add(DICE);
const PUCK = new THREE.Group(); T.scene.add(PUCK);

// ── ROLLPROMPT: a glowing tappable disc in the center that says TAP TO ROLL /
// TAP TO BET-AND-ROLL. Visible only when the local seat can roll (shooter, roll
// phase) or can finish betting. It is itself the raycast target for rolling. ──
const ROLLPROMPT = new THREE.Group(); T.scene.add(ROLLPROMPT);
let _promptMode = null;   // 'roll' | 'done' | null
function rollPromptTexture(text, glow) {
  const S = 256, cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const c = cvs.getContext('2d');
  c.clearRect(0,0,S,S);
  c.beginPath(); c.arc(S/2,S/2,S/2-6,0,Math.PI*2);
  c.fillStyle = glow ? 'rgba(227,197,103,.92)' : 'rgba(47,143,91,.92)'; c.fill();
  c.lineWidth = 8; c.strokeStyle = '#fff8e0'; c.stroke();
  c.fillStyle = glow ? '#241d05' : '#06210f';
  c.font = 'bold 34px system-ui'; c.textAlign='center'; c.textBaseline='middle';
  const lines = text.split('\\n');
  lines.forEach((ln,i)=>c.fillText(ln, S/2, S/2 + (i-(lines.length-1)/2)*38));
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function renderRollPrompt(priv) {
  const legal = (priv && priv.legal) || [];
  const canRoll = legal.some(a => a.type === 'roll');
  const canDone = priv && priv.phase === 'bets' && priv.yourTurn && legal.some(a => a.type === 'done');
  const mode = canRoll ? 'roll' : (canDone ? 'done' : null);
  if (mode === _promptMode) return;
  _promptMode = mode;
  for (const m of ROLLPROMPT.children.slice()) ROLLPROMPT.remove(m);
  if (!mode) return;
  const label = mode === 'roll' ? 'TAP\\nTO ROLL' : 'TAP TO\\nROLL ▸';
  const tex = rollPromptTexture(label, mode === 'roll');
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  disc.rotation.x = -Math.PI/2; disc.position.set(0, 1.2, 4); disc.name = 'rollprompt';
  ROLLPROMPT.add(disc);
}`
);

// drive the prompt each state update (after renderPuck/maybeRoll)
s = s.replace(
  `  if (s.phase !== 'lobby') { renderPuck(v); maybeRoll(v, true); }`,
  `  if (s.phase !== 'lobby') { renderPuck(v); maybeRoll(v, true); }
  renderRollPrompt(C.priv);`
);
// also refresh the prompt on private-view updates (yourTurn / phase changes)
s = s.replace(
  `  onPriv() { HUD.render(); },`,
  `  onPriv() { HUD.render(); renderRollPrompt(C.priv); },`
);

// make the prompt a raycast target + a tap on it rolls (or finishes betting)
s = s.replace(
  `  const hits = T.raycast(clientX, clientY, [FELT, DICE]);
  if (!hits.length) return;`,
  `  const hits = T.raycast(clientX, clientY, [ROLLPROMPT, DICE, FELT]);
  if (!hits.length) return;
  // a tap on the roll prompt disc: roll if allowed, else finish betting
  const hitPrompt = hits.some(h => h.object && h.object.name === 'rollprompt');
  if (hitPrompt) {
    const priv = C.priv || {};
    if ((priv.legal || []).some(a => a.type === 'roll')) { C.emitAction({ type: 'roll' }); return; }
    if (priv.phase === 'bets' && priv.yourTurn) { C.emitAction({ type: 'done' }); return; }
    return;
  }`
);

// pulse the prompt so it's obviously interactive
s = s.replace(
  `T.onFrame(() => { clearChipsIfNewRound(); });`,
  `T.onFrame((now) => {
  clearChipsIfNewRound();
  const d = ROLLPROMPT.children[0];
  if (d) { const p = 1 + Math.sin((now||0)/260) * 0.06; d.scale.setScalar(p); }
});`
);

fs.writeFileSync(F, s);
console.log('craps: added visible tappable roll prompt');
