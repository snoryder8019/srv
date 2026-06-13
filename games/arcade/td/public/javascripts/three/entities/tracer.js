/** TracerRenderer - brief additive shot lines from tower to target. */
import * as THREE from 'three';

/* ----------------------------- tracers ----------------------------- */

export class TracerRenderer {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
  }

  fire(fromVec3, toVec3, color = 0xffcc66) {
    const geo = new THREE.BufferGeometry().setFromPoints([fromVec3, toVec3]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
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
      t.line.material.opacity = ((t.expireAt - now) / 120) * 0.9;
      return true;
    });
  }
}
