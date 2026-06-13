/**
 * Game play entry/orchestrator.
 * Creates the scene + renderers, binds socket events to renderers/UI, handles
 * tap-vs-drag input, and boots the run. State, networking, DOM helpers and the
 * card/loadout UI live in sibling modules (state/net/dom/ui).
 *
 * Server is authoritative - this file only renders state diffs and forwards intents.
 */
import { createScene } from '../three/scene.js';
import { buildHexBoard, setTileRole, pickHex } from '../three/hex-board.js';
import { hexKey, HEX, axialToWorld } from '../three/hex-grid.js';
import { EnemyRenderer, TowerRenderer, BaseRenderer, LootRenderer, ProjectileRenderer, ExplosionRenderer, MuzzleRenderer, SparkRenderer, ShockwaveRenderer, CameraShaker, SceneryRenderer } from '../three/entities/index.js';
import { state } from './state.js';
import { socket } from './net.js';
import { $, setHud, log, toast } from './dom.js';
import { setCurrency, renderHand, renderForecast, renderActionHand, clearActionSel, showLoadout } from './ui.js';
import { initNarrative } from './narrative.js';
import { initTactical, isHunting, exposeEnemy } from './tactical.js';
import { initDesertGuard, setRunActive } from './desert-guard.js';
import * as THREE from 'three';
import { skinFor } from '../siege/skins.js';

const host = document.getElementById('td-canvas-host');
const { scene, camera, animate, renderer, controls } = createScene(host);

const enemyRenderer = new EnemyRenderer(scene);
const towerRenderer = new TowerRenderer(scene);
const projectileRenderer = new ProjectileRenderer(scene);
const explosionRenderer = new ExplosionRenderer(scene);
const muzzleRenderer = new MuzzleRenderer(scene);
const sparkRenderer = new SparkRenderer(scene);
const shockwaveRenderer = new ShockwaveRenderer(scene);
const cameraShaker = new CameraShaker(camera);
const sceneryRenderer = new SceneryRenderer(scene);
const baseRenderer = new BaseRenderer(scene);
const lootRenderer = new LootRenderer(scene);
lootRenderer.setCamera(camera);
window.__td = { scene, camera, controls, get enemies(){return enemyRenderer;} };
towerRenderer.setCamera(camera);

// ---- Socket events -> renderers / UI ------------------------------------
socket.on('connect', () => log('socket connected', socket.id));
socket.on('cards:hand', ({ hand }) => renderHand(hand));
socket.on('walls:forecast', ({ current, waves }) => renderForecast(current, waves));
socket.on('action:hand', ({ hand, drew }) => { renderActionHand(hand); if (drew) toast('Drew a card', 'good'); });
socket.on('tower:buffed', ({ towerId, name }) => { towerRenderer.fire(towerId); toast((name || 'Buff') + ' applied', 'good'); });
socket.on('base:healed', ({ baseHealth }) => { setHud('health', baseHealth); baseRenderer.setHealth(baseHealth / 100); });
socket.on('run:reward', ({ card }) => toast('New card: ' + card.name + ' (' + card.rarity + ')', 'reward'));
socket.on('run:levelup', ({ level }) => toast('Level up! Lv ' + level, 'reward'));
socket.on('run:xp', ({ gained }) => toast('+' + gained + ' XP'));
socket.on('card:rejected', ({ reason }) => toast('Cannot play: ' + reason, 'bad'));

socket.on('run:joined', ({ runId }) => { state.runId = runId; setRunActive(true); log('joined run', runId); });
socket.on('run:started', ({ path }) => log('run started, path length:', path.length));
socket.on('run:error', ({ error, code }) => {
  if (code === 'auth_required') { window.location.href = '/auth/google'; return; }
  console.error('[td/play] run error:', error);
  alert('Game error: ' + error);
});
socket.on('run:ended', (payload) => { setRunActive(false); showEndScreen(payload || {}); });

socket.on('wave:start',   ({ wave }) => setHud('wave', wave + 1));
socket.on('wave:cleared', ({ wave }) => setHud('wave', `${wave + 1} ✓`));

socket.on('enemy:spawned', (e) => enemyRenderer.spawn(e));
socket.on('enemy:killed',  ({ id, currency, score }) => {
  const dying = enemyRenderer.entities.get(id);
  if (dying && dying.root) {
    const at = dying.root.position.clone();
    explosionRenderer.burst(at, { scale: 1.1 });
    sparkRenderer.burst(at, { count: 14 });
    shockwaveRenderer.burst(at);
    cameraShaker.shake(0.18, 0.22);
  }
  enemyRenderer.remove(id);
  setCurrency(currency);
  setHud('score', score);
});
socket.on('enemy:reached-base', ({ id, baseHealth }) => {
  enemyRenderer.remove(id);
  setHud('health', baseHealth);
  baseRenderer.setHealth(baseHealth / 100);
});

socket.on('tower:placed', (payload) => {
  // siege-kit reskin: a tower with no model of its own borrows the instance
  // kind's default defender (skinFor). Free play (no siege kind) is unchanged.
  const kind = state.siege && state.siege.kind;
  let render = payload;
  if (kind) {
    const skin = skinFor(kind, { gltfUrl: payload.gltfUrl, scale: payload.scale });
    render = { ...payload, gltfUrl: skin.gltfUrl, scale: skin.scale };
  }
  towerRenderer.place(render);
  state.towersByHex.set(hexKey(payload.q, payload.r), payload.id);
  setCurrency(payload.currency);
});
socket.on('tower:fired', ({ towerId, targetId }) => {
  const towerEntity = towerRenderer.entities.get(towerId);
  const enemyEntity = enemyRenderer.entities.get(targetId);
  if (towerEntity && enemyEntity) {
    const to = enemyEntity.root.position.clone();
    towerRenderer.fire(towerId, to);                 // yaw the turret to track + recoil
    const from = towerRenderer.muzzleWorld(towerId) || (() => { const f = towerEntity.group.position.clone(); f.y = 0.6 * HEX.SIZE; return f; })();
    const dir = to.clone().sub(from).normalize();
    muzzleRenderer.flash(from, { dir });
    // arc a projectile at the target; on arrival burst at the enemy's LIVE
    // position (it may have moved during flight), else fall back to impact point.
    projectileRenderer.fire(from, to, { onImpact: () => {
      const live = enemyRenderer.entities.get(targetId);
      const at = (live && live.root) ? live.root.position.clone() : to;
      explosionRenderer.burst(at, { scale: 0.7 });
      sparkRenderer.burst(at, { count: 8 });
      enemyRenderer.hit(targetId);                   // flash the unit on impact
    } });
  } else {
    towerRenderer.fire(towerId);                     // no live target — scale-punch only
  }
});

socket.on('state:tick', ({ enemies, baseHealth, currency, score, wave, intermission, loot }) => {
  if (loot) updateLootHud(loot);
  for (const e of enemies) enemyRenderer.updatePosition(e.id, e.q, e.r, e.hp);
  setHud('health', baseHealth);
  baseRenderer.setHealth(baseHealth / 100);
  setCurrency(currency);
  setHud('score', score);
  if (intermission) setHud('wave', `${wave + 1} (intermission)`);
});

socket.on('loot:drop', (d) => { lootRenderer.drop(d); if (d.loot) updateLootHud(d.loot); });
socket.on('run:deploy-state', (st) => { window.__deploy = st; updateDeployHud(st); });
socket.on('place:rejected', ({ reason }) => log('placement rejected:', reason));

// Tactical pause: draw bezier attack lines from each enemy to the base; clear on resume.
socket.on('run:tactical', () => { enemyRenderer.showAttackLines(window.__attackPoint || { x: 0, z: 0 }); });
socket.on('run:resumed', () => { enemyRenderer.hideAttackLines(); });

// ---- Narrative modal (story beats) --------------------------------------
initNarrative();
initTactical();
initDesertGuard();

// ---- Boot ---------------------------------------------------------------
async function boot() {
  const params = new URLSearchParams(location.search);
  // siege-kit launch (madlands -> here): a server-verified InstanceDescriptor on
  // window.__SIEGE__. It pins the board (board.mapId), the mode (siege/defend/
  // explore), the wave pacing knob and the inventory location to deploy from.
  // Absent => classic free play. (Server-side use of mode/pacing/loadout is the
  // next increment; here we honour the board + stash the descriptor.)
  const siege = window.__SIEGE__ || null;
  state.siege = siege;
  // ?level=<id> plays a campaign level: fetch the level, then its mapId's board.
  // ?map=<id> plays free-play on that map. Else siege board, first approved, else draft.
  const levelId = params.get('level');
  const wantedId = params.get('map') || (siege && siege.board && siege.board.mapId) || null;
  let map = null;

  if (levelId) {
    const lvlRes = await fetch(`/api/v1/levels/${levelId}`).then(r => r.json()).catch(() => null);
    if (lvlRes && lvlRes.success && lvlRes.level) {
      const level = lvlRes.level;
      state.levelId = level._id;
      state.level = { name: level.name, slug: level.slug, description: level.description };
      const detail = await fetch(`/api/v1/maps/${level.mapId}`).then(r => r.json()).catch(() => null);
      if (detail && detail.success) map = detail.map;
    }
  }

  if (!map && wantedId) {
    const detail = await fetch(`/api/v1/maps/${wantedId}`).then(r => r.json()).catch(() => null);
    if (detail && detail.success) map = detail.map;
  }
  if (!map) {
    const mapsRes = await fetch('/api/v1/maps?status=approved').then(r => r.json());
    let chosen = mapsRes.maps?.[0];
    if (!chosen) {
      const fallback = await fetch('/api/v1/maps?status=draft').then(r => r.json());
      chosen = fallback.maps?.[0];
    }
    if (!chosen) { showNoMapMessage(); return; }
    const detail = await fetch(`/api/v1/maps/${chosen._id}`).then(r => r.json());
    map = detail.map;
  }
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

  // scatter procedural terrain art (trees/rocks/mountains) once roles are set.
  // path/spawn/base tiles are left clear; 'blocked' tiles become mountains.
  sceneryRenderer.populate(tiles, { biome: map.biome || map.theme || 'desert' });

  for (const b of (map.baseHexes || [])) baseRenderer.add(b.q, b.r);
  // base centroid in world space — the enemies' attack point (for tactical bezier lines)
  {
    const bs = map.baseHexes || [];
    if (bs.length) {
      let sx = 0, sz = 0;
      for (const b of bs) { const w = axialToWorld(b.q, b.r); sx += w.x; sz += w.z; }
      window.__attackPoint = { x: sx / bs.length, z: sz / bs.length };
    } else window.__attackPoint = { x: 0, z: 0 };
  }

  await loadTowerPicker();
  await showLoadout(map._id, state.levelId || undefined);
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
      ${t.thumbnailUrl ? `<img class="tower-thumb" src="${t.thumbnailUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
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

function updateDeployHud(st) {
  const el = document.getElementById('hud-ammo');
  if (el) el.textContent = (st.ammo ?? 0) + ' ammo (arm ' + (st.armCost ?? 0) + ')';
  const mg = document.getElementById('mg-ammo');
  if (mg) mg.textContent = String(st.ammo ?? 0);
}

function updateLootHud(loot) {
  const el = document.getElementById("hud-loot");
  if (el) el.textContent = `${loot.ammo||0} ammo · ${loot.components||0} parts · ${loot.tokens||0} tokens`;
  const mg = document.getElementById("mg-loot");
  if (mg) mg.textContent = `${loot.ammo||0}|${loot.components||0}|${loot.tokens||0}`;
}

function showNoMapMessage() {
  const picker = $('hud-tower-picker');
  picker.innerHTML = '<em>No maps yet. <a href="/build/map">Build one</a> to play.</em>';
}

// ---- End-of-run overlay -------------------------------------------------
async function showEndScreen({ status, score, wave, durationMs }) {
  const overlay = $('td-endscreen');
  if (!overlay) return;
  const won = status === 'won';
  const level = state.level;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // When the run was won on a campaign level, see if a next level exists.
  let next = null;
  if (won && state.levelId) {
    const res = await fetch(`/api/v1/levels/${state.levelId}/next`).then(r => r.json()).catch(() => null);
    if (res && res.success && res.next) next = res.next;
  }

  const secs = durationMs != null ? Math.round(durationMs / 1000) : null;
  const banner = (level && level.slug)
    ? `<img class="es-banner" src="/assets/img/levels/${esc(level.slug)}.png" alt="" onerror="this.style.display='none'">`
    : '';
  const levelLine = level
    ? `<div class="es-level">${esc(level.name)}</div>` + (level.description ? `<div class="es-leveldesc">${esc(level.description)}</div>` : '')
    : '';

  let buttons = '';
  if (won && next) {
    buttons += `<button class="btn primary es-next" type="button">Next Level →</button>`;
  }
  buttons += `<button class="btn es-replay" type="button">${won ? 'Replay' : 'Retry'}</button>`;
  // A siege launched from a world returns there; free play goes to the lobby.
  const siege = state.siege;
  if (siege && siege.ret && siege.ret.url) {
    buttons += `<button class="btn es-return" type="button">Return to World</button>`;
  } else {
    buttons += `<button class="btn es-lobby" type="button">Back to Lobby</button>`;
  }

  overlay.innerHTML =
    `<div class="es-card ${won ? 'win' : 'lose'}">` +
      banner +
      `<div class="es-headline">${won ? 'VICTORY' : 'DEFEAT'}</div>` +
      levelLine +
      `<div class="es-stats">` +
        `<span class="es-stat"><b>${esc(score ?? 0)}</b>Score</span>` +
        `<span class="es-stat"><b>${wave != null ? esc(wave + 1) : '-'}</b>Wave</span>` +
        (secs != null ? `<span class="es-stat"><b>${secs}s</b>Time</span>` : '') +
      `</div>` +
      `<div class="es-actions">${buttons}</div>` +
    `</div>`;
  overlay.classList.add('open');

  const nextBtn = overlay.querySelector('.es-next');
  if (nextBtn) nextBtn.addEventListener('click', () => { location.href = `/play?level=${next._id}`; });
  overlay.querySelector('.es-replay').addEventListener('click', () => { location.reload(); });
  const lobbyBtn = overlay.querySelector('.es-lobby');
  if (lobbyBtn) lobbyBtn.addEventListener('click', () => { location.href = '/lobby'; });
  const returnBtn = overlay.querySelector('.es-return');
  if (returnBtn) returnBtn.addEventListener('click', () => {
    // Hand the outcome back to the world; it applies salvage / coins / map advance.
    const u = new URL(siege.ret.url);
    u.searchParams.set('siegeResult', status || 'abandoned');
    if (score != null) u.searchParams.set('score', String(score));
    if (wave != null) u.searchParams.set('wave', String(wave));
    u.searchParams.set('path', siege.origin && siege.origin.path ? siege.origin.path : '');
    location.href = u.toString();
  });

  // Focus the primary action for keyboard users.
  const focusBtn = overlay.querySelector('.es-next') || overlay.querySelector('.es-replay');
  if (focusBtn) focusBtn.focus();
}

// Raycast the tap against enemy model roots; returns the entity id or null.
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function pickEnemy(ev) {
  const rect = host.getBoundingClientRect();
  _ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1,
           -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  // build a list of enemy roots, remembering which id each belongs to
  const roots = [];
  for (const [id, ent] of enemyRenderer.entities.entries()) {
    if (ent.root) { ent.root.userData.__enemyId = id; roots.push(ent.root); }
  }
  const hits = _ray.intersectObjects(roots, true);
  if (!hits.length) return null;
  // walk up to the root that carries our id
  let o = hits[0].object;
  while (o && o.userData.__enemyId == null) o = o.parent;
  return o ? o.userData.__enemyId : null;
}

// ---- Tap-vs-drag input: tap = place tower / apply card; drag = camera -----
const TAP_MAX_PX = 8;
const TAP_MAX_MS = 350;
let pointerStart = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pointerStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!pointerStart || pointerStart.id !== e.pointerId) { pointerStart = null; return; }
  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  const dt = performance.now() - pointerStart.t;
  const dist = Math.hypot(dx, dy);
  pointerStart = null;
  if (dist > TAP_MAX_PX || dt > TAP_MAX_MS) return;

  // HUNT MODE (tactical pause): tap a unit on the board to expose the infiltrator.
  if (isHunting()) {
    const picked = pickEnemy(e);
    if (picked) { exposeEnemy(picked); return; }
    // tapped empty ground while hunting — ignore (don't place towers mid-hunt)
    return;
  }

  // Action-card apply mode takes precedence over placement.
  if (state.selectedActionCard && state.tiles && state.runId) {
    const ah = pickHex(e, host, camera, state.tiles);
    if (ah) {
      const ak = hexKey(ah.userData.q, ah.userData.r);
      const tId = state.towersByHex.get(ak);
      if (tId) { socket.emit('run:play-card', { runId: state.runId, instanceId: state.selectedActionCard.instanceId, towerId: tId }); clearActionSel(); }
      else toast('No tower there', 'bad');
    }
    return;
  }

  if (!state.selectedTowerDef || !state.tiles || !state.runId) return;
  const hex = pickHex(e, host, camera, state.tiles);
  if (!hex) return;
  const { q, r } = hex.userData;
  const k = hexKey(q, r);
  if (state.pathHexes.has(k) || state.spawnHexes.has(k) || state.baseHexes.has(k) || state.blockedHexes.has(k)) {
    log('cannot place on', state.tiles.get(k).userData.role);
    return;
  }
  socket.emit('run:place-tower', { runId: state.runId, towerId: state.selectedTowerDef._id, q, r });
});

renderer.domElement.addEventListener('pointercancel', () => { pointerStart = null; });

// ---- Animate + boot -----------------------------------------------------
animate(() => { projectileRenderer.update(); explosionRenderer.update(); muzzleRenderer.update(); sparkRenderer.update(); shockwaveRenderer.update(); enemyRenderer.update(); towerRenderer.update(); baseRenderer.update(); lootRenderer.update(); cameraShaker.update(); });

setHud('wave', '-');
setHud('health', '-');
setHud('currency', '-');
setHud('score', '0');

boot().catch(err => console.error('[td/play] boot failed:', err));
