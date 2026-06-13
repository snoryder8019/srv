/** TowerRenderer - places equipment (GLTF towers) with bounding-box auto-fit
 *  plus a floating status meter (charge/ready bar) billboarded above each tower.
 *  Towers yaw to face fire() targets, kick back on recoil, and expose a muzzle
 *  anchor in world space for flashes/projectiles. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { axialToWorld } from '../hex-grid.js';
import { S, TILE_TOP } from './shared.js';

/* ----------------------------- towers ----------------------------- */

const FALLBACK_TOWER_GEOMETRY = new THREE.CylinderGeometry(0.3 * S, 0.45 * S, 0.8 * S, 8);
const FALLBACK_BARREL_GEOMETRY = new THREE.CylinderGeometry(0.09 * S, 0.11 * S, 0.7 * S, 10);
const TOWER_PLATFORM_GEOMETRY = new THREE.CylinderGeometry(0.55 * S, 0.55 * S, 0.05 * S, 6);
const TOWER_RING_GEOMETRY = new THREE.TorusGeometry(0.5 * S, 0.04 * S, 6, 24);
const TOWER_FIT_FOOTPRINT = 1.3 * S;
const TOWER_SEAT_Y = 0.05 * S;
const BAR_Y = 1.5 * S;               // height of the status bar above the tile
const RECOIL_TAU = 0.05;             // recoil spring-back time constant (~120ms settle)
const AIM_LERP = 9;                  // yaw tracking responsiveness (per second)
const MUZZLE_Y = 0.6 * S;            // muzzle height above the group origin
const MUZZLE_FWD = 0.4 * S;          // forward offset along aim direction

// Shared platform ring material - a subtle emissive energy band on the base.
const PLATFORM_RING_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x224a66, emissive: 0x3399cc, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.4,
});

function noCull(root) {
  root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
  return root;
}

function fitTowerModel(model, multiplier = 1) {
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const footprint = Math.max(size.x, size.z) || 1;
  const s = (TOWER_FIT_FOOTPRINT / footprint) * (multiplier || 1);
  model.scale.setScalar(s);
  model.position.x = -center.x * s;
  model.position.z = -center.z * s;
  model.position.y = TOWER_SEAT_Y - box.min.y * s;
  return s;
}

// Build a small billboarded status bar: a dark backing quad + a colored fill quad.
// We scale the fill on X (anchored left) to represent 0..1.
function buildStatusBar() {
  const grp = new THREE.Group();
  const W = 1.1 * S, H = 0.16 * S;
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color: 0x0a0f17, transparent: true, opacity: 0.85, depthTest: false })
  );
  back.renderOrder = 998;
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.06, H * 1.35),
    new THREE.MeshBasicMaterial({ color: 0x33ddff, transparent: true, opacity: 0.18, depthTest: false })
  );
  frame.renderOrder = 997;
  frame.position.z = -0.001;
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H * 0.7),
    new THREE.MeshBasicMaterial({ color: 0x33ddff, transparent: true, depthTest: false })
  );
  fill.renderOrder = 999;
  fill.position.z = 0.001;
  grp.add(frame); grp.add(back); grp.add(fill);
  grp.position.y = BAR_Y;
  grp.userData = { fill, frame, W };
  return grp;
}

export class TowerRenderer {
  constructor(scene) {
    this.scene = scene;
    this.gltfLoader = new GLTFLoader();
    this.entities = new Map();
    this._camera = null;             // set by setCamera() so bars can billboard
  }

  setCamera(cam) { this._camera = cam; }

  place({ id, gltfUrl, q, r, scale = 1 }) {
    const group = new THREE.Group();
    const { x, z } = axialToWorld(q, r);
    group.position.set(x, TILE_TOP, z);
    this.scene.add(group);

    const platformMat = new THREE.MeshStandardMaterial({ color: 0x3a3a55, metalness: 0.5, roughness: 0.55 });
    const platform = new THREE.Mesh(TOWER_PLATFORM_GEOMETRY, platformMat);
    platform.position.y = 0.025 * S;
    group.add(platform);

    // glowing energy ring around the platform rim (pulses with charge in update)
    const ring = new THREE.Mesh(TOWER_RING_GEOMETRY, PLATFORM_RING_MATERIAL.clone());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06 * S;
    group.add(ring);

    // aim pivot - everything that yaws to face targets goes under here so the
    // billboarded status bar (added to group directly) stays camera-facing.
    const aim = new THREE.Group();
    group.add(aim);

    const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xaaccff, emissive: 0x224466, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.5 });
    const fallback = new THREE.Mesh(FALLBACK_TOWER_GEOMETRY, fallbackMat);
    fallback.position.y = 0.45 * S;
    aim.add(fallback);

    // a cleaner barrel so GLTF-less towers read as emplacements; points -Z (aim fwd)
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x556677, metalness: 0.7, roughness: 0.35 });
    const barrel = new THREE.Mesh(FALLBACK_BARREL_GEOMETRY, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.55 * S, -0.35 * S);
    fallback.add(barrel);

    // floating status meter (charge/ready). Starts full = ready to fire.
    const bar = buildStatusBar();
    group.add(bar);

    const entity = {
      group, aim, fallback, ring, bar,
      modelLoaded: false, charge: 1,
      yaw: 0, targetYaw: 0,            // current + desired horizontal facing
      recoil: 0,                       // 0..1 kick amount, decays in update()
      _disposables: [platformMat, ring.material, fallbackMat, barrelMat],
    };
    this.entities.set(id, entity);

    if (gltfUrl) {
      this.gltfLoader.load(gltfUrl, (gltf) => {
        noCull(gltf.scene);
        fitTowerModel(gltf.scene, scale);
        aim.remove(fallback);
        aim.add(gltf.scene);
        entity.model = gltf.scene;
        entity.modelLoaded = true;
      }, undefined, (err) => {
        console.warn(`[towers] GLTF load failed for ${id}, keeping fallback`, err);
      });
    }
  }

  // Set a tower's status bar fill 0..1 and tint it (green ready -> amber charging).
  setCharge(id, v) {
    const e = this.entities.get(id);
    if (!e || !e.bar) return;
    v = Math.max(0, Math.min(1, v));
    e.charge = v;
    const fill = e.bar.userData.fill;
    fill.scale.x = v <= 0 ? 0.0001 : v;
    fill.position.x = -e.bar.userData.W * (1 - v) / 2;   // anchor left
    const c = v >= 0.999 ? 0x66ff99 : (v > 0.4 ? 0x33ddff : 0xffcc33);
    fill.material.color.setHex(c);
  }

  // Fire: scale-punch + recoil kick. If targetWorldVec3 is supplied, also yaw the
  // model to face it (tracked smoothly in update()). Back-compat: fire(id) alone
  // keeps the legacy behavior (no aim change).
  fire(id, targetWorldVec3 = null) {
    const entity = this.entities.get(id);
    if (!entity) return;
    if (targetWorldVec3) {
      const g = entity.group.position;
      const dx = targetWorldVec3.x - g.x, dz = targetWorldVec3.z - g.z;
      if (dx * dx + dz * dz > 1e-6) entity.targetYaw = Math.atan2(dx, -dz); // barrel faces -Z
    }
    entity.recoil = 1;
    entity.group.scale.set(1.12, 1.12, 1.12);
    setTimeout(() => entity.group.scale.set(1, 1, 1), 80);
    // drain the meter on fire; it refills via update() as the cooldown passes
    this.setCharge(id, 0);
  }

  // World-space muzzle tip: group origin + up + forward along the current aim.
  // Returns null for unknown ids. Orchestrator spawns flashes/projectiles here.
  muzzleWorld(id) {
    const e = this.entities.get(id);
    if (!e) return null;
    const yaw = e.yaw;
    return new THREE.Vector3(
      e.group.position.x + Math.sin(yaw) * MUZZLE_FWD,
      e.group.position.y + MUZZLE_Y,
      e.group.position.z - Math.cos(yaw) * MUZZLE_FWD,
    );
  }

  // Per-frame: billboard bars, refill charge, track yaw, decay recoil, pulse ring.
  update(dt = 0.016) {
    const k = Math.min(1, dt * AIM_LERP);
    for (const [id, e] of this.entities.entries()) {
      if (e.bar && this._camera) e.bar.quaternion.copy(this._camera.quaternion);
      if (e.charge < 1) this.setCharge(id, Math.min(1, e.charge + dt * 1.4));

      // smooth yaw toward target (shortest angular path)
      if (e.aim) {
        let d = e.targetYaw - e.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        e.yaw += d * k;
        e.aim.rotation.y = e.yaw;

        // recoil: a backward(+Z local) + down nudge, springing back to rest
        if (e.recoil > 0.001) {
          e.recoil = Math.max(0, e.recoil - dt / RECOIL_TAU);
          e.aim.position.z = 0.18 * S * e.recoil;
          e.aim.position.y = -0.05 * S * e.recoil;
        } else if (e.aim.position.z !== 0 || e.aim.position.y !== 0) {
          e.recoil = 0; e.aim.position.set(0, 0, 0);
        }
      }

      // ring glows brighter as the tower nears ready
      if (e.ring) e.ring.material.emissiveIntensity = 0.25 + 0.75 * e.charge;
    }
  }

  remove(id) {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.scene.remove(entity.group);
    // dispose per-entity materials we cloned/allocated (shared geometries persist)
    for (const m of entity._disposables || []) m.dispose && m.dispose();
    if (entity.bar) entity.bar.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    if (entity.model) entity.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) { o.geometry && o.geometry.dispose(); }
    });
    this.entities.delete(id);
  }

  clear() { for (const id of [...this.entities.keys()]) this.remove(id); }
}
