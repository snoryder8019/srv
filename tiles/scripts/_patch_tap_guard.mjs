import fs from 'fs';

// Replace the naive pointerdown-fires-bet handler with proper TAP detection:
// remember where/when the pointer went down; only place a bet on pointerup if it
// barely moved and was quick (a tap, not a drag/pan). Applied to roulette + craps.
for (const file of ['/srv/tiles/public/js/roulette3d.js', '/srv/tiles/public/js/craps3d.js']) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes('_tapStart')) { console.log(file, 'already tap-guarded'); continue; }

  const oldHandler = `T.renderer.domElement.addEventListener('pointerdown', (e) => {
  // ignore taps that hit HUD controls (those have their own handlers); only felt
  feltBetZones(e.clientX, e.clientY);
}, false);`;
  const oldHandlerCraps = `T.renderer.domElement.addEventListener('pointerdown', (e) => { feltBetZones(e.clientX, e.clientY); }, false);`;

  const neu = `// Tap-vs-drag: only a genuine tap (pointer down + up at ~same spot, quickly)
// places a bet. A drag — i.e. orbiting/panning the camera — must NOT bet.
let _tapStart = null;
const TAP_MOVE_PX = 10;     // max travel to still count as a tap
const TAP_MS = 500;         // max duration to still count as a tap
T.renderer.domElement.addEventListener('pointerdown', (e) => {
  _tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
}, false);
T.renderer.domElement.addEventListener('pointermove', (e) => {
  if (!_tapStart || e.pointerId !== _tapStart.id) return;
  const moved = Math.hypot(e.clientX - _tapStart.x, e.clientY - _tapStart.y);
  if (moved > TAP_MOVE_PX) _tapStart = null;   // became a drag — cancel the tap
}, false);
T.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!_tapStart || e.pointerId !== _tapStart.id) { _tapStart = null; return; }
  const moved = Math.hypot(e.clientX - _tapStart.x, e.clientY - _tapStart.y);
  const dt = performance.now() - _tapStart.t;
  const wasTap = moved <= TAP_MOVE_PX && dt <= TAP_MS;
  _tapStart = null;
  if (wasTap) feltBetZones(e.clientX, e.clientY);
}, false);
T.renderer.domElement.addEventListener('pointercancel', () => { _tapStart = null; }, false);`;

  if (s.includes(oldHandler)) s = s.replace(oldHandler, neu);
  else if (s.includes(oldHandlerCraps)) s = s.replace(oldHandlerCraps, neu);
  else { console.log(file, 'WARN: handler anchor not found'); continue; }

  fs.writeFileSync(file, s);
  console.log(file, 'tap-guarded');
}
