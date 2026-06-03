/**
 * Lobby conflict map — a 3D hex "war map" that visualizes the campaign levels as
 * contested theaters. Each level is a beacon planted on the hex grid, tinted by
 * threat (green = early, red = hard), linked by a glowing campaign path. Tapping a
 * beacon dives the camera into that theater and drops the player into the siege
 * (`/play?level=<id>`).
 *
 * Reuses the in-game scene + hex math so the lobby map and the battle board share
 * one visual language. Degrades gracefully: if there are no levels or WebGL is
 * unavailable, the whole panel just stays hidden.
 */
import * as THREE from 'three';
import { createScene } from '../three/scene.js';
import { buildHexBoard } from '../three/hex-board.js';
import { HEX, axialToWorld, worldToAxial, hexKey } from '../three/hex-grid.js';

const S = HEX.SIZE;

/* ----------------------------- soft sprite textures ----------------------------- */
function glowTexture() {
  const size = 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// circular numbered badge sprite (the level order)
function badgeTexture(num, hexColor) {
  const size = 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,12,22,0.92)'; ctx.fill();
  ctx.lineWidth = 7; ctx.strokeStyle = hexColor; ctx.stroke();
  ctx.fillStyle = hexColor; ctx.font = 'bold 70px JetBrains Mono, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(num), size / 2, size / 2 + 4);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// threat colour: green (easy) -> red (hard)
function threatColor(t) { return new THREE.Color().setHSL(0.34 * (1 - t), 0.9, 0.55); }

export function initConflictMap() {
  const host = document.getElementById('conflict-map-host');
  const panel = document.getElementById('panel-warmap');
  if (!host || !panel) return;

  const api = (p) => fetch(p).then((r) => r.json()).catch(() => null);

  api('/api/v1/levels?status=approved').then((res) => {
    const levels = (res && res.levels) || [];
    if (!levels.length) return;                 // nothing to show — leave hidden
    panel.style.display = '';
    try { build(host, levels); }
    catch (e) { console.warn('[warmap] failed to build, hiding', e); panel.style.display = 'none'; }
  });
}

function build(host, levels) {
  const tip = document.getElementById('warmap-tip');
  const dive = document.getElementById('warmap-dive');
  const halo = glowTexture();

  const { scene, camera, renderer, controls, animate } = createScene(host, {
    sky: false, ground: false, bg: 0x05080f,
  });
  // a calmer strategic vantage than the battle camera
  camera.position.set(0, 17 * S, 16 * S);
  controls.minDistance = 8 * S;
  controls.maxDistance = 40 * S;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  scene.add(new THREE.AmbientLight(0x99bbff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(6, 14, 8); scene.add(key);

  // dim hex terrain backdrop
  const radius = Math.max(4, Math.min(7, 3 + Math.ceil(levels.length / 2)));
  const { tiles } = buildHexBoard(scene, { radius });
  for (const mesh of tiles.values()) {
    mesh.material.color.setHex(0x12203a);
    mesh.material.opacity = 0.22;
  }

  // ---- lay the levels out along a gentle serpentine, snapped to hex centers ----
  const n = levels.length;
  const span = Math.min(radius * 1.5, 6) * S;
  const nodes = [];
  const used = new Set();
  levels.forEach((lvl, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    let wx = (t - 0.5) * 2 * span;
    let wz = Math.sin(t * Math.PI * 1.25) * 2.4 * S;
    const ax = worldToAxial(wx, wz);
    let k = hexKey(ax.q, ax.r);
    // nudge if two levels snap to the same hex
    let bump = 1;
    while (used.has(k)) { const a2 = worldToAxial(wx + bump * S, wz); ax.q = a2.q; ax.r = a2.r; k = hexKey(ax.q, ax.r); bump++; }
    used.add(k);
    const { x, z } = axialToWorld(ax.q, ax.r);
    const threat = threatColor(t);
    const marker = buildMarker(threat, i + 1, halo);
    marker.position.set(x, 0.06 * S, z);
    // merge (buildMarker already populated userData with core/ring/glow/badge refs)
    Object.assign(marker.userData, { levelId: lvl._id, level: lvl, order: lvl.order || i + 1, base: marker.scale.x });
    scene.add(marker);
    nodes.push(marker);
    // light up the conflict tile
    const tile = tiles.get(k);
    if (tile) { tile.material.color.copy(threat); tile.material.opacity = 0.5; }
  });

  // ---- campaign path: a glowing line threading the beacons in order ----
  if (nodes.length > 1) {
    const pts = nodes.map((m) => new THREE.Vector3(m.position.x, 0.12 * S, m.position.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x66e0ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
    }));
    scene.add(line);
  }

  // ---- interaction: hover tooltip + tap-to-dive (tap vs drag like the game) ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null;
  let diving = null;            // { node, t } when a dive is in progress
  let down = null;

  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(nodes, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.levelId) o = o.parent;
    return o || null;
  }

  function showTip(node, ev) {
    const rect = host.getBoundingClientRect();
    const lvl = node.userData.level;
    tip.innerHTML = `<span class="wm-badge">Theater ${node.userData.order}</span><strong>${escapeHtml(lvl.name || 'Mission')}</strong>` +
      (lvl.description ? `${escapeHtml(String(lvl.description).slice(0, 120))}` : '') +
      `<span class="wm-cta">Tap to deploy ▸</span>`;
    tip.style.left = (ev.clientX - rect.left) + 'px';
    tip.style.top = (ev.clientY - rect.top) + 'px';
    tip.hidden = false;
  }

  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (diving) return;
    const node = pick(ev);
    if (node !== hovered) {
      if (hovered) hovered.userData.hot = false;
      hovered = node;
      host.style.cursor = node ? 'pointer' : '';
      if (!node) tip.hidden = true;
    }
    if (node) { node.userData.hot = true; showTip(node, ev); }
  });
  renderer.domElement.addEventListener('pointerleave', () => { if (hovered) hovered.userData.hot = false; hovered = null; tip.hidden = true; });

  renderer.domElement.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 10 || dt > 500 || diving) return;     // that was a drag, not a tap
    const node = pick(ev);
    if (node) startDive(node);
  });

  function startDive(node) {
    diving = { node, t: 0, from: camera.position.clone(), fromTarget: controls.target.clone() };
    controls.enabled = false;
    controls.autoRotate = false;
    tip.hidden = true;
    host.style.cursor = '';
  }

  // ---- per-frame animation ----
  let clock = 0;
  animate(() => {
    clock += 0.016;
    for (const m of nodes) {
      const u = m.userData;
      u.core.rotation.y = clock * 1.1;
      const pulse = 0.5 + 0.5 * Math.sin(clock * 3 + u.order);
      u.ring.scale.setScalar(1 + pulse * 0.25);
      u.ringMat.opacity = 0.35 + pulse * 0.4;
      u.glow.material.opacity = 0.5 + pulse * 0.35;
      // hover grow
      const want = u.hot ? u.base * 1.35 : u.base;
      m.scale.lerp(new THREE.Vector3(want, want, want), 0.2);
      u.badge.material.rotation = 0;          // keep badge upright (sprite billboards already)
    }
    if (diving) {
      diving.t = Math.min(1, diving.t + 0.016 / 0.9);    // ~0.9s dive
      const e = diving.t * diving.t * (3 - 2 * diving.t); // smoothstep
      const node = diving.node;
      const target = new THREE.Vector3(node.position.x, 1.2 * S, node.position.z);
      const camTo = new THREE.Vector3(node.position.x, 4.5 * S, node.position.z + 4.5 * S);
      camera.position.lerpVectors(diving.from, camTo, e);
      controls.target.lerpVectors(diving.fromTarget, target, e);
      camera.lookAt(controls.target);
      dive.style.opacity = String(e);
      if (diving.t >= 1) {
        window.location.href = '/play?level=' + encodeURIComponent(node.userData.levelId);
        diving.done = true; diving.t = 1;
      }
    }
  });
}

// A conflict beacon: hex pedestal + pylon + spinning core + pulsing ground ring +
// soft glow + a floating numbered badge. Tinted by threat colour.
function buildMarker(color, order, halo) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x131a2a, roughness: 0.7, metalness: 0.5 });
  const emiss = new THREE.MeshStandardMaterial({ color: 0x0e1b24, emissive: color.clone(), emissiveIntensity: 1.1, metalness: 0.4, roughness: 0.3 });

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * S, 0.6 * S, 0.18 * S, 6), dark);
  pedestal.position.y = 0.09 * S; pedestal.rotation.y = Math.PI / 6; g.add(pedestal);

  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * S, 0.1 * S, 0.7 * S, 6), emiss);
  pylon.position.y = 0.5 * S; g.add(pylon);

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22 * S), emiss);
  core.position.y = 0.95 * S; g.add(core);

  const ringMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55 * S, 0.72 * S, 24), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04 * S; g.add(ring);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: color.clone(), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(2.2 * S); glow.position.y = 0.95 * S; g.add(glow);

  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(order, '#' + color.getHexString()), transparent: true, depthWrite: false, depthTest: false }));
  badge.scale.setScalar(0.7 * S); badge.position.y = 1.7 * S; badge.renderOrder = 999; g.add(badge);

  g.userData = {};
  Object.assign(g.userData, { core, ring, ringMat, glow, badge });
  return g;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

initConflictMap();
