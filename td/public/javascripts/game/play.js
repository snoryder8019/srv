/**
 * Game play view - wires socket.io to renderers.
 * Server is authoritative - this file only renders state diffs and forwards intents.
 *
 * Touch handling: distinguishes tap (place tower) from drag (rotate camera)
 * by tracking pointerdown/pointerup distance and elapsed time.
 */
import { createScene } from '../three/scene.js';
import { buildHexBoard, setTileRole, pickHex } from '../three/hex-board.js';
import { hexKey } from '../three/hex-grid.js';
import { EnemyRenderer, TowerRenderer, TracerRenderer } from '../three/entities.js';

const host = document.getElementById('td-canvas-host');
const { scene, camera, animate, renderer } = createScene(host);

// ---- DOM helpers --------------------------------------------------------
const $ = (id) => document.getElementById(id);
const setHud = (key, value) => { const el = $(`hud-${key}`); if (el) el.textContent = value; };
const log = (...args) => console.log('[td/play]', ...args);

// ---- State (client mirror, never authoritative) -------------------------
const state = {
  runId: null,
  mapId: null,
  selectedTowerDef: null,
  tiles: null,
  pathHexes: new Set(),
  spawnHexes: new Set(),
  baseHexes: new Set(),
  blockedHexes: new Set(),
};

const enemyRenderer = new EnemyRenderer(scene);
const towerRenderer = new TowerRenderer(scene);
const tracerRenderer = new TracerRenderer(scene);

// ---- Socket -------------------------------------------------------------
const socket = io();

socket.on('connect', () => log('socket connected', socket.id));

socket.on('run:joined', ({ runId }) => {
  state.runId = runId;
  log('joined run', runId);
});

socket.on('run:started', ({ path }) => {
  log('run started, path length:', path.length);
});

socket.on('run:error', ({ error }) => {
  console.error('[td/play] run error:', error);
  alert('Game error: ' + error);
});

socket.on('run:ended', ({ status, score }) => {
  alert(`Run ${status}! Score: ${score}`);
});

// Wave events
socket.on('wave:start',   ({ wave }) => setHud('wave', wave + 1));
socket.on('wave:cleared', ({ wave }) => setHud('wave', `${wave + 1} ✓`));

// Enemy events
socket.on('enemy:spawned', (e) => enemyRenderer.spawn(e));
socket.on('enemy:killed',  ({ id, currency, score }) => {
  enemyRenderer.remove(id);
  setHud('currency', currency);
  setHud('score', score);
});
socket.on('enemy:reached-base', ({ id, baseHealth }) => {
  enemyRenderer.remove(id);
  setHud('health', baseHealth);
});

// Tower events
socket.on('tower:placed', (payload) => {
  towerRenderer.place(payload);
  setHud('currency', payload.currency);
});
socket.on('tower:fired', ({ towerId, targetId }) => {
  towerRenderer.fire(towerId);
  const towerEntity = towerRenderer.entities.get(towerId);
  const enemyEntity = enemyRenderer.entities.get(targetId);
  if (towerEntity && enemyEntity) {
    const from = towerEntity.group.position.clone(); from.y = 0.6;
    const to = enemyEntity.mesh.position.clone();
    tracerRenderer.fire(from, to);
  }
});

socket.on('state:tick', ({ enemies, baseHealth, currency, score, wave, intermission }) => {
  for (const e of enemies) enemyRenderer.updatePosition(e.id, e.q, e.r, e.hp);
  setHud('health', baseHealth);
  setHud('currency', currency);
  setHud('score', score);
  if (intermission) setHud('wave', `${wave + 1} (intermission)`);
});

// ---- Boot ---------------------------------------------------------------
async function boot() {
  const mapsRes = await fetch('/api/v1/maps?status=approved').then(r => r.json());
  let chosen = mapsRes.maps?.[0];
  if (!chosen) {
    const fallback = await fetch('/api/v1/maps?status=draft').then(r => r.json());
    chosen = fallback.maps?.[0];
  }
  if (!chosen) { showNoMapMessage(); return; }

  const detail = await fetch(`/api/v1/maps/${chosen._id}`).then(r => r.json());
  const map = detail.map;
  state.mapId = map._id;

  const indexSet = (arr) => new Set((arr || []).map(h => hexKey(h.q, h.r)));
  state.pathHexes = indexSet(map.pathHexes);
  state.spawnHexes = indexSet(map.spawnHexes);
  state.baseHexes = indexSet(map.baseHexes);
  state.blockedHexes = indexSet(map.blockedHexes);

  const { tiles } = buildHexBoard(scene, { radius: map.radius });
  state.tiles = tiles;

  for (const [k, mesh] of tiles.entries()) {
    if (state.pathHexes.has(k)) setTileRole(mesh, 'path');
    else if (state.spawnHexes.has(k)) setTileRole(mesh, 'spawn');
    else if (state.baseHexes.has(k)) setTileRole(mesh, 'base');
    else if (state.blockedHexes.has(k)) setTileRole(mesh, 'blocked');
  }

  await loadTowerPicker();
  socket.emit('run:start', { mapId: map._id, playerName: 'guest' });
}

async function loadTowerPicker() {
  const towersRes = await fetch('/api/v1/towers?status=approved').then(r => r.json());
  let towers = towersRes.towers || [];
  if (!towers.length) {
    const drafts = await fetch('/api/v1/towers?status=draft').then(r => r.json());
    towers = drafts.towers || [];
  }
  const picker = $('hud-tower-picker');
  if (!towers.length) {
    picker.innerHTML = '<em>No towers yet. <a href="/build/tower">Build one</a></em>';
    return;
  }
  picker.innerHTML = towers.map(t => `
    <button class="tower-pick" data-id="${t._id}" data-tower='${JSON.stringify({
      _id: t._id, name: t.name, gltfUrl: t.gltfUrl, stats: t.stats
    })}'>
      <strong>${t.name}</strong>
      <span>$${t.stats?.cost ?? '?'} · DMG ${t.stats?.damage ?? '?'} · RNG ${t.stats?.range ?? '?'}</span>
    </button>
  `).join('');
  picker.querySelectorAll('.tower-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.tower-pick').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedTowerDef = JSON.parse(btn.dataset.tower);
      log('selected tower:', state.selectedTowerDef.name);
    });
  });
}

function showNoMapMessage() {
  const picker = $('hud-tower-picker');
  picker.innerHTML = '<em>No maps yet. <a href="/build/map">Build one</a> to play.</em>';
}

// ---- Tap-vs-drag detection for tower placement -------------------------
// A "tap" = pointer down + up within 8px and 350ms. Anything bigger is treated
// as a drag (camera rotate / pinch zoom) and does NOT place a tower.
const TAP_MAX_PX = 8;
const TAP_MAX_MS = 350;
let pointerStart = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return; // only left mouse
  pointerStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!pointerStart || pointerStart.id !== e.pointerId) { pointerStart = null; return; }
  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  const dt = performance.now() - pointerStart.t;
  const dist = Math.hypot(dx, dy);
  pointerStart = null;
  if (dist > TAP_MAX_PX || dt > TAP_MAX_MS) return; // it was a drag, not a tap

  if (!state.selectedTowerDef || !state.tiles || !state.runId) return;
  const hex = pickHex(e, host, camera, state.tiles);
  if (!hex) return;
  const { q, r } = hex.userData;
  const k = hexKey(q, r);
  if (state.pathHexes.has(k) || state.spawnHexes.has(k) || state.baseHexes.has(k) || state.blockedHexes.has(k)) {
    log('cannot place on', state.tiles.get(k).userData.role);
    return;
  }
  socket.emit('run:place-tower', {
    runId: state.runId,
    towerId: state.selectedTowerDef._id,
    q, r,
  });
});

renderer.domElement.addEventListener('pointercancel', () => { pointerStart = null; });

socket.on('place:rejected', ({ reason }) => log('placement rejected:', reason));

// ---- Animate -----------------------------------------------------------
animate(() => tracerRenderer.update());

// HUD initial values
setHud('wave', '-');
setHud('health', '-');
setHud('currency', '-');
setHud('score', '0');

boot().catch(err => console.error('[td/play] boot failed:', err));
