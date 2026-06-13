/**
 * SparkRenderer — hot debris sparks fired on projectile impact / enemy death,
 * complementing the smoke/fireball explosion. Each burst() spawns count (~8-14)
 * tiny additive points at the position, each with a random outward velocity
 * (hemisphere biased upward). update() integrates motion (pos += vel*dt; vel.y -=
 * gravity*dt), arcing them up and letting them fall while opacity fades to 0 over
 * a ~0.4-0.8s life. One THREE.Points cloud per burst (one draw call): a single
 * BufferGeometry whose position attribute is rewritten each frame, plus a
 * PointsMaterial sharing a soft round CanvasTexture built ONCE in the constructor.
 * Geometry + material are fully disposed on expire (mirrors tracer.js); the shared
 * texture is disposed in clear(). No external assets.
 */
import * as THREE from 'three';
import { S } from './shared.js';

const LIFE_MIN = 0.4;              // seconds
const LIFE_MAX = 0.8;
const GRAVITY = 14 * S;            // units/sec^2, pulls sparks back down

export class SparkRenderer {
  constructor(scene) {
    this.scene = scene;
    this.bursts = [];

    // Soft round point sprite, drawn once and shared by every burst's material.
    this._tex = this._makeSoftTexture();
  }

  _makeSoftTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  // positionVec3: THREE.Vector3 world position.
  // opts: { color, count, scale, speed } — spark tint, particle count, size mult, outward speed.
  burst(positionVec3, opts = {}) {
    const color = opts.color != null ? opts.color : 0xffdd66;
    const count = Math.max(1, Math.min(opts.count != null ? opts.count : 10, 32));
    const scale = opts.scale != null ? opts.scale : 1;
    const speed = opts.speed != null ? opts.speed : 6 * S;

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      positions[o] = positionVec3.x;
      positions[o + 1] = positionVec3.y;
      positions[o + 2] = positionVec3.z;

      // random outward direction, hemisphere biased upward (+Y)
      const theta = Math.random() * Math.PI * 2;
      const up = Math.random();                 // 0..1, favour upward
      const r = Math.sqrt(1 - up * up);         // horizontal radius for unit vector
      const sp = speed * (0.5 + Math.random() * 0.8);
      velocities[o] = Math.cos(theta) * r * sp;
      velocities[o + 1] = up * sp;
      velocities[o + 2] = Math.sin(theta) * r * sp;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      map: this._tex,
      size: 0.15 * S * scale,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 9;
    this.scene.add(points);

    this.bursts.push({
      points, velocities, count,
      age: 0,
      life: LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN),
    });
  }

  update(dt = 0.016) {
    this.bursts = this.bursts.filter((b) => {
      b.age += dt;
      if (b.age >= b.life) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();   // map (shared CanvasTexture) freed in clear()
        return false;
      }
      const pos = b.points.geometry.attributes.position.array;
      const vel = b.velocities;
      for (let i = 0; i < b.count; i++) {
        const o = i * 3;
        vel[o + 1] -= GRAVITY * dt;          // gravity on Y velocity
        pos[o] += vel[o] * dt;
        pos[o + 1] += vel[o + 1] * dt;
        pos[o + 2] += vel[o + 2] * dt;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.points.material.opacity = 1 - b.age / b.life;   // fade out over life
      return true;
    });
  }

  clear() {
    for (const b of this.bursts) {
      this.scene.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
    }
    this.bursts = [];
    this._tex.dispose();
  }
}
