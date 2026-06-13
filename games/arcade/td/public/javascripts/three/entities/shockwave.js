/**
 * ShockwaveRenderer + CameraShaker - punch-up FX for enemy deaths.
 * ShockwaveRenderer: expanding additive ground ring, dt-aged, tracer-style disposal.
 * CameraShaker: transient positional camera offset that composes with OrbitControls
 *   (restore-then-reapply each frame so it never permanently drifts the camera).
 */
import * as THREE from 'three';
import { S, TILE_TOP } from './shared.js';

/* ---------------------------- shockwave ---------------------------- */

export class ShockwaveRenderer {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    // Unit ring (inner 0.7 .. outer 1.0); per-ring scale drives the radius.
    this.geo = new THREE.RingGeometry(0.7, 1.0, 48);
  }

  /** Spawn a flat ground ring at positionVec3. opts: { color, maxRadius, life } */
  burst(positionVec3, opts = {}) {
    const color = opts.color ?? 0xffbb66;
    const maxRadius = opts.maxRadius ?? 2.5 * S;
    const life = opts.life ?? 0.5;

    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.rotation.x = -Math.PI / 2;            // lie flat on the ground
    mesh.position.set(positionVec3.x, TILE_TOP + 0.01 * S, positionVec3.z);
    const r0 = 0.2 * S;
    mesh.scale.set(r0, r0, r0);
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, age: 0, life, r0, maxRadius });
  }

  update(dt = 0.016) {
    this.rings = this.rings.filter((r) => {
      r.age += dt;
      if (r.age >= r.life) {
        this.scene.remove(r.mesh);
        r.mat.dispose();           // per-instance material only; geo is shared
        return false;
      }
      const t = r.age / r.life;                       // 0 -> 1
      const radius = r.r0 + (r.maxRadius - r.r0) * t;  // expand
      r.mesh.scale.set(radius, radius, radius);
      r.mat.opacity = 0.8 * (1 - t);                   // fade 0.8 -> 0
      return true;
    });
  }

  clear() {
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
    this.rings = [];
    this.geo.dispose();           // shared geometry torn down here
  }
}

/* --------------------------- camera shake -------------------------- */

export class CameraShaker {
  constructor(camera) {
    this.camera = camera;
    this.intensity = 0;           // board units
    this.duration = 0;
    this.remaining = 0;
    this._applied = new THREE.Vector3(0, 0, 0); // offset added last frame
  }

  /** Request a shake. intensity is in board units (scaled by S internally). */
  shake(intensity = 0.3, duration = 0.25) {
    this.intensity = Math.max(this.intensity, intensity); // additive, non-stacking
    this.duration = Math.max(this.duration, duration);
    this.remaining = Math.max(this.remaining, duration);
  }

  /**
   * Call every frame AFTER controls.update(). OrbitControls rewrites
   * camera.position each frame, so we restore last frame's offset first,
   * then apply a fresh decaying one. Net camera drift is always zero.
   */
  update(dt = 0.016) {
    // Restore whatever we shoved in last frame.
    this.camera.position.sub(this._applied);
    this._applied.set(0, 0, 0);

    if (this.remaining <= 0) {
      this.intensity = 0;
      this.duration = 0;
      this.remaining = 0;
      return;
    }

    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = 0;
      return; // ended; offset already restored above
    }

    const decay = this.remaining / this.duration;        // 1 -> 0
    const amp = this.intensity * decay * S;               // board units -> world
    this._applied.set(
      (Math.random() * 2 - 1) * amp,
      (Math.random() * 2 - 1) * amp,
      (Math.random() * 2 - 1) * amp,
    );
    this.camera.position.add(this._applied);
  }
}
