/**
 * ExplosionRenderer — short-lived particle bursts fired on projectile impact /
 * enemy death. Each burst() spawns a bright additive fireball flash (~250ms)
 * with a white-hot core fading through orange to smoke, a couple of brighter
 * inner ember sprites, plus several soft smoke puffs that expand, drift up in
 * +Y and fade slower (~700-1000ms) from warm grey toward transparent. Sprites
 * auto-billboard. Soft round look comes from a radial-gradient CanvasTexture
 * built once. Each burst also fires a brief warm PointLight so the blast
 * actually illuminates nearby geometry — lights come from a small fixed POOL
 * built once in the constructor (round-robin reuse, never per-burst alloc) and
 * decay to intensity 0 over ~180ms. All geometry/materials are fully disposed
 * on expire; the light pool is the only long-lived resource, removed in clear().
 */
import * as THREE from 'three';
import { S } from './shared.js';

const FLASH_LIFE = 0.25;            // seconds
const SMOKE_LIFE_MIN = 0.7;
const SMOKE_LIFE_MAX = 1.0;
const EMBER_LIFE = 0.18;            // seconds — hot inner core embers
const LIGHT_POOL = 3;              // reusable PointLights shared across bursts
const LIGHT_LIFE = 0.18;            // seconds — flash decay time
const LIGHT_INTENSITY = 6;          // peak intensity on burst
const LIGHT_DISTANCE = 8 * S;       // falloff range
const LIGHT_COLOR = 0xffcaa0;       // warm flash tint

export class ExplosionRenderer {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];

    // Soft radial-gradient sprite texture, drawn once and shared by every particle.
    this._tex = this._makeSoftTexture();

    // --- reusable dynamic light pool (added to scene once, start dark) ---
    // Round-robin grabbed on burst(); decayed back to 0 in update(). Never
    // allocated per-burst (no leak/perf risk); removed only in clear().
    this._lights = [];
    this._lightIdx = 0;
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_DISTANCE, 2);
      light.visible = false;
      this.scene.add(light);
      this._lights.push({ light, remaining: 0 });
    }

    // Shared sprite material templates — cloned per particle so we can animate
    // per-instance opacity/color without touching siblings.
    this._flashTemplate = new THREE.SpriteMaterial({
      map: this._tex,
      color: 0xffaa44,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._emberTemplate = new THREE.SpriteMaterial({
      map: this._tex,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._smokeTemplate = new THREE.SpriteMaterial({
      map: this._tex,
      color: 0x555555,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
  }

  // Grab the next pool light (round-robin), move it to pos, flash it warm/bright.
  _flashLight(positionVec3, scale) {
    const slot = this._lights[this._lightIdx];
    this._lightIdx = (this._lightIdx + 1) % this._lights.length;
    slot.light.position.copy(positionVec3);
    slot.light.color.setHex(LIGHT_COLOR);
    slot.peak = LIGHT_INTENSITY * scale;
    slot.light.intensity = slot.peak;
    slot.light.distance = LIGHT_DISTANCE * scale;
    slot.light.visible = true;
    slot.remaining = LIGHT_LIFE;
  }

  _makeSoftTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  // positionVec3: THREE.Vector3 world position.
  // opts: { color, scale, smoke } — fireball tint, overall size multiplier, smoke puff count.
  burst(positionVec3, opts = {}) {
    const color = opts.color != null ? opts.color : 0xffaa44;
    const scale = opts.scale != null ? opts.scale : 1;
    const smokeCount = Math.max(0, Math.min(opts.smoke != null ? opts.smoke : 8, 10));

    // --- dynamic light flash (reused pool light, no per-burst alloc) ---
    if (opts.light !== false) this._flashLight(positionVec3, scale);

    // --- fireball flash sprites (1-2, additive) ---
    const flashCount = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < flashCount; i++) {
      const mat = this._flashTemplate.clone();
      mat.color = new THREE.Color(color);
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(positionVec3);
      const start = 0.5 * S * scale;
      const end = 1.5 * S * scale * (0.9 + Math.random() * 0.3);
      sprite.scale.setScalar(start);
      sprite.renderOrder = 9;
      this.scene.add(sprite);
      this.particles.push({
        sprite, age: 0, life: FLASH_LIFE,
        startScale: start, endScale: end,
        startOpacity: 1, rise: 0, kind: 'flash',
        // hot->cool tint ramp: white-hot core -> orange -> smoke
        hot: new THREE.Color(0xffffff), warm: new THREE.Color(color),
      });
    }

    // --- bright inner embers (2, white-hot, additive, short + small) ---
    const emberCount = 2;
    for (let i = 0; i < emberCount; i++) {
      const mat = this._emberTemplate.clone();
      mat.color = new THREE.Color(0xffffff);
      const sprite = new THREE.Sprite(mat);
      const jitter = 0.15 * S * scale;
      sprite.position.set(
        positionVec3.x + (Math.random() - 0.5) * jitter,
        positionVec3.y + (Math.random() - 0.5) * jitter,
        positionVec3.z + (Math.random() - 0.5) * jitter,
      );
      const start = 0.35 * S * scale * (0.8 + Math.random() * 0.4);
      const end = 0.8 * S * scale * (0.8 + Math.random() * 0.4);
      sprite.scale.setScalar(start);
      sprite.renderOrder = 10;
      this.scene.add(sprite);
      this.particles.push({
        sprite, age: 0, life: EMBER_LIFE,
        startScale: start, endScale: end,
        startOpacity: 1, rise: 0, kind: 'flash',
        hot: new THREE.Color(0xffffff), warm: new THREE.Color(0xffdd88),
      });
    }

    // --- smoke puffs (normal blend, warm grey, rise + expand + slow fade) ---
    for (let i = 0; i < smokeCount; i++) {
      const mat = this._smokeTemplate.clone();
      mat.color = new THREE.Color(0x555555);
      const sprite = new THREE.Sprite(mat);
      const jitter = 0.25 * S * scale;
      sprite.position.set(
        positionVec3.x + (Math.random() - 0.5) * jitter,
        positionVec3.y + (Math.random() - 0.5) * jitter,
        positionVec3.z + (Math.random() - 0.5) * jitter,
      );
      const start = 0.4 * S * scale * (0.8 + Math.random() * 0.4);
      const end = 1.5 * S * scale * (0.8 + Math.random() * 0.6);
      sprite.scale.setScalar(start);
      sprite.renderOrder = 8;
      this.scene.add(sprite);
      this.particles.push({
        sprite, age: 0,
        life: SMOKE_LIFE_MIN + Math.random() * (SMOKE_LIFE_MAX - SMOKE_LIFE_MIN),
        startScale: start, endScale: end,
        startOpacity: 0.85, rise: (0.6 + Math.random() * 0.6) * S * scale, kind: 'smoke',
      });
    }
  }

  update(dt = 0.016) {
    // decay any active pool lights toward intensity 0; hide when spent.
    for (const slot of this._lights) {
      if (slot.remaining > 0) {
        slot.remaining = Math.max(0, slot.remaining - dt);
        const k = slot.remaining / LIGHT_LIFE;        // 1 -> 0
        slot.light.intensity = slot.peak * k * k;     // ease-out decay to dark
        if (slot.remaining === 0) { slot.light.intensity = 0; slot.light.visible = false; }
      }
    }

    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();   // map (shared CanvasTexture) freed in clear()
        return false;
      }
      const t = p.age / p.life;
      const sc = p.startScale + (p.endScale - p.startScale) * t;
      p.sprite.scale.setScalar(sc);
      if (p.kind === 'flash') {
        // quick easing flash: bright then fast fade
        p.sprite.material.opacity = p.startOpacity * (1 - t) * (1 - t);
        // hot white core cooling toward warm/orange as it fades
        p.sprite.material.color.copy(p.hot).lerp(p.warm, t);
      } else {
        p.sprite.position.y += p.rise * dt;            // drift upward
        p.sprite.material.opacity = p.startOpacity * (1 - t);
      }
      return true;
    });
  }

  clear() {
    for (const p of this.particles) {
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.particles = [];
    // tear down the long-lived light pool (PointLights have no geo/mat to dispose)
    for (const slot of this._lights) {
      slot.light.visible = false;
      slot.light.intensity = 0;
      this.scene.remove(slot.light);
    }
    this._lights = [];
    this._flashTemplate.dispose();
    this._emberTemplate.dispose();
    this._smokeTemplate.dispose();
    this._tex.dispose();
  }
}
