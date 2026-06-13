/**
 * BaseRenderer — the defended core, redesigned as an energy CITADEL:
 *   • an armored hex platform (tiered) with a glowing rim and six corner pylons
 *   • a gyroscopic containment assembly: a faceted core + a soft glow halo,
 *     caged by two counter-rotating rings
 *   • a translucent energy SHIELD dome over the whole emplacement
 *
 * Everything is health-driven: at full health the citadel reads cool cyan with a
 * strong steady shield; as it falls it shifts amber → angry red, the core dims,
 * and the shield thins and flickers. Public API unchanged: add(), setHealth(),
 * update(), plus clear() for disposal on map change.
 */
import * as THREE from 'three';
import { axialToWorld } from '../hex-grid.js';
import { S, TILE_TOP } from './shared.js';

/* ----------------------------- shared geometry (built once) ----------------------------- */
const G = {
  baseTier:  new THREE.CylinderGeometry(0.78 * S, 0.86 * S, 0.18 * S, 6),
  midTier:   new THREE.CylinderGeometry(0.60 * S, 0.72 * S, 0.16 * S, 6),
  rim:       new THREE.TorusGeometry(0.66 * S, 0.035 * S, 8, 6),       // hex-ish rim
  pylon:     new THREE.CylinderGeometry(0.05 * S, 0.08 * S, 0.5 * S, 5),
  pylonTip:  new THREE.OctahedronGeometry(0.07 * S),
  core:      new THREE.IcosahedronGeometry(0.34 * S, 0),
  ringA:     new THREE.TorusGeometry(0.5 * S, 0.028 * S, 8, 32),
  ringB:     new THREE.TorusGeometry(0.42 * S, 0.022 * S, 8, 28),
  shield:    new THREE.SphereGeometry(0.98 * S, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
};

const HEALTHY = new THREE.Color(0x33ddff);   // cool cyan when strong
const CRITICAL = new THREE.Color(0xff2a14);  // angry red when failing

// soft radial-gradient sprite texture for the core halo (built once, shared)
function buildHaloTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BaseRenderer {
  constructor(scene) {
    this.scene = scene;
    this.cores = [];
    this._halo = buildHaloTexture();
    this._ratio = 1;
  }

  add(q, r) {
    const { x, z } = axialToWorld(q, r);
    const group = new THREE.Group();
    group.position.set(x, TILE_TOP, z);

    const armorMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.7, metalness: 0.55 });
    const armorMat2 = new THREE.MeshStandardMaterial({ color: 0x252f42, roughness: 0.6, metalness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x0e1b24, emissive: HEALTHY.clone(), emissiveIntensity: 1.1, metalness: 0.4, roughness: 0.3 });

    // tiered armored platform
    const tier0 = new THREE.Mesh(G.baseTier, armorMat);  tier0.position.y = 0.09 * S; group.add(tier0);
    const tier1 = new THREE.Mesh(G.midTier, armorMat2);  tier1.position.y = 0.25 * S; group.add(tier1);

    // glowing rim around the platform
    const rim = new THREE.Mesh(G.rim, accentMat);
    rim.rotation.x = Math.PI / 2; rim.rotation.z = Math.PI / 6; rim.position.y = 0.34 * S;
    group.add(rim);

    // six corner pylons at the hex vertices, emissive tips
    const pylonTips = [];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 3) * i + Math.PI / 6;
      const px = Math.cos(ang) * 0.74 * S, pz = Math.sin(ang) * 0.74 * S;
      const pylon = new THREE.Mesh(G.pylon, armorMat2);
      pylon.position.set(px, 0.42 * S, pz);
      group.add(pylon);
      const tip = new THREE.Mesh(G.pylonTip, accentMat);
      tip.position.set(px, 0.68 * S, pz);
      group.add(tip);
      pylonTips.push(tip);
    }

    // ---- containment assembly (the heart) ----
    const coreY = 0.78 * S;
    const coreMat = new THREE.MeshStandardMaterial({ color: HEALTHY.clone(), emissive: HEALTHY.clone(), emissiveIntensity: 1.0, metalness: 0.3, roughness: 0.2 });
    const core = new THREE.Mesh(G.core, coreMat);
    core.position.y = coreY; group.add(core);

    // additive glow halo behind the core
    const haloMat = new THREE.SpriteMaterial({ map: this._halo, color: HEALTHY.clone(), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(1.5 * S); halo.position.y = coreY; group.add(halo);

    // two counter-rotating containment rings (gyroscope)
    const ringMatA = new THREE.MeshStandardMaterial({ color: 0x0e1b24, emissive: HEALTHY.clone(), emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3 });
    const ringMatB = ringMatA.clone();
    const ringA = new THREE.Mesh(G.ringA, ringMatA); ringA.position.y = coreY; group.add(ringA);
    const ringB = new THREE.Mesh(G.ringB, ringMatB); ringB.position.y = coreY; ringB.rotation.x = Math.PI / 2; group.add(ringB);

    // translucent energy shield dome
    const shieldMat = new THREE.MeshStandardMaterial({
      color: HEALTHY.clone(), emissive: HEALTHY.clone(), emissiveIntensity: 0.6,
      transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
      metalness: 0, roughness: 0.4,
    });
    const shield = new THREE.Mesh(G.shield, shieldMat);
    shield.position.y = 0.12 * S; group.add(shield);

    this.scene.add(group);

    const mats = [accentMat, coreMat, haloMat, ringMatA, ringMatB, shieldMat, armorMat, armorMat2];
    const entity = { group, core, halo, ringA, ringB, shield, rim, pylonTips,
      accentMat, coreMat, haloMat, ringMatA, ringMatB, shieldMat, mats, coreY,
      phase: this.cores.length * 1.3 };
    this.cores.push(entity);
    this._applyHealth(entity, this._ratio);
  }

  // Tint + intensity language: cyan (full) -> amber -> red (critical); shield
  // thins as health drops. Called for every base hex.
  _applyHealth(c, r) {
    const col = HEALTHY.clone().lerp(CRITICAL, 1 - r);
    c.coreMat.color.copy(col);
    c.coreMat.emissive.copy(col);
    c.coreMat.emissiveIntensity = 0.5 + r * 0.9;
    c.accentMat.emissive.copy(col); c.accentMat.emissiveIntensity = 0.5 + r * 0.8;
    c.ringMatA.emissive.copy(col);  c.ringMatA.emissiveIntensity = 0.4 + r * 0.7;
    c.ringMatB.emissive.copy(col);  c.ringMatB.emissiveIntensity = 0.4 + r * 0.7;
    c.haloMat.color.copy(col);
    c.shieldMat.color.copy(col); c.shieldMat.emissive.copy(col);
    c.shieldMat.opacity = 0.05 + r * 0.16;          // shield thins as it fails
    c._critical = r < 0.3;
  }

  setHealth(ratio) {
    this._ratio = Math.max(0, Math.min(1, ratio));
    for (const c of this.cores) this._applyHealth(c, this._ratio);
  }

  update() {
    const t = performance.now() * 0.001;
    for (const c of this.cores) {
      const tp = t + c.phase;
      c.core.rotation.y = tp * 0.9;
      c.core.rotation.x = tp * 0.35;
      c.core.position.y = c.coreY + Math.sin(tp * 1.8) * 0.05 * S;
      c.halo.position.y = c.core.position.y;
      // halo + core breathe
      const pulse = 0.85 + Math.sin(tp * 2.4) * 0.15;
      c.halo.scale.setScalar((1.3 + pulse * 0.4) * S);
      c.haloMat.opacity = (0.55 + pulse * 0.35) * (0.5 + this._ratio * 0.5);
      // gyroscopic rings
      c.ringA.rotation.z = tp * 0.8;
      c.ringA.rotation.x = tp * 0.4;
      c.ringB.rotation.y = -tp * 1.1;
      // shield: gentle breathing; flicker hard when critical
      let sOp = c.shieldMat.opacity;
      const breathe = 1 + Math.sin(tp * 1.5) * 0.02;
      c.shield.scale.set(breathe, breathe, breathe);
      if (c._critical) {
        const flick = 0.6 + 0.4 * Math.sin(tp * 31) * Math.sin(tp * 17);
        c.shieldMat.opacity = (0.05 + this._ratio * 0.16) * flick;
        c.accentMat.emissiveIntensity = (0.5 + this._ratio * 0.8) * (0.7 + 0.3 * Math.sin(tp * 23));
      }
    }
  }

  clear() {
    for (const c of this.cores) {
      this.scene.remove(c.group);
      for (const m of c.mats) m.dispose();
    }
    this.cores.length = 0;
  }

  dispose() { this.clear(); if (this._halo) { this._halo.dispose(); this._halo = null; } }
}
