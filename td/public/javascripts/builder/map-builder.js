/**
 * Map builder - paint hex roles (spawn/base/path/blocked), submit map definition.
 * Touch: tap to paint single hex, drag-paint also supported (move while held).
 */
import { createScene } from '../three/scene.js';
import { buildHexBoard, setTileRole, pickHex } from '../three/hex-board.js';

const host = document.getElementById('td-map-host');
let currentTool = 'path';
let radius = 6;

const { scene, camera, animate, renderer } = createScene(host);
let { tiles } = buildHexBoard(scene, { radius });

function rebuild() {
  for (const mesh of tiles.values()) scene.remove(mesh);
  ({ tiles } = buildHexBoard(scene, { radius }));
}

// Tool buttons
document.querySelectorAll('[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTool = btn.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Radius change
document.querySelector('[name="radius"]').addEventListener('change', (e) => {
  radius = parseInt(e.target.value, 10);
  rebuild();
});

// ---- Tap-vs-drag painting -----------------------------------------------
// Single tap: paint one hex. Drag (hold + move): does NOT paint - that's camera rotation.
// Two-finger gesture: pinch zoom (handled by OrbitControls).
const TAP_MAX_PX = 10;
const TAP_MAX_MS = 400;
let pointerStart = null;

function paintAt(e) {
  const hex = pickHex(e, host, camera, tiles);
  if (!hex) return;
  const role = currentTool === 'clear' ? 'default' : currentTool;
  setTileRole(hex, role);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pointerStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!pointerStart || pointerStart.id !== e.pointerId) { pointerStart = null; return; }
  const dist = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
  const dt = performance.now() - pointerStart.t;
  pointerStart = null;
  if (dist > TAP_MAX_PX || dt > TAP_MAX_MS) return; // drag, not tap
  paintAt(e);
});

renderer.domElement.addEventListener('pointercancel', () => { pointerStart = null; });

// Save
document.getElementById('map-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const collect = (role) => Array.from(tiles.values())
    .filter(m => m.userData.role === role)
    .map(m => ({ q: m.userData.q, r: m.userData.r }));

  const payload = {
    name: e.target.name.value,
    slug: e.target.slug.value,
    radius,
    spawnHexes: collect('spawn'),
    baseHexes: collect('base'),
    pathHexes: collect('path'),
    blockedHexes: collect('blocked'),
  };

  const res = await fetch('/api/v1/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.success) alert('Map saved! ID: ' + data.map._id);
  else alert('Save failed: ' + data.error);
});

animate();
console.log('[td/builder] map builder ready');
