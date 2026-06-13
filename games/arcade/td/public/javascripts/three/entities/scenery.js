/**
 * SceneryRenderer - procedural low-poly environment art for the hex board.
 *
 * Decorates tiles by role so the board isn't a bare grid:
 *   'blocked'  -> mountain / rock-pile peaks (read clearly as impassable)
 *   'default'  -> scattered props (cacti/trees/rocks/shrubs) on a deterministic
 *                 density-controlled subset; some tiles left clear for towers
 *   'path'/'spawn'/'base' -> nothing (gameplay clarity - lanes/objectives clean)
 *
 * All placement is DETERMINISTIC (hash of q,r,seed - no Math.random) so the
 * board is identical every load and doesn't flicker on rebuild. Repeated props
 * use THREE.InstancedMesh (one per geometry+material) to keep draw calls tiny.
 * Everything sits at ~TILE_TOP, casts no shadows, uses MeshStandard materials.
 */
import * as THREE from 'three';
import { S, TILE_TOP } from './shared.js';
import { HEX, axialToWorld, hexKey } from '../hex-grid.js';

/* ----------------------------- determinism ----------------------------- */
// frac(sin(...)*k) hash -> stable pseudo-random in [0,1) per (q,r,seed,salt)
function hash01(q, r, seed, salt = 0) {
  const h = Math.sin(q * 127.1 + r * 311.7 + seed * 53.3 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/* ----------------------------- biome palettes ----------------------------- */
// density: 0..1 multiplier baked into the per-biome base fill chance.
const BIOMES = {
  desert: {
    fill: 0.35,                 // sparse, arid
    trunk: 0x6b8f3a,            // cactus green (used as "trunk"/column)
    foliage: 0x4e7d2f,          // cactus arm green
    rock: 0xc2a578,             // sandstone
    mountain: 0xb89668,         // sandy stone peaks
    prop: 'cactus',
  },
  forest: {
    fill: 0.7,                  // dense
    trunk: 0x5a3b22,            // bark
    foliage: 0x2f6d34,          // conifer green
    rock: 0x5a6b58,             // mossy grey-green
    mountain: 0x4d5a4a,
    prop: 'tree',
  },
  mountain: {
    fill: 0.4,
    trunk: 0x4a3826,
    foliage: 0x35583a,          // sparse dark pine
    rock: 0x8a8d92,             // grey rock
    mountain: 0x7c7f86,
    prop: 'pine',
  },
  tundra: {
    fill: 0.45,
    trunk: 0x6e6256,            // pale dead wood
    foliage: 0xcdd6dc,          // snow-dusted
    rock: 0xa9b1b6,             // pale rock
    mountain: 0x9aa3a9,
    prop: 'deadtree',
  },
};

/* ----------------------------- renderer ----------------------------- */

export class SceneryRenderer {
  constructor(scene) {
    this.scene = scene;
    this.meshes = [];       // every InstancedMesh / Mesh added to the scene
    this.geometries = [];   // owned geometries to dispose
    this.materials = [];    // owned materials to dispose
  }

  _track(mesh) { this.scene.add(mesh); this.meshes.push(mesh); }
  _geo(g) { this.geometries.push(g); return g; }
  _mat(m) { this.materials.push(m); return m; }

  /**
   * @param {Map<string,THREE.Mesh>} tiles  hexKey -> tile mesh (userData {q,r,role})
   * @param {{biome?:string, density?:number, seed?:number}} opts
   */
  populate(tiles, opts = {}) {
    this.clear();
    if (!tiles) return;

    const biome = BIOMES[opts.biome] ? opts.biome : 'desert';
    const B = BIOMES[biome];
    const density = opts.density == null ? 0.5 : Math.max(0, Math.min(1, opts.density));
    const seed = opts.seed == null ? 1 : opts.seed;

    // ---- shared geometries (built once, reused across instances) ----
    const trunkGeo = this._geo(new THREE.CylinderGeometry(0.07 * S, 0.1 * S, 0.5 * S, 6));
    trunkGeo.translate(0, 0.25 * S, 0); // base at y=0
    const foliageGeo = this._geo(this._foliageGeometry(biome));
    const rockGeo = this._geo(new THREE.IcosahedronGeometry(0.18 * S, 0));
    rockGeo.translate(0, 0.12 * S, 0);
    const mtnGeo = this._geo(new THREE.ConeGeometry(0.5 * S, 0.95 * S, 5, 1));
    mtnGeo.translate(0, 0.475 * S, 0);

    // ---- shared materials ----
    const trunkMat = this._mat(new THREE.MeshStandardMaterial({ color: B.trunk, roughness: 0.85, metalness: 0.05, flatShading: true }));
    const foliageMat = this._mat(new THREE.MeshStandardMaterial({ color: B.foliage, roughness: 0.8, metalness: 0.05, flatShading: true }));
    const rockMat = this._mat(new THREE.MeshStandardMaterial({ color: B.rock, roughness: 0.95, metalness: 0.05, flatShading: true }));
    const mtnMat = this._mat(new THREE.MeshStandardMaterial({ color: B.mountain, roughness: 0.95, metalness: 0.05, flatShading: true }));

    // ---- gather instance matrices first, then size InstancedMesh exactly ----
    const trunkM = [], foliageM = [], rockM = [], mtnM = [];
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const yUp = new THREE.Vector3(0, 1, 0);

    for (const tile of tiles.values()) {
      const { q, r, role } = tile.userData;
      const { x, z } = axialToWorld(q, r);

      if (role === 'blocked') {
        // mountain cluster: a tall central peak + a few smaller satellite peaks
        const peaks = 3 + Math.floor(hash01(q, r, seed, 11) * 3); // 3..5
        for (let i = 0; i < peaks; i++) {
          const a = hash01(q, r, seed, 20 + i) * Math.PI * 2;
          const central = i === 0;
          const rad = central ? 0 : (0.18 + hash01(q, r, seed, 30 + i) * 0.28) * S;
          const sx = central ? 1.15 : 0.45 + hash01(q, r, seed, 40 + i) * 0.5;
          const sy = central ? 1.3 : 0.5 + hash01(q, r, seed, 50 + i) * 0.6;
          pos.set(x + Math.cos(a) * rad, TILE_TOP, z + Math.sin(a) * rad);
          quat.setFromAxisAngle(yUp, hash01(q, r, seed, 60 + i) * Math.PI * 2);
          scl.set(sx, sy, sx);
          mtnM.push(m.compose(pos, quat, scl).clone());
        }
        // a couple of loose boulders at the foot for silhouette
        for (let i = 0; i < 2; i++) {
          const a = hash01(q, r, seed, 70 + i) * Math.PI * 2;
          const rad = (0.4 + hash01(q, r, seed, 80 + i) * 0.2) * S;
          pos.set(x + Math.cos(a) * rad, TILE_TOP, z + Math.sin(a) * rad);
          quat.setFromAxisAngle(yUp, hash01(q, r, seed, 90 + i) * Math.PI * 2);
          const rs = 0.8 + hash01(q, r, seed, 95 + i) * 0.6;
          scl.set(rs, rs, rs);
          rockM.push(m.compose(pos, quat, scl).clone());
        }
        continue;
      }

      // only 'default' tiles get scattered props; lane/objectives stay clear
      if (role !== 'default') continue;

      // deterministic density gate
      if (hash01(q, r, seed, 1) > B.fill * density) continue;

      // deterministic off-center jitter so props don't line up
      const jx = (hash01(q, r, seed, 2) - 0.5) * 0.7 * S;
      const jz = (hash01(q, r, seed, 3) - 0.5) * 0.7 * S;
      pos.set(x + jx, TILE_TOP, z + jz);
      const rot = hash01(q, r, seed, 4) * Math.PI * 2;
      quat.setFromAxisAngle(yUp, rot);
      const baseScale = 0.8 + hash01(q, r, seed, 5) * 0.5;

      // choose prop: mostly the biome's hero prop, sometimes a lone rock/shrub
      const roll = hash01(q, r, seed, 6);
      if (roll < 0.3) {
        // small rock
        const rs = baseScale * (0.7 + hash01(q, r, seed, 7) * 0.6);
        scl.set(rs, rs, rs);
        rockM.push(m.compose(pos, quat, scl).clone());
      } else {
        // hero prop = trunk/column + foliage stacked at the same spot
        scl.set(baseScale, baseScale, baseScale);
        const M = m.compose(pos, quat, scl).clone();
        trunkM.push(M);
        // foliage uses its own geometry already offset upward in _foliageGeometry
        foliageM.push(M);
      }
    }

    this._buildInstanced(trunkGeo, trunkMat, trunkM);
    this._buildInstanced(foliageGeo, foliageMat, foliageM);
    this._buildInstanced(rockGeo, rockMat, rockM);
    this._buildInstanced(mtnGeo, mtnMat, mtnM);
  }

  /** Build one InstancedMesh from a list of matrices (skips if empty). */
  _buildInstanced(geo, mat, matrices) {
    if (!matrices.length) return;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    inst.castShadow = false;
    inst.receiveShadow = false;
    for (let i = 0; i < matrices.length; i++) inst.setMatrixAt(i, matrices[i]);
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false; // matrices span the whole board
    this._track(inst);
  }

  /**
   * Per-biome foliage geometry, pre-offset so its base sits atop the trunk.
   * Returned geometry is owned/disposed by the caller (tracked in populate).
   */
  _foliageGeometry(biome) {
    if (biome === 'desert') {
      // cactus: tall green column with two short arms -> merged-ish via a group
      // (InstancedMesh needs a single BufferGeometry, so build with sub-geos
      //  baked into one by translating into a single CylinderGeometry stack)
      const g = new THREE.CylinderGeometry(0.12 * S, 0.14 * S, 0.7 * S, 7);
      g.translate(0, 0.5 * S + 0.35 * S, 0); // sit above trunk base
      return g;
    }
    if (biome === 'forest' || biome === 'mountain' || biome === 'pine') {
      // conifer: cone foliage
      const g = new THREE.ConeGeometry(0.34 * S, 0.8 * S, 7);
      g.translate(0, 0.5 * S + 0.4 * S, 0);
      return g;
    }
    if (biome === 'tundra') {
      // dead/snow-dusted: a small sparse round crown
      const g = new THREE.IcosahedronGeometry(0.26 * S, 0);
      g.translate(0, 0.5 * S + 0.3 * S, 0);
      return g;
    }
    // fallback round crown
    const g = new THREE.IcosahedronGeometry(0.3 * S, 0);
    g.translate(0, 0.5 * S + 0.35 * S, 0);
    return g;
  }

  /** Optional cheap idle - no-op (static scenery, no per-frame cost). */
  update() {}

  /** Remove every object from the scene and dispose all geo/materials. */
  clear() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      if (mesh.dispose) mesh.dispose(); // InstancedMesh frees instance buffers
    }
    for (const g of this.geometries) g.dispose();
    for (const mat of this.materials) mat.dispose();
    this.meshes.length = 0;
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
