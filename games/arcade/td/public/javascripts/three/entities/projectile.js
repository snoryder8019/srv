/**
 * ProjectileRenderer - glowing additive shots that arc from tower to target,
 * trail, then impact. The head reads as a hot white-additive core; an optional
 * soft glow sprite (radial CanvasTexture built ONCE here) gives it a brighter,
 * lit-looking bloom against scene lighting. onImpact fires exactly once; all
 * per-shot geometry/materials are fully disposed on expire/clear.
 */
import * as THREE from 'three';
import { S } from './shared.js';

const TRAIL_MAX = 8;            // capped trail segments
const DEFAULT_COLOR = 0xffcc66; // matches tracer
const DEFAULT_SPEED = 28 * S;   // board-units/sec
const DEFAULT_ARC = 0.6 * S;

/* ----------------------------- projectiles ----------------------------- */

export class ProjectileRenderer {
  constructor(scene) {
    this.scene = scene;
    this.shots = [];
    // shared glowing-head geometry, created once
    this.headGeo = new THREE.SphereGeometry(0.12 * S, 10, 8);
    // soft radial glow sprite texture, built ONCE, shared by every head's glow.
    this._glowTex = this._makeGlowTexture();
  }

  _makeGlowTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * @param {THREE.Vector3} fromVec3
   * @param {THREE.Vector3} toVec3
   * @param {{color?:number, speed?:number, arc?:number, onImpact?:Function}} [opts]
   */
  fire(fromVec3, toVec3, opts = {}) {
    const color = opts.color ?? DEFAULT_COLOR;
    const speed = opts.speed ?? DEFAULT_SPEED;
    const arc = opts.arc ?? DEFAULT_ARC;
    const from = fromVec3.clone();
    const to = toVec3.clone();
    const dist = from.distanceTo(to);
    const duration = Math.max(dist / speed, 0.001); // seconds; keeps ~150-300ms over typical ranges

    const glowOn = opts.glow !== false;

    // hot additive head: render near-white so additive blending blooms to a
    // bright core, tinted by `color`. depthWrite off keeps it glowy over scene.
    const headMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.6),
      transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const head = new THREE.Mesh(this.headGeo, headMat);
    head.position.copy(from);
    head.renderOrder = 10;
    this.scene.add(head);

    // optional soft glow sprite around the head (shared texture, per-shot mat)
    let glow = null, glowMat = null;
    if (glowOn) {
      glowMat = new THREE.SpriteMaterial({
        map: this._glowTex, color, transparent: true, opacity: 0.6,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(0.55 * S);
      glow.position.copy(from);
      glow.renderOrder = 9;
      this.scene.add(glow);
    }

    // fading additive trail (one BufferGeometry of recent positions, drawn as a line)
    const trailMat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(trailGeo, trailMat);
    this.scene.add(trail);

    this.shots.push({
      from, to, arc, duration,
      t: 0,
      head, headMat,
      glow, glowMat,
      trail, trailGeo, trailMat,
      history: [],
      onImpact: opts.onImpact,
      impacted: false,
    });
  }

  update(dt = 0.016) {
    this.shots = this.shots.filter(s => {
      s.t = Math.min(s.t + dt / s.duration, 1);

      // position along arced path
      const x = THREE.MathUtils.lerp(s.from.x, s.to.x, s.t);
      const y = THREE.MathUtils.lerp(s.from.y, s.to.y, s.t) + s.arc * Math.sin(Math.PI * s.t);
      const z = THREE.MathUtils.lerp(s.from.z, s.to.z, s.t);
      s.head.position.set(x, y, z);
      if (s.glow) s.glow.position.set(x, y, z);

      // update capped trail
      s.history.push(x, y, z);
      if (s.history.length > TRAIL_MAX * 3) s.history.splice(0, s.history.length - TRAIL_MAX * 3);
      const pos = s.trailGeo.attributes.position;
      const n = s.history.length / 3;
      for (let i = 0; i < n; i++) {
        pos.array[i * 3] = s.history[i * 3];
        pos.array[i * 3 + 1] = s.history[i * 3 + 1];
        pos.array[i * 3 + 2] = s.history[i * 3 + 2];
      }
      pos.needsUpdate = true;
      s.trailGeo.setDrawRange(0, n);
      s.trailMat.opacity = 0.75 * (1 - s.t);

      if (s.t >= 1) {
        if (!s.impacted) {
          s.impacted = true;
          s.onImpact?.();
        }
        this._dispose(s);
        return false;
      }
      return true;
    });
  }

  clear() {
    for (const s of this.shots) this._dispose(s);
    this.shots = [];
    // shared glow texture is long-lived; freed only here
    this._glowTex.dispose();
  }

  _dispose(s) {
    this.scene.remove(s.head);
    this.scene.remove(s.trail);
    if (s.glow) { this.scene.remove(s.glow); s.glowMat.dispose(); }
    s.headMat.dispose();
    s.trailGeo.dispose();
    s.trailMat.dispose();
    // shared headGeo intentionally not disposed here (disposed... never; lives with renderer)
    // shared _glowTex disposed in clear(), not per-shot
  }
}
