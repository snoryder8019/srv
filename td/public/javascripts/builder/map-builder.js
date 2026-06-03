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
  // preserve painted roles across a radius change (so you can add edge tiles
  // without losing your map). key -> role.
  const prevRoles = new Map();
  for (const [k, mesh] of tiles.entries()) {
    if (mesh.userData.role && mesh.userData.role !== 'default') prevRoles.set(k, mesh.userData.role);
  }
  for (const mesh of tiles.values()) scene.remove(mesh);
  ({ tiles } = buildHexBoard(scene, { radius }));
  for (const [k, role] of prevRoles.entries()) {
    const mesh = tiles.get(k);
    if (mesh) setTileRole(mesh, role);   // tiles still on the (possibly larger) board keep their role
  }
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


// ───────────────────────── WAVE DESIGNER ─────────────────────────
// Author waves: each wave has enemy groups (type/count/delay) + an optional
// disguised-infiltrator objective (the Where's-Waldo unit). Saved with the map.
const ENEMY_KINDS = ['grunt', 'runner', 'machine', 'flyer', 'basic', 'fast', 'tank'];
const waves = [
  { enemies: [{ type: 'grunt', count: 10, delayMs: 700 }], intermissionMs: 6000, infiltrator: false },
];

function renderWaves() {
  const host = document.getElementById('wd-list');
  if (!host) return;
  host.innerHTML = '';
  waves.forEach((w, wi) => {
    const card = document.createElement('div');
    card.className = 'wd-wave';
    const groups = w.enemies.map((g, gi) => {
      const opts = ENEMY_KINDS.map((k) => '<option value="' + k + '"' + (k === g.type ? ' selected' : '') + '>' + k + '</option>').join('');
      return '<div class="wd-grp" data-gi="' + gi + '">' +
        '<select data-f="type">' + opts + '</select>' +
        '<input data-f="count" type="number" min="1" value="' + g.count + '" title="count">' +
        '<input data-f="delayMs" type="number" min="0" step="50" value="' + g.delayMs + '" title="ms between spawns">' +
        '<button type="button" class="btn small grp-del">✕</button></div>';
    }).join('');
    card.innerHTML =
      '<div class="wd-head"><strong>Wave ' + (wi + 1) + '</strong>' +
        '<button type="button" class="btn small wave-del">✕ wave</button></div>' +
      '<div class="wd-groups">' + groups + '</div>' +
      '<button type="button" class="btn small grp-add">+ enemy group</button>' +
      '<label class="wd-inline">Intermission ms <input data-f="intermissionMs" type="number" min="0" step="500" value="' + w.intermissionMs + '" style="width:80px"></label>' +
      '<label class="wd-inline wd-infil"><input type="checkbox" data-f="infiltrator"' + (w.infiltrator ? ' checked' : '') + '> 🔍 Disguised infiltrator (Where\'s-Waldo objective)</label>';
    // bindings
    card.querySelector('.wave-del').addEventListener('click', () => { waves.splice(wi, 1); renderWaves(); });
    card.querySelector('.grp-add').addEventListener('click', () => { w.enemies.push({ type: 'grunt', count: 6, delayMs: 600 }); renderWaves(); });
    card.querySelector('[data-f="intermissionMs"]').addEventListener('input', (e) => { w.intermissionMs = Number(e.target.value); });
    card.querySelector('[data-f="infiltrator"]').addEventListener('change', (e) => { w.infiltrator = e.target.checked; });
    card.querySelectorAll('.wd-grp').forEach((row) => {
      const gi = Number(row.dataset.gi);
      row.querySelectorAll('[data-f]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const f = inp.dataset.f;
          w.enemies[gi][f] = f === 'type' ? inp.value : Number(inp.value);
        });
      });
      row.querySelector('.grp-del').addEventListener('click', () => { w.enemies.splice(gi, 1); if (!w.enemies.length) w.enemies.push({ type: 'grunt', count: 6, delayMs: 600 }); renderWaves(); });
    });
    host.appendChild(card);
  });
}

// build the wave payload: groups as-is + inject one infiltrator group when toggled
function buildWavesPayload() {
  return waves.map((w) => {
    const enemies = w.enemies.map((g) => ({ type: g.type, count: g.count, delayMs: g.delayMs }));
    if (w.infiltrator) enemies.push({ type: 'infiltrator', count: 1, delayMs: 1200 });
    return { enemies, intermissionMs: w.intermissionMs };
  });
}

const wdAdd = document.getElementById('wd-add');
if (wdAdd) wdAdd.addEventListener('click', () => {
  waves.push({ enemies: [{ type: 'grunt', count: 8 + waves.length * 4, delayMs: 600 }], intermissionMs: 6000, infiltrator: false });
  renderWaves();
});
renderWaves();

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
    waves: buildWavesPayload(),
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
