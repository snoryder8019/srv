/**
 * LootRenderer — brief floating pickup pops at kill sites. The server decides
 * drops (loot:drop event); this just plays a short rise-and-fade icon so the
 * player sees what fell: ammo (amber box), tower component (cyan octahedron),
 * or a token (gold coin). Billboarded toward the camera, additive glow.
 */
import * as THREE from 'three';
import { axialToWorld } from '../hex-grid.js';
import { S, TILE_TOP } from './shared.js';

const LIFE_MS = 1400;

const GEO = {
  ammo: new THREE.BoxGeometry(0.32 * S, 0.32 * S, 0.32 * S),
  component: new THREE.OctahedronGeometry(0.26 * S, 0),
  token: new THREE.CylinderGeometry(0.26 * S, 0.26 * S, 0.07 * S, 16),
};
const COLOR = { ammo: 0xffcc44, component: 0x44e0ff, token: 0xffd24a };

export class LootRenderer {
  constructor(scene) {
    this.scene = scene;
    this.pops = [];
    this._camera = null;
  }
  setCamera(cam) { this._camera = cam; }

  // drop: { item:'ammo'|'component'|'token', amount, q, r }
  drop(drop) {
    const item = drop.item || 'ammo';
    const geo = GEO[item] || GEO.ammo;
    const color = COLOR[item] || 0xffffff;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    const { x, z } = axialToWorld(drop.q, drop.r);
    mesh.position.set(x, TILE_TOP + 0.5 * S, z);
    if (item === 'token') mesh.rotation.x = Math.PI / 2;   // coin faces up-ish
    mesh.renderOrder = 7;
    this.scene.add(mesh);
    this.pops.push({ mesh, born: performance.now(), baseY: mesh.position.y });
  }

  update() {
    const now = performance.now();
    this.pops = this.pops.filter((p) => {
      const age = now - p.born;
      if (age >= LIFE_MS) { this.scene.remove(p.mesh); p.mesh.geometry && p.mesh.material.dispose(); return false; }
      const t = age / LIFE_MS;
      p.mesh.position.y = p.baseY + t * 0.9 * S;          // rise
      p.mesh.material.opacity = 1 - t * t;                 // fade out
      p.mesh.rotation.y += 0.08;                           // spin for readability
      return true;
    });
  }

  clear() { for (const p of this.pops) this.scene.remove(p.mesh); this.pops = []; }
}
