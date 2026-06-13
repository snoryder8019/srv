/** MuzzleRenderer - brief additive muzzle flash + drifting grey smoke puffs
 *  spawned at a tower's barrel when it fires. Sprites auto-billboard. */
import * as THREE from 'three';
import { S } from './shared.js';

/* ----------------------------- muzzle fx ----------------------------- */

// One soft radial-gradient texture, built once and shared by every sprite.
function buildSoftTexture() {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export class MuzzleRenderer {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];                       // { sprite, age, life, kind, vel?, baseScale, peakScale }
    this.tex = buildSoftTexture();         // shared, disposed in clear()
  }

  // positionVec3: world muzzle position. opts.color tints the flash; opts.dir
  // (normalized) biases flash + smoke toward the target, else they puff upward.
  flash(positionVec3, opts = {}) {
    const color = opts.color != null ? opts.color : 0xffdd88;
    const dir = opts.dir ? opts.dir.clone().normalize() : new THREE.Vector3(0, 1, 0);

    // --- bright additive flash: scale-pops then fades fast ---
    const flashMat = new THREE.SpriteMaterial({
      map: this.tex, color, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const flash = new THREE.Sprite(flashMat);
    flash.position.copy(positionVec3).addScaledVector(dir, 0.15 * S);
    flash.scale.setScalar(0.08 * S);
    this.scene.add(flash);
    this.parts.push({ sprite: flash, age: 0, life: 0.1, kind: 'flash', peakScale: 0.4 * S });

    // --- 1-3 tiny grey smoke puffs drifting outward along dir ---
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const smokeMat = new THREE.SpriteMaterial({
        map: this.tex, color: 0x888888, transparent: true, opacity: 0.55,
        blending: THREE.NormalBlending, depthWrite: false
      });
      const smoke = new THREE.Sprite(smokeMat);
      smoke.position.copy(positionVec3).addScaledVector(dir, 0.18 * S);
      const base = (0.12 + Math.random() * 0.1) * S;
      smoke.scale.setScalar(base);
      this.scene.add(smoke);
      // drift mostly along dir + a little jitter
      const vel = dir.clone().multiplyScalar((0.4 + Math.random() * 0.3) * S);
      vel.x += (Math.random() - 0.5) * 0.25 * S;
      vel.z += (Math.random() - 0.5) * 0.25 * S;
      const life = 0.4 + Math.random() * 0.2;
      this.parts.push({ sprite: smoke, age: 0, life, kind: 'smoke', vel, baseScale: base });
    }
  }

  update(dt = 0.016) {
    this.parts = this.parts.filter(p => {
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();       // per-instance material clone
        return false;
      }
      const t = p.age / p.life;             // 0..1
      if (p.kind === 'flash') {
        // pop out to peak by ~40%, then fade
        const grow = Math.min(1, t / 0.4);
        p.sprite.scale.setScalar(0.08 * S + (p.peakScale - 0.08 * S) * grow);
        p.sprite.material.opacity = 1 - t;
      } else {
        p.sprite.position.addScaledVector(p.vel, dt);
        p.sprite.scale.setScalar(p.baseScale * (1 + t * 1.5));
        p.sprite.material.opacity = 0.55 * (1 - t);
      }
      return true;
    });
  }

  clear() {
    for (const p of this.parts) {
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.parts = [];
    this.tex.dispose();                     // shared texture
  }
}
