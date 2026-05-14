/**
 * Visual renderers for live game entities: enemies, towers, fire effects.
 * All driven by server events - this module owns NO game state, only meshes.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { axialToWorld, HEX } from './hex-grid.js';

const ENEMY_GEOMETRY = new THREE.SphereGeometry(0.25, 12, 8);

export class EnemyRenderer {
  constructor(scene) {
    this.scene = scene;
    this.entities = new Map(); // id -> { mesh, hpBar, hpMax }
  }

  spawn({ id, color = 0x88ff88, hpMax }) {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
    const mesh = new THREE.Mesh(ENEMY_GEOMETRY, mat);
    mesh.position.set(0, 0.4, 0);
    this.scene.add(mesh);
    this.entities.set(id, { mesh, hpMax });
  }

  // Server reports (q,r) as fractional axial coords.
  updatePosition(id, q, r, hp) {
    const entity = this.entities.get(id);
    if (!entity) return;
    const { x, z } = axialToWorld(q, r);
    entity.mesh.position.x = x;
    entity.mesh.position.z = z;
    entity.mesh.position.y = 0.4;
    if (hp !== undefined && entity.hpMax) {
      const ratio = Math.max(0, hp / entity.hpMax);
      // Tint redder as HP drops
      entity.mesh.material.color.setRGB(1 - ratio * 0.5, ratio * 0.8 + 0.1, ratio * 0.3);
    }
  }

  remove(id) {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.scene.remove(entity.mesh);
    entity.mesh.geometry.dispose?.();
    entity.mesh.material.dispose?.();
    this.entities.delete(id);
  }

  clear() {
    for (const id of this.entities.keys()) this.remove(id);
  }
}

const FALLBACK_TOWER_GEOMETRY = new THREE.CylinderGeometry(0.3, 0.45, 0.8, 8);
const TOWER_PLATFORM_GEOMETRY = new THREE.CylinderGeometry(0.55, 0.55, 0.05, 6);

export class TowerRenderer {
  constructor(scene) {
    this.scene = scene;
    this.gltfLoader = new GLTFLoader();
    this.entities = new Map(); // id -> { group, modelLoaded }
  }

  place({ id, gltfUrl, q, r }) {
    const group = new THREE.Group();
    const { x, z } = axialToWorld(q, r);
    group.position.set(x, HEX.TOWER_Y, z);
    this.scene.add(group);

    // Base platform always shown
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x444466, metalness: 0.3 });
    const platform = new THREE.Mesh(TOWER_PLATFORM_GEOMETRY, platformMat);
    platform.position.y = 0.025;
    group.add(platform);

    // Fallback tower body until GLTF arrives
    const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xaaccff, emissive: 0x224466, emissiveIntensity: 0.3 });
    const fallback = new THREE.Mesh(FALLBACK_TOWER_GEOMETRY, fallbackMat);
    fallback.position.y = 0.45;
    group.add(fallback);

    const entity = { group, fallback, modelLoaded: false };
    this.entities.set(id, entity);

    if (gltfUrl) {
      this.gltfLoader.load(gltfUrl, (gltf) => {
        group.remove(fallback);
        gltf.scene.position.y = 0.05;
        group.add(gltf.scene);
        entity.modelLoaded = true;
      }, undefined, (err) => {
        console.warn(`[towers] GLTF load failed for ${id}, keeping fallback`, err);
      });
    }
  }

  fire(id) {
    const entity = this.entities.get(id);
    if (!entity) return;
    // Quick scale pulse as muzzle flash
    entity.group.scale.set(1.15, 1.15, 1.15);
    setTimeout(() => entity.group.scale.set(1, 1, 1), 80);
  }

  remove(id) {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.scene.remove(entity.group);
    this.entities.delete(id);
  }

  clear() {
    for (const id of this.entities.keys()) this.remove(id);
  }
}

/**
 * Brief tracer line from tower to enemy when a shot fires.
 */
export class TracerRenderer {
  constructor(scene) {
    this.scene = scene;
    this.tracers = []; // { line, expireAt }
  }

  fire(fromVec3, toVec3, color = 0xffcc66) {
    const geo = new THREE.BufferGeometry().setFromPoints([fromVec3, toVec3]);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, expireAt: performance.now() + 120 });
  }

  update() {
    const now = performance.now();
    this.tracers = this.tracers.filter(t => {
      if (now > t.expireAt) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        return false;
      }
      const remaining = (t.expireAt - now) / 120;
      t.line.material.opacity = remaining * 0.9;
      return true;
    });
  }
}
