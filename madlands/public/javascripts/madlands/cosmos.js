/**
 * cosmos.js — categorical 3D object factory for the Madlands scale ladder.
 *
 * makeObject(type, opts) -> THREE.Group for a category (galaxy, star, blackhole,
 * planet, station, blockade, ship, poi, room, prop). Procedural primitives render
 * immediately; if a Blender-authored model exists at MODEL_PATHS[type] it loads
 * async and replaces the placeholder. So the world is populated NOW and upgrades
 * to real meshes the moment the Blender MCP drops a .glb in /assets/models/cosmos/.
 *
 * Each group carries userData.update(t) for the host animate loop (spin/pulse).
 * Black holes are intentionally buildable but the world hides them until a future
 * release (see scales.js `hidden`); the builder exists so that release is a flip.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Where Blender-authored models land (one per category). Missing -> procedural.
const MODEL_PATHS = {
  galaxy: '/assets/models/cosmos/galaxy.glb',
  star: '/assets/models/cosmos/star.glb',
  blackhole: '/assets/models/cosmos/blackhole.glb',
  planet: '/assets/models/cosmos/planet.glb',
  station: '/assets/models/cosmos/station.glb',
  blockade: '/assets/models/cosmos/blockade.glb',
  ship: '/assets/models/cosmos/ship.glb',
  poi: '/assets/models/cosmos/poi.glb',
  room: '/assets/models/cosmos/room.glb',
};

const _gltf = new GLTFLoader();
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  _glowTex = new THREE.CanvasTexture(cv); if ('colorSpace' in _glowTex) _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
function glow(color, size) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.setScalar(size); return sp;
}
function emissive(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color: opts.base ?? 0x0e1322, emissive: color, emissiveIntensity: opts.intensity ?? 1.0, metalness: opts.metalness ?? 0.5, roughness: opts.roughness ?? 0.4 });
}

function tryModel(type, group, scale) {
  const url = MODEL_PATHS[type];
  if (!url) return;
  _gltf.load(url, (g) => {
    const m = g.scene; m.scale.setScalar(scale || 1);
    group.add(m);
    // hide the procedural placeholder children (keep the loaded model + any sprite glow)
    for (const c of [...group.children]) if (c !== m && c.userData && c.userData.placeholder) c.visible = false;
  }, undefined, () => { /* no model — keep procedural */ });
}

// ---- category builders -----------------------------------------------------

function buildGalaxy(c) {
  const g = new THREE.Group();
  const core = glow(0xfff2c0, 1.6); g.add(core);
  const arms = new THREE.Group(); arms.userData.placeholder = true;
  const mat = emissive(0x6cc8ff, { intensity: 1.4, base: 0x05060f });
  const N = 120;
  for (let i = 0; i < N; i++) {
    const t = i / N, ang = t * Math.PI * 6, rad = 0.25 + t * 1.7;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03 + Math.random() * 0.03, 6, 6), mat);
    dot.position.set(Math.cos(ang) * rad, (Math.random() - 0.5) * 0.12, Math.sin(ang) * rad);
    arms.add(dot);
  }
  arms.rotation.x = -Math.PI * 0.32; g.add(arms);
  g.userData.update = (t) => { arms.rotation.z = t * 0.15; core.material.opacity = 0.7 + 0.2 * Math.sin(t * 1.5); };
  tryModel('galaxy', g, 1);
  return g;
}

function buildStar(c) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), emissive(c || 0xffcf6a, { intensity: 1.6, base: 0x1a1000 }));
  body.userData.placeholder = true; g.add(body);
  const halo = glow(c || 0xffd27a, 2.4); g.add(halo);
  g.userData.update = (t) => { halo.material.opacity = 0.65 + 0.25 * Math.sin(t * 2 + 1); body.rotation.y = t * 0.3; };
  tryModel('star', g, 1);
  return g;
}

function buildBlackhole() {
  const g = new THREE.Group();
  const hole = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  hole.userData.placeholder = true; g.add(hole);
  const disc = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.18, 12, 48), emissive(0xb06cff, { intensity: 1.8, base: 0x100018 }));
  disc.rotation.x = Math.PI * 0.5; disc.userData.placeholder = true; g.add(disc);
  g.userData.update = (t) => { disc.rotation.z = t * 0.6; };
  tryModel('blackhole', g, 1);
  return g;
}

function buildPlanet(c) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 28, 22), new THREE.MeshStandardMaterial({ color: c || 0x5a86c8, roughness: 0.85, metalness: 0.1, emissive: 0x0a1428, emissiveIntensity: 0.5 }));
  body.userData.placeholder = true; g.add(body);
  if (Math.random() < 0.4) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 10, 40), emissive(0xa3caff, { intensity: 0.8 })); ring.rotation.x = Math.PI * 0.5 + 0.3; ring.userData.placeholder = true; g.add(ring); }
  g.userData.update = (t) => { body.rotation.y = t * 0.18; };
  tryModel('planet', g, 1);
  return g;
}

function buildStation() {
  const g = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), emissive(0x6cc8ff, { intensity: 1.2 })); hub.userData.placeholder = true; g.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 10, 32), emissive(0x9ad0ff, { intensity: 0.9 })); ring.userData.placeholder = true; g.add(ring);
  for (let i = 0; i < 3; i++) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), emissive(0x7d6c90, { intensity: 0.5, base: 0x20283a })); arm.rotation.y = (i / 3) * Math.PI * 2; arm.userData.placeholder = true; g.add(arm); }
  g.userData.update = (t) => { ring.rotation.z = t * 0.4; hub.rotation.y = t * 0.6; };
  tryModel('station', g, 1);
  return g;
}

function buildShip(c) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), emissive(c || 0xff7a4a, { intensity: 0.9, base: 0x241018 }));
  hull.rotation.x = Math.PI * 0.5; hull.userData.placeholder = true; g.add(hull);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.22), emissive(0xffb24a, { intensity: 0.6 })); fin.position.z = -0.2; fin.userData.placeholder = true; g.add(fin);
  g.userData.update = (t) => { g.position.y = (g.userData.y0 || 0) + Math.sin(t * 1.5 + (g.userData.phase || 0)) * 0.08; };
  tryModel('ship', g, 1);
  return g;
}

function buildBlockade() {
  const g = new THREE.Group(); g.userData.placeholder = true;
  for (let i = 0; i < 4; i++) { const s = buildShip(0xff4a6a); s.position.x = (i - 1.5) * 0.5; s.scale.setScalar(0.7); g.add(s); }
  g.userData.update = (t) => { for (const s of g.children) s.userData.update && s.userData.update(t); g.rotation.y = Math.sin(t * 0.3) * 0.15; };
  return g;
}

function buildPoi() {
  const g = new THREE.Group();
  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.7, 6), emissive(0xffd24a, { intensity: 1.0 })); pylon.position.y = 0.35; pylon.userData.placeholder = true; g.add(pylon);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.4, 24), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.userData.placeholder = true; g.add(ring);
  g.userData.update = (t) => { ring.scale.setScalar(1 + 0.2 * Math.sin(t * 3)); pylon.rotation.y = t; };
  tryModel('poi', g, 1);
  return g;
}

function buildRoom() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), emissive(0x6cc8ff, { intensity: 0.4, base: 0x1a2030 })); box.position.y = 0.25; box.userData.placeholder = true; g.add(box);
  tryModel('room', g, 1);
  return g;
}

const BUILDERS = {
  galaxy: buildGalaxy, star: buildStar, blackhole: buildBlackhole, planet: buildPlanet,
  station: buildStation, blockade: buildBlockade, ship: buildShip, poi: buildPoi, room: buildRoom,
};

/**
 * Build a categorical object. opts: { color, scale }. Returns a THREE.Group with
 * a userData.update(t) hook for the host animate loop.
 */
export function makeObject(type, opts = {}) {
  const fn = BUILDERS[type] || buildPoi;
  const g = fn(opts.color);
  if (opts.scale) g.scale.setScalar(opts.scale);
  g.userData.type = type;
  return g;
}

export const COSMOS_TYPES = Object.keys(BUILDERS);
export { MODEL_PATHS };
