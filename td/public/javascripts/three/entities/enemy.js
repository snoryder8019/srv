/**
 * EnemyRenderer — attackers as reliable PRIMITIVE walkers, with an OPTIONAL GLTF
 * model upgrade layered on top.
 *
 * Primitives always render (no async, no skinning) so the board is never empty.
 * If a type has a `model` URL, we preload it; when ready we swap the primitive
 * for the model — but scaled to a FIXED target height (not an auto-fit off a
 * possibly-degenerate skinned bounding box, which previously made the robot as
 * big as the base). If the model fails or measures insane, we keep the primitive.
 *
 * Public API unchanged: spawn(), updatePosition(), update(), remove(), clear().
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { axialToWorld } from '../hex-grid.js';
import { S, TILE_TOP } from './shared.js';

const SMOOTH_RATE = 12;
const WHITE = new THREE.Color(0xffffff);

// Target ON-SCREEN height of a base-size enemy, in world units. A hex is S(=2.4)
// across; a unit should read clearly but be smaller than the base cluster.
const TARGET_H = 1.5 * S;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0.35,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0 });
}

// type -> visual spec. sizeMul scales the whole unit; tint is the body color.
// `model` (optional) is a GLTF that upgrades the primitive once loaded.
// Ground types all share robot.glb (only ground model we have), but diversify
// silhouette via sizeMul/tint: hulls beefier & darker-red, runners leaner &
// brighter-yellow. Flyers get real bird models (animate via their own clip,
// animations[0]) and read a touch bigger via sizeMul.
const SPEC = {
  basic:       { tint: 0xff5a3c, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  fast:        { tint: 0xffe04c, sizeMul: 0.82, kind: 'runner', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  tank:        { tint: 0xc41f44, sizeMul: 1.65, kind: 'hull',   model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  grunt:       { tint: 0xff7a2c, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  runner:      { tint: 0xffe04c, sizeMul: 0.82, kind: 'runner', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  machine:     { tint: 0xb01e2a, sizeMul: 1.85, kind: 'hull',   model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  flyer:       { tint: 0x3cf0ff, sizeMul: 1.35, kind: 'flyer', flying: true, model: '/assets/gltf/enemies/stork.glb' },
  flyer2:      { tint: 0x9cff5a, sizeMul: 1.25, kind: 'flyer', flying: true, model: '/assets/gltf/enemies/parrot.glb' },
  infiltrator: { tint: 0xff7a2c, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  swarmer:     { tint: 0xff9a3c, sizeMul: 0.65, kind: 'runner', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  brute:       { tint: 0x8a1020, sizeMul: 2.0,  kind: 'hull',   model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  gunship:     { tint: 0x9b6cff, sizeMul: 1.6,  kind: 'flyer',  flying: true, model: '/assets/gltf/enemies/stork.glb' },
};

function buildUnit(kind, tint) {
  const g = new THREE.Group();
  const body = mat(tint, { rough: 0.45, metal: 0.4, emissive: tint, emissiveIntensity: 0.4 });
  const dark = mat(0x2a2f38, { rough: 0.7, metal: 0.5 });
  const glow = mat(0x1b2230, { emissive: 0x66e0ff, emissiveIntensity: 0.9 });
  const legs = [];

  if (kind === 'flyer') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * S, 0.7 * S, 0.18 * S, 16), body);
    disc.position.y = 0.5 * S; g.add(disc);
    const pod = new THREE.Mesh(new THREE.SphereGeometry(0.3 * S, 14, 12), dark);
    pod.position.y = 0.5 * S; g.add(pod);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12 * S, 10, 8), glow);
    eye.position.set(0, 0.5 * S, 0.32 * S); g.add(eye);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(1.5 * S, 0.05 * S, 0.12 * S), dark);
    rotor.position.y = 0.72 * S; g.add(rotor);
    g.userData.rotor = rotor;
    return { group: g, legs, eye };
  }

  let torsoH = 0.7 * S, torsoW = 0.6 * S, torsoD = 0.45 * S, lift = 0.55 * S;
  if (kind === 'runner') { torsoH = 0.85 * S; torsoW = 0.4 * S; torsoD = 0.4 * S; lift = 0.7 * S; }
  if (kind === 'hull')   { torsoH = 0.8 * S; torsoW = 1.0 * S; torsoD = 0.9 * S; lift = 0.5 * S; }

  const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoD), body);
  torso.position.y = lift + torsoH / 2; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34 * S, 0.3 * S, 0.34 * S), dark);
  head.position.y = lift + torsoH + 0.15 * S; g.add(head);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.26 * S, 0.08 * S, 0.04 * S), glow);
  eye.position.set(0, lift + torsoH + 0.16 * S, 0.17 * S); g.add(eye);

  if (kind === 'hull') {
    for (const sx of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.34 * S, 0.4 * S, torsoD + 0.3 * S), dark);
      track.position.set(sx * (torsoW / 2 + 0.05 * S), 0.25 * S, 0); g.add(track);
    }
  } else {
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18 * S, lift, 0.2 * S), dark);
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.18 * S, lift, 0);
      leg.position.set(0, -lift / 2, 0);
      pivot.add(leg); g.add(pivot);
      legs.push(pivot);
    }
  }
  return { group: g, legs, eye };
}

export class EnemyRenderer {
  constructor(scene) {
    this.scene = scene;
    this.entities = new Map();
    this._lastT = 0;
    this.models = {};            // url -> { scene, animations }
    this._loader = new GLTFLoader();
    this._preload();
  }

  _preload() {
    const urls = new Set();
    for (const spec of Object.values(SPEC)) if (spec.model) urls.add(spec.model);
    for (const url of urls) {
      this._loader.load(url, (gltf) => {
        const src = gltf.scene;
        // measure native height (armature node-scale included) and bake a base
        // scale into the SOURCE so clones never need rescaling.
        src.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(src);
        const h = box.max.y - box.min.y;
        let base = (isFinite(h) && h > 1e-3) ? (TARGET_H / h) : 1;
        if (!isFinite(base) || base <= 0 || base > 1000) base = 1;
        src.scale.setScalar(base);
        src.updateWorldMatrix(true, true);
        const box2 = new THREE.Box3().setFromObject(src);
        const footY = isFinite(box2.min.y) ? box2.min.y : 0;
        src.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
        this.models[url] = { scene: src, animations: gltf.animations, footY };
        this._upgradeToModels(url);
      }, undefined, () => { /* keep primitives on failure */ });
    }
  }

  // Clone the (already-scaled) source. sizeMul applies a SMALL extra factor via a
  // wrapper group — for NON-skinned variety we'd scale the clone, but to stay safe
  // with skinned meshes we wrap and scale the wrapper, keeping the skinned clone at
  // its native (source) scale inside.
  _makeModel(url, sizeMul) {
    const m = this.models[url];
    if (!m) return null;
    let inner;
    try { inner = skeletonClone(m.scene); } catch (e) {
      try { inner = m.scene.clone(true); } catch (e2) { return null; }
    }
    inner.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
    inner.position.y = -m.footY;          // feet on y=0 (relative to native scale)
    // wrapper carries the per-type sizeMul so we never rescale the skinned clone itself
    const root = new THREE.Group();
    root.scale.setScalar(sizeMul || 1);
    root.add(inner);
    let mixer = null;
    const clip = m.animations && (THREE.AnimationClip.findByName(m.animations, 'Running') || m.animations[0]);
    if (clip) { mixer = new THREE.AnimationMixer(inner); mixer.clipAction(clip).play(); }
    return { root, mixer };
  }

  // When a model finishes loading, upgrade every live entity that uses it and is
  // still on its primitive.
  _upgradeToModels(url) {
    for (const e of this.entities.values()) {
      if (e.usingModel || e.dying) continue;
      const spec = SPEC[e.type] || SPEC.grunt;
      if (spec.model !== url) continue;
      const built = this._makeModel(url, spec.sizeMul);
      if (!built) continue;
      // mount the model inside the entity's root group, hide the primitive parts
      e.primitive.visible = false;
      e.root.add(built.root);
      e.modelRoot = built.root; e.mixer = built.mixer; e.usingModel = true;
    }
  }

  spawn({ id, type = 'grunt', color, hpMax }) {
    const spec = SPEC[type] || SPEC.grunt;
    const tint = (typeof color === 'number') ? color : spec.tint;
    const { group: primitive, legs, eye } = buildUnit(spec.kind, tint);
    primitive.scale.setScalar(spec.sizeMul || 1);

    // outer root holds the primitive (and later the model); positioned/rotated by update()
    const root = new THREE.Group();
    root.add(primitive);
    root.position.y = TILE_TOP;
    root.visible = false;
    this.scene.add(root);

    const e = {
      root, primitive, legs, eye, type, hpMax, spec,
      target: null, placed: false, yaw: 0, dying: false,
      flying: !!spec.flying, baseY: TILE_TOP, phase: Math.random() * Math.PI * 2,
      walkT: Math.random() * Math.PI * 2, mixer: null, usingModel: false, modelRoot: null,
      flash: 0, flashDur: 0, flashMats: null, shadow: null,
    };
    this.entities.set(id, e);

    // cheap contact shadow under ground units (flat dark disc on the tile top)
    if (!e.flying) {
      const sR = 0.5 * S * (spec.sizeMul || 1);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(sR, 18),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.01 * S;
      root.add(shadow);
      e.shadow = shadow;
    }

    // if the model is already loaded, upgrade immediately
    if (spec.model && this.models[spec.model]) {
      const built = this._makeModel(spec.model, spec.sizeMul);
      if (built) { primitive.visible = false; root.add(built.root); e.modelRoot = built.root; e.mixer = built.mixer; e.usingModel = true; }
    }
  }

  updatePosition(id, q, r, hp) {
    const e = this.entities.get(id);
    if (!e || e.dying) return;
    const { x, z } = axialToWorld(q, r);
    e.target = { x, z };
    if (!e.placed) {
      e.root.position.x = x; e.root.position.z = z;
      e.root.visible = true; e.placed = true;
    }
  }

  update() {
    const now = performance.now();
    const dt = this._lastT ? Math.min(0.05, (now - this._lastT) / 1000) : 0;
    this._lastT = now;
    const a = 1 - Math.exp(-dt * SMOOTH_RATE);
    const tnow = now * 0.001;

    for (const e of this.entities.values()) {
      if (e.mixer) e.mixer.update(dt);
      if (e.flash > 0) this._decayFlash(e, dt);
      if (e.dying || !e.target) continue;
      const px = e.root.position.x, pz = e.root.position.z;
      e.root.position.x += (e.target.x - px) * a;
      e.root.position.z += (e.target.z - pz) * a;

      const dx = e.root.position.x - px, dz = e.root.position.z - pz;
      const moving = Math.hypot(dx, dz);
      if (moving > 0.0008) {
        const targetYaw = Math.atan2(dx, dz);
        let diff = targetYaw - e.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        e.yaw += diff * Math.min(1, dt * 10);
        e.root.rotation.y = e.yaw;
      }

      if (e.flying) {
        e.root.position.y = e.baseY + 0.6 * S + Math.sin(tnow * 3 + e.phase) * 0.12 * S;
        // rotor only exists on the primitive disc; models (birds) flap via mixer
        if (!e.usingModel && e.primitive.userData.rotor) e.primitive.userData.rotor.rotation.y += dt * 18;
      } else if (!e.usingModel && e.legs && e.legs.length) {
        // animate primitive legs only while we're showing the primitive
        e.walkT += dt * (moving > 0.0008 ? 9 : 0);
        const sw = Math.sin(e.walkT) * 0.5;
        e.legs[0].rotation.x = sw;
        e.legs[1].rotation.x = -sw;
      }
    }
  }

  // ---- Damage feedback: flash + scale-punch on projectile hit ----
  // Briefly boost emissive toward white and punch scale, decaying over ~150ms.
  // Materials are CLONED per-entity on first hit so we never mutate a shared
  // (cloned model) source material; originals stored for restore on decay end.
  hit(id, opts = {}) {
    const e = this.entities.get(id);
    if (!e || e.dying) return;
    const dur = opts.duration ?? 0.15;
    if (!e.flashMats) {
      // clone every material on the visible subtree (primitive + model) so the
      // emissive bump is local to this entity, recording originals to restore.
      const mats = [];
      const clone = (m) => {
        const c = m.clone();
        mats.push({ mat: c, emissive: c.emissive ? c.emissive.clone() : null,
          intensity: c.emissiveIntensity ?? 0 });
        return c;
      };
      e.root.traverse((o) => {
        if (!o.material || o === e.shadow) return;
        o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
      });
      e.flashMats = mats;
    }
    e.flash = 1; e.flashDur = dur;
    this._applyFlash(e, 1);
  }

  _applyFlash(e, k) {
    if (!e.flashMats) return;
    for (const f of e.flashMats) {
      const m = f.mat;
      if (f.emissive) {
        m.emissive.copy(f.emissive).lerp(WHITE, 0.85 * k);
        m.emissiveIntensity = f.intensity + 1.4 * k;
      }
    }
    const punch = 1 + 0.12 * k;
    if (e.primitive) e.primitive.scale.setScalar((e.spec.sizeMul || 1) * punch);
    if (e.modelRoot) e.modelRoot.scale.setScalar((e.spec.sizeMul || 1) * punch);
  }

  _decayFlash(e, dt) {
    e.flash -= dt / (e.flashDur || 0.15);
    if (e.flash <= 0) {
      e.flash = 0;
      this._applyFlash(e, 0);   // restore exact original emissive/intensity & scale
      return;
    }
    this._applyFlash(e, e.flash);
  }

  // ---- Tactical-pause attack lines (bezier arcs enemy -> attack point) ----
  // attackPoint = world {x,z} (the base center). Tint flows green->red by how
  // close the enemy is to the point (closer = more urgent).
  showAttackLines(attackPoint = { x: 0, z: 0 }) {
    this.hideAttackLines();
    this._attackLines = new THREE.Group();
    this._attackLines.renderOrder = 5;
    for (const e of this.entities.values()) {
      if (!e.placed || e.dying) continue;
      const from = new THREE.Vector3(e.root.position.x, TILE_TOP + 0.6 * S, e.root.position.z);
      const to = new THREE.Vector3(attackPoint.x, TILE_TOP + 0.6 * S, attackPoint.z);
      const dist = from.distanceTo(to);
      // control point: midpoint lifted up (arc height scales with distance)
      const mid = from.clone().add(to).multiplyScalar(0.5);
      mid.y += Math.min(8 * S, dist * 0.35);
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const pts = curve.getPoints(24);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      // urgency tint: closer enemies = redder
      const t = Math.max(0, Math.min(1, 1 - dist / (20 * S)));
      const color = new THREE.Color().setHSL(0.33 * (1 - t), 0.9, 0.55);  // green->red
      const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false });
      const line = new THREE.Line(geo, lineMat);
      line.renderOrder = 5;
      this._attackLines.add(line);
      // a small marker pulsing at the attack point end
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12 * S, 8, 6),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      dot.position.copy(from); dot.renderOrder = 6;
      this._attackLines.add(dot);
    }
    this.scene.add(this._attackLines);
  }

  hideAttackLines() {
    if (this._attackLines) {
      this._attackLines.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.scene.remove(this._attackLines);
      this._attackLines = null;
    }
  }

  remove(id) { this._dispose(id); }

  _dispose(id) {
    const e = this.entities.get(id);
    if (!e) return;
    this.scene.remove(e.root);
    // dispose per-entity meshes/materials we created
    if (e.shadow) { e.shadow.geometry.dispose(); e.shadow.material.dispose(); e.shadow = null; }
    if (e.flashMats) { for (const f of e.flashMats) f.mat.dispose(); e.flashMats = null; }
    if (e.mixer) { e.mixer.stopAllAction(); e.mixer = null; }
    this.entities.delete(id);
  }

  clear() { for (const id of [...this.entities.keys()]) this._dispose(id); }
}
