/**
 * Renders a hex board into a Three.js scene.
 * Returns a Map<hexKey, mesh> so callers can recolor/highlight individual tiles.
 */
import * as THREE from 'three';
import { axialToWorld, generateHexBoard, hexKey } from './hex-grid.js';

const HEX_GEOMETRY = new THREE.CylinderGeometry(1, 1, 0.15, 6, 1, false);
HEX_GEOMETRY.rotateY(Math.PI / 6); // pointy-top

const ROLE_COLORS = {
  default: 0x223344,
  spawn: 0x66aaff,
  base: 0xff6644,
  path: 0x886622,
  blocked: 0x222222,
  hover: 0x99ddff,
  selected: 0xffcc33,
};

export function buildHexBoard(scene, { radius = 6 } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const tiles = new Map();

  for (const { q, r } of generateHexBoard(radius)) {
    const mat = new THREE.MeshStandardMaterial({
      color: ROLE_COLORS.default,
      roughness: 0.8,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(HEX_GEOMETRY, mat);
    const { x, z } = axialToWorld(q, r);
    mesh.position.set(x, 0, z);
    mesh.userData = { q, r, role: 'default' };
    group.add(mesh);
    tiles.set(hexKey(q, r), mesh);
  }

  return { group, tiles };
}

export function setTileRole(mesh, role) {
  if (!mesh) return;
  mesh.userData.role = role;
  mesh.material.color.setHex(ROLE_COLORS[role] || ROLE_COLORS.default);
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
