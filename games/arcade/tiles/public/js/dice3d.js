/**
 * dice3d.js — a pair of pipped casino dice with REAL rigid-body roll physics,
 * thrown from the current shooter's seat (opts.fromAngle) toward the table center.
 *
 * Orientation is integrated as a QUATERNION from an angular-velocity vector (true
 * rigid tumbling — no Euler gimbal wobble), and the spin axis is coupled to the
 * travel direction so the dice visibly roll forward as they fly and skid. On each
 * felt/rail bounce the angular velocity is kicked + damped. When a die loses
 * energy it slerps from its current orientation to the exact orientation that puts
 * the server's result face up, so the pips always match — but it tumbles to rest
 * instead of snapping.
 *
 *   opts.fromAngle — world XZ angle of the shooter's seat (radians); throw origin.
 *   opts.dur=1     — instant set (reconnect).
 */
import * as THREE from 'three';

export const DIE = 3.2;
const HALF = DIE / 2;

const _pipCache = new Map();
function pipTexture(n) {
  if (_pipCache.has(n)) return _pipCache.get(n);
  const S = 128, cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const c = cvs.getContext('2d');
  c.fillStyle = '#f6f1e4'; c.fillRect(0, 0, S, S);
  const grad = c.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, 'rgba(255,255,255,.5)'); grad.addColorStop(1, 'rgba(0,0,0,.06)');
  c.fillStyle = grad; c.fillRect(0, 0, S, S);
  c.strokeStyle = '#d9d2bd'; c.lineWidth = 4; c.strokeRect(5, 5, S - 10, S - 10);
  const r = 13, q = S / 4, m = S / 2;
  const P = { tl: [q, q], tr: [S - q, q], ml: [q, m], mr: [S - q, m], c: [m, m], bl: [q, S - q], br: [S - q, S - q] };
  const layout = { 1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'], 4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'] };
  for (const k of layout[n]) {
    const [x, y] = P[k];
    const g2 = c.createRadialGradient(x - 3, y - 3, 1, x, y, r);
    g2.addColorStop(0, '#3a3a3a'); g2.addColorStop(1, '#0c0c0c');
    c.fillStyle = g2; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  _pipCache.set(n, tex); return tex;
}

// Face material order on a BoxGeometry is [+X,-X,+Y,-Y,+Z,-Z]. We choose values so
// opposite faces sum to 7 and we know which local axis carries which value.
const FACE_VALS = [3, 4, 1, 6, 2, 5];   // +X=3 -X=4 +Y=1 -Y=6 +Z=2 -Z=5
export function buildDie() {
  const geo = new THREE.BoxGeometry(DIE, DIE, DIE);
  const mats = FACE_VALS.map((v) => new THREE.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.42, metalness: 0.02 }));
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true;
  return mesh;
}

// The local-space outward normal of the face showing each value.
const FACE_NORMAL = {
  3: new THREE.Vector3(1, 0, 0), 4: new THREE.Vector3(-1, 0, 0),
  1: new THREE.Vector3(0, 1, 0), 6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(0, 0, 1), 5: new THREE.Vector3(0, 0, -1),
};
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Quaternion that orients the die so `value`'s face points up (+Y), with an extra
 * yaw spin around Y so the resting die has a natural random heading.
 */
function restQuaternion(value, yaw) {
  const n = FACE_NORMAL[value];
  // rotation that takes the face normal onto +Y
  const q = new THREE.Quaternion().setFromUnitVectors(n.clone(), UP);
  // then apply a yaw about world-Y
  const qy = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  return qy.multiply(q);
}

export function rollDice(group, result, opts = {}) {
  for (const m of group.children.slice()) group.remove(m);
  const [d1, d2] = result;
  const targets = [d1, d2];
  const dice = [buildDie(), buildDie()];
  const restY = HALF + 0.4;
  const FELT = restY;
  const instant = opts.dur === 1;

  const fromAngle = (typeof opts.fromAngle === 'number') ? opts.fromAngle : Math.PI / 2;
  const LAUNCH_R = 22;
  const inX = -Math.cos(fromAngle), inZ = -Math.sin(fromAngle);   // toward center
  const tanX = -Math.sin(fromAngle), tanZ = Math.cos(fromAngle);  // tangent
  const FAR_R = 13;
  const RAIL = 24;

  if (instant) {
    dice.forEach((die, i) => {
      const cx = Math.cos(fromAngle) * 4 + tanX * (i === 0 ? -2.5 : 2.5);
      const cz = Math.sin(fromAngle) * 4 + tanZ * (i === 0 ? -2.5 : 2.5);
      die.position.set(cx, restY, cz);
      die.quaternion.copy(restQuaternion(targets[i], (i === 0 ? -0.3 : 0.4)));
      group.add(die);
    });
    if (opts.onDone) opts.onDone();
    return;
  }

  const bodies = dice.map((die, i) => {
    const side = (i === 0 ? -1 : 1) * 3.0;
    const sx = Math.cos(fromAngle) * LAUNCH_R + tanX * side;
    const sz = Math.sin(fromAngle) * LAUNCH_R + tanZ * side;
    die.position.set(sx, 10 + Math.random() * 3, sz);
    die.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    group.add(die);
    const speed = 22 + Math.random() * 8;
    const v = new THREE.Vector3(
      inX * speed + tanX * (Math.random() - 0.5) * 6,
      2 + Math.random() * 3,
      inZ * speed + tanZ * (Math.random() - 0.5) * 6
    );
    // angular velocity: primarily a roll about the axis perpendicular to travel
    // (horizontal, cross(up, velocityDir)) so the die rolls FORWARD, plus some
    // random tumble on the other axes.
    const vdir = v.clone().setY(0).normalize();
    const rollAxis = new THREE.Vector3().crossVectors(UP, vdir).normalize();
    const rollRate = speed * 0.9;     // couple spin to speed → rolls as it travels
    const w = rollAxis.multiplyScalar(rollRate)
      .add(new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8));
    return { die, v, w, settled: false, settleT: 0, restQ: null, restPos: new THREE.Vector3() };
  });

  const G = -58;
  const REST = 0.46;
  const FRICTION = 0.86;
  const ANG_DAMP = 1.6;             // angular damping per second (continuous)
  const speedScale = 1 / (opts.dur ? Math.max(0.5, opts.dur / 700) : 1);

  const _dq = new THREE.Quaternion();
  const _axis = new THREE.Vector3();

  // integrate orientation: q += 0.5 * w(quat) * q, normalized — done via axis-angle
  function integrateSpin(die, w, dt) {
    const wlen = w.length();
    if (wlen < 1e-5) return;
    _axis.copy(w).multiplyScalar(1 / wlen);
    _dq.setFromAxisAngle(_axis, wlen * dt);
    die.quaternion.premultiply(_dq);   // world-space spin
    die.quaternion.normalize();
  }

  let last = performance.now();
  let allSettledAt = 0;

  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000) * speedScale;
    last = now;

    let moving = 0;
    for (const b of bodies) {
      if (b.settled) {
        // tumble to rest: slerp orientation + ease position to the resting pose
        b.settleT = Math.min(1, b.settleT + dt * 3.4);
        const e = 1 - Math.pow(1 - b.settleT, 3);
        b.die.quaternion.slerp(b.restQ, Math.min(1, e * 0.6));
        b.die.position.lerp(b.restPos, Math.min(1, e * 0.5));
        if (b.settleT < 1) moving++;
        continue;
      }
      moving++;
      // linear
      b.v.y += G * dt;
      b.die.position.addScaledVector(b.v, dt);
      // angular (rigid quaternion integration) + damping
      integrateSpin(b.die, b.w, dt);
      b.w.multiplyScalar(Math.exp(-ANG_DAMP * dt));

      // felt bounce
      if (b.die.position.y <= FELT) {
        b.die.position.y = FELT;
        if (Math.abs(b.v.y) > 4) {
          b.v.y = -b.v.y * REST;
          b.v.x *= FRICTION; b.v.z *= FRICTION;
          // a bounce reorients the spin toward rolling along the new ground velocity
          const vdir = b.v.clone().setY(0);
          if (vdir.lengthSq() > 0.01) {
            vdir.normalize();
            const rollAxis = new THREE.Vector3().crossVectors(UP, vdir).normalize();
            b.w.lerp(rollAxis.multiplyScalar(b.v.length() * 0.7), 0.5);
          }
          b.w.multiplyScalar(0.7);
          b.w.x += (Math.random() - 0.5) * 4; b.w.z += (Math.random() - 0.5) * 4;
        } else {
          // low energy → choose the resting orientation (server result face-up)
          b.v.set(0, 0, 0);
          b.settled = true; b.settleT = 0;
          let rx = b.die.position.x, rz = b.die.position.z;
          const dist = Math.hypot(rx, rz);
          if (dist > FAR_R) { rx = rx / dist * FAR_R; rz = rz / dist * FAR_R; }
          b.restQ = restQuaternion(targets[bodies.indexOf(b)], (Math.random() - 0.5) * 1.2);
          b.restPos.set(rx, FELT, rz);
        }
      }
      // circular rail bounce
      const rr = Math.hypot(b.die.position.x, b.die.position.z);
      if (rr > RAIL) {
        const nx = b.die.position.x / rr, nz = b.die.position.z / rr;
        b.die.position.x = nx * RAIL; b.die.position.z = nz * RAIL;
        const vdot = b.v.x * nx + b.v.z * nz;
        b.v.x -= 2 * vdot * nx; b.v.z -= 2 * vdot * nz;
        b.v.multiplyScalar(REST);
        b.w.multiplyScalar(0.8); b.w.y += (Math.random() - 0.5) * 6;
      }
    }

    // soft separation so dice don't overlap
    if (bodies.length === 2) {
      const a = bodies[0].die.position, c = bodies[1].die.position;
      const dx = c.x - a.x, dz = c.z - a.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      if (dist < DIE) {
        const push = (DIE - dist) / 2;
        const nx = dx / dist, nz = dz / dist;
        if (!bodies[0].settled) { a.x -= nx * push; a.z -= nz * push; }
        if (!bodies[1].settled) { c.x += nx * push; c.z += nz * push; }
      }
    }

    if (moving > 0) { allSettledAt = 0; requestAnimationFrame(frame); }
    else {
      if (!allSettledAt) allSettledAt = now;
      if (now - allSettledAt < 80) requestAnimationFrame(frame);
      else {
        // hard-lock to exact rest pose
        for (const b of bodies) { if (b.restQ) { b.die.quaternion.copy(b.restQ); b.die.position.copy(b.restPos); } }
        if (opts.onDone) opts.onDone();
      }
    }
  }
  requestAnimationFrame(frame);
}
