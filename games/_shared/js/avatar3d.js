/**
 * avatar3d.js — low-poly casino-patron figures that sit at each seat.
 *
 * buildAvatar(opts) returns a THREE.Group whose local origin is the seat point on
 * the floor (feet/base at y≈0). The group's rotation.y is used by the caller to
 * face the figure toward the table; ALL animation (breathing, lean, reactions)
 * happens on an INNER group so it never fights the facing rotation.
 *
 * group.userData.anim hooks:
 *   • idle breathing (subtle bob)
 *   • setActive(on): lean-in + arms onto the rail when it's this seat's turn
 *   • cheer()/slump(): brief win / loss reactions
 *
 * Cheap: a handful of meshes per avatar, shared geometry. Flat MeshStandard colours.
 */
import * as THREE from 'three';

// shared geometry (created once, reused across every avatar)
const G = {
  head: new THREE.SphereGeometry(0.62, 20, 16),
  torso: new THREE.CylinderGeometry(0.78, 0.98, 2.0, 18),
  shoulder: new THREE.SphereGeometry(0.42, 14, 12),
  upperArm: new THREE.CylinderGeometry(0.24, 0.22, 1.0, 12),
  foreArm: new THREE.CylinderGeometry(0.2, 0.18, 0.95, 12),
  hand: new THREE.SphereGeometry(0.24, 12, 10),
  neck: new THREE.CylinderGeometry(0.26, 0.3, 0.34, 12),
  hairCap: new THREE.SphereGeometry(0.64, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
  seatPad: new THREE.CylinderGeometry(1.05, 1.05, 0.3, 20),
};

const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68642, 0x8d5524, 0xffe0bd, 0xd9a066];
const HAIR = [0x2b1b10, 0x55340f, 0x111111, 0x6b6b6b, 0xd9c27a, 0x7a3b2e];

function mat(color, rough = 0.7, metal = 0.0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

export function buildAvatar(opts = {}) {
  const seat = opts.seat || 0;
  const bodyColor = (typeof opts.seatColor === 'number') ? opts.seatColor : 0x2f7fe0;
  const skin = SKIN[seat % SKIN.length];
  const hair = HAIR[(seat * 3 + 1) % HAIR.length];

  // OUTER group: only positioned + rotated.y (facing) by the caller. Never animated.
  const grp = new THREE.Group();
  // INNER group: all animation lives here (lean tilt about X, bob about Y). Because
  // it is a child of the (already-rotated) outer group, a lean on its local X always
  // tilts the figure toward whatever direction it faces — no gimbal fight.
  const body = new THREE.Group();
  grp.add(body);

  // seat cushion
  const pad = new THREE.Mesh(G.seatPad, mat(0x14241c, 0.9));
  pad.position.y = 0.15; pad.receiveShadow = true;
  body.add(pad);

  // torso (jacket = seat colour)
  const torso = new THREE.Mesh(G.torso, mat(bodyColor, 0.6)); torso.userData.body = true;
  torso.position.y = 1.5; torso.castShadow = true;
  body.add(torso);

  // neck + head + hair
  const neck = new THREE.Mesh(G.neck, mat(skin, 0.7)); neck.position.y = 2.55; body.add(neck);
  const head = new THREE.Mesh(G.head, mat(skin, 0.65)); head.position.y = 3.05; head.castShadow = true; body.add(head);
  const hairCap = new THREE.Mesh(G.hairCap, mat(hair, 0.85)); hairCap.position.y = 3.16; body.add(hairCap);

  // arms — pivot at shoulder; +Z is the facing/forward direction (toward the table)
  function arm(side) {
    const s = side === 'L' ? -1 : 1;
    const pivot = new THREE.Group();
    pivot.position.set(0.92 * s, 2.25, 0);
    const sh = new THREE.Mesh(G.shoulder, mat(bodyColor, 0.6)); sh.userData.body = true; pivot.add(sh);
    const up = new THREE.Mesh(G.upperArm, mat(bodyColor, 0.6)); up.userData.body = true;
    up.position.set(0.1 * s, -0.5, 0.15); up.rotation.z = 0.5 * s; up.rotation.x = -0.5; up.castShadow = true;
    pivot.add(up);
    const fo = new THREE.Mesh(G.foreArm, mat(skin, 0.7));
    fo.position.set(0.22 * s, -1.0, 0.7); fo.rotation.x = -1.1; fo.castShadow = true;
    pivot.add(fo);
    const hand = new THREE.Mesh(G.hand, mat(skin, 0.7));
    hand.position.set(0.28 * s, -1.25, 1.25); pivot.add(hand);
    pivot.rotation.x = 0.15;   // resting: hands a little forward
    body.add(pivot);
    return pivot;
  }
  const armL = arm('L'), armR = arm('R');

  grp.scale.setScalar(opts.scale || 1);

  // ---- animation (all targets are eased toward; nothing is set abruptly) ----
  const REST_ARM = 0.15;
  const anim = {
    t: Math.random() * 10,
    active: false,
    react: 0,                 // seconds remaining; sign = cheer(+)/slump(-)
    // current smoothed values
    lean: 0, armL: REST_ARM, armR: REST_ARM, bob: 0,
    update(dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.05);            // clamp spikes (tab refocus) -> no jumps
      this.t += dt;
      const k = 1 - Math.pow(0.001, dt);  // frame-rate-independent smoothing factor

      // targets depend on state
      let leanTarget = this.active ? 0.14 : 0.0;
      let armTargetL = this.active ? -0.3 : REST_ARM;
      let armTargetR = this.active ? -0.3 : REST_ARM;
      let bobAmp = 0.025;                  // gentle idle breathing
      let bobFreq = 1.4;

      if (this.react > 0) {               // CHEER
        this.react = Math.max(0, this.react - dt);
        leanTarget = -0.08;               // lean back, arms up
        armTargetL = -1.4; armTargetR = -1.4;
        bobAmp = 0.12; bobFreq = 5.0;
      } else if (this.react < 0) {        // SLUMP
        this.react = Math.min(0, this.react + dt);
        leanTarget = 0.30;                // head down
        bobAmp = 0.0;
      }

      // ease everything (smooth, no glitch)
      this.lean += (leanTarget - this.lean) * k;
      this.armL += (armTargetL - this.armL) * k;
      this.armR += (armTargetR - this.armR) * k;
      const targetBob = Math.sin(this.t * bobFreq) * bobAmp;
      this.bob += (targetBob - this.bob) * Math.min(1, dt * 10);

      // apply
      body.rotation.x = this.lean;
      body.position.y = this.bob;         // whole body bob (cheap, no per-part writes)
      armL.rotation.x = this.armL;
      armR.rotation.x = this.armR;
    },
    setActive(on) { this.active = !!on; },
    cheer() { this.react = 1.0; },
    slump() { this.react = -0.8; },
  };
  grp.userData = { anim, kind: 'avatar', seat };
  return grp;
}

export default { buildAvatar };
