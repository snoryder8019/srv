/**
 * Renders a hex board into a Three.js scene.
 * Returns a Map<hexKey, mesh> so callers can recolor/highlight individual tiles.
 *
 * Tiles are semi-transparent so attacking units read clearly against the board
 * (opaque tiles were blending with the unit colors). Each tile also gets a thin
 * wireframe rim so the grid stays legible even at low fill opacity.
 */
import * as THREE from 'three';
import { axialToWorld, generateHexBoard, hexKey, HEX } from './hex-grid.js';

const HEX_GEOMETRY = new THREE.CylinderGeometry(HEX.SIZE, HEX.SIZE, 0.12 * HEX.SIZE, 6, 1, false);
HEX_GEOMETRY.rotateY(Math.PI / 6); // pointy-top

// rim outline geometry (hex edge), reused for every tile
const RIM_GEOMETRY = new THREE.EdgesGeometry(HEX_GEOMETRY);

const ROLE_COLORS = {
  default: 0x2a3b52,
  spawn: 0x66aaff,
  base: 0xff6644,
  path: 0x3a4a66,
  blocked: 0x161a22,
  hover: 0x99ddff,
  selected: 0xffcc33,
};

// per-role fill opacity (transparent board; units pop against it)
const ROLE_OPACITY = {
  default: 0.26,
  spawn: 0.5,
  base: 0.6,
  path: 0.34,
  blocked: 0.7,
  hover: 0.6,
  selected: 0.7,
};

function makeTileMaterial(role = 'default') {
  return new THREE.MeshStandardMaterial({
    color: ROLE_COLORS[role] || ROLE_COLORS.default,
    roughness: 0.75,
    metalness: 0.1,
    transparent: true,
    opacity: ROLE_OPACITY[role] ?? ROLE_OPACITY.default,
    depthWrite: false,          // don't occlude units/effects behind the glassy tiles
  });
}

export function buildHexBoard(scene, { radius = 6 } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const tiles = new Map();

  for (const { q, r } of generateHexBoard(radius)) {
    const mesh = new THREE.Mesh(HEX_GEOMETRY, makeTileMaterial('default'));
    const { x, z } = axialToWorld(q, r);
    mesh.position.set(x, 0, z);
    mesh.userData = { q, r, role: 'default' };

    // thin rim so the grid reads even when the fill is faint
    const rim = new THREE.LineSegments(
      RIM_GEOMETRY,
      new THREE.LineBasicMaterial({ color: 0x5a7799, transparent: true, opacity: 0.35 })
    );
    mesh.add(rim);
    mesh.userData.rim = rim;

    group.add(mesh);
    tiles.set(hexKey(q, r), mesh);
  }

  return { group, tiles };
}

export function setTileRole(mesh, role) {
  if (!mesh) return;
  mesh.userData.role = role;
  mesh.material.color.setHex(ROLE_COLORS[role] || ROLE_COLORS.default);
  mesh.material.opacity = ROLE_OPACITY[role] ?? ROLE_OPACITY.default;
}

export function pickHex(event, host, camera, tiles) {
  const rect = host.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const meshes = Array.from(tiles.values());
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? hits[0].object : null;
}

export { ROLE_COLORS };
