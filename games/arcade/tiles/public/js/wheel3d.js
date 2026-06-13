/**
 * wheel3d.js — a European roulette wheel (37 pockets) read from above.
 *
 * The wheel HEAD (number ring + frets + pocket floor + hub + BALL) all live in
 * one rotating group, so the ball genuinely sits IN its pocket and rides with the
 * wheel — no frame mismatch. A pocket's local angle is `idx * SEG` measured from
 * +X in the head's frame; the ring texture paints each number at that same angle,
 * so number, fret, and ball all line up.
 *
 * spinTo(group, pocket, opts) animates the ball orbiting the lip, dropping,
 * tapping frets, and trickling into the pocket; the head decelerates to rest.
 */
import * as THREE from 'three';

export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const N = WHEEL_ORDER.length;
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function colorOf(n) { return n === 0 ? '#2f8f5b' : (RED.has(n) ? '#b5482f' : '#15171a'); }

const R_OUT = 13, R_IN = 7.0, WHEEL_Y = 1.2;
const SEG = (Math.PI * 2) / N;

// pocket idx -> local angle in the head frame (measured from +X, CCW). The Circle
// geometry's first vertex is at +X; a flat plane laid by rotation.x=-PI/2 maps
// canvas angle θ (atan2 from +X) to local world angle θ around +Y. We paint the
// texture in the SAME convention so paint, fret, and ball seat all agree.
function pocketAngle(idx) { return idx * SEG; }

// Top-facing ring texture. Canvas pixel angle measured from +X (screen-right);
// because the plane is rotated -PI/2 about X, +X stays +X and +Y(canvas) maps to
// +Z(world). We paint wedge idx centered at idx*SEG so it matches pocketAngle().
function topRingTexture() {
  const S = 1024, cx = S / 2, cy = S / 2;
  const cvs = document.createElement('canvas'); cvs.width = S; cvs.height = S;
  const c = cvs.getContext('2d');
  c.clearRect(0, 0, S, S);
  const rOut = S * 0.5, rIn = S * 0.30;
  for (let i = 0; i < N; i++) {
    const num = WHEEL_ORDER[i];
    const mid = i * SEG;                    // center angle of this wedge (matches pocketAngle)
    const a0 = mid - SEG / 2, a1 = mid + SEG / 2;
    c.beginPath(); c.moveTo(cx, cy);
    c.arc(cx, cy, rOut, a0, a1); c.closePath();
    c.fillStyle = colorOf(num); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.stroke();
    // number, oriented to read from rim toward center
    c.save();
    c.translate(cx + Math.cos(mid) * (rOut + rIn) / 2, cy + Math.sin(mid) * (rOut + rIn) / 2);
    c.rotate(mid + Math.PI / 2);
    c.fillStyle = '#f6efe0'; c.font = 'bold 42px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(num), 0, 0);
    c.restore();
  }
  c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.arc(cx, cy, rIn, 0, Math.PI * 2); c.fill();
  c.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

export function buildWheel() {
  const g = new THREE.Group();

  // static bowl + lip
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(R_OUT + 3.2, R_OUT + 4.2, 2.4, 64),
    new THREE.MeshStandardMaterial({ color: 0x3b2417, roughness: 0.6 }));
  bowl.position.y = WHEEL_Y - 0.7; bowl.receiveShadow = true; g.add(bowl);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R_OUT + 1.4, 0.7, 16, 80),
    new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.4, metalness: 0.2 }));
  lip.rotation.x = -Math.PI / 2; lip.position.y = WHEEL_Y + 1.9; g.add(lip);

  // rotating head — ring + frets + floor + hub + BALL all parented here
  const head = new THREE.Group(); head.position.y = WHEEL_Y; g.add(head);

  const ring = new THREE.Mesh(new THREE.CircleGeometry(R_OUT, 96),
    new THREE.MeshStandardMaterial({ map: topRingTexture(), roughness: 0.5, transparent: true }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 1.42; head.add(ring);

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R_OUT, R_IN, 1.2, 96),
    new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.7 }));
  floor.position.y = 0.8; head.add(floor);

  const fretMat = new THREE.MeshStandardMaterial({ color: 0xcdbf8f, roughness: 0.3, metalness: 0.6 });
  const rmid = (R_OUT + R_IN) / 2;
  for (let i = 0; i < N; i++) {
    const a = i * SEG - SEG / 2;            // fret sits on the boundary between pockets
    const fret = new THREE.Mesh(new THREE.BoxGeometry(R_OUT - R_IN, 0.6, 0.16), fretMat);
    fret.position.set(Math.cos(a) * rmid, 1.55, Math.sin(a) * rmid);
    fret.rotation.y = -a;
    head.add(fret);
  }

  const hub = new THREE.Mesh(new THREE.ConeGeometry(R_IN, 3.4, 48),
    new THREE.MeshStandardMaterial({ color: 0xc9a24b, roughness: 0.3, metalness: 0.5 }));
  hub.position.y = 2.5; head.add(hub);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 2.0, 16),
    new THREE.MeshStandardMaterial({ color: 0xe8d48a, roughness: 0.25, metalness: 0.7 }));
  turret.position.y = 4.2; head.add(turret);

  // BALL — parented to the head so when it seats it rides with the wheel + numbers.
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xf6f1e4, roughness: 0.15, metalness: 0.1 }));
  ball.position.set(R_OUT, 2.6, 0); ball.castShadow = true; head.add(ball);

  g.userData = { head, ring, ball, rim: head };
  return g;
}

/**
 * Animate the ball into `pocket`. The ball is in the HEAD frame; its resting
 * local angle is exactly pocketAngle(idx). During flight we counter-rotate the
 * ball's local angle against the head's spin so it visually orbits the static
 * world while the head turns underneath, then we release it to ride the pocket.
 */
export function spinTo(group, pocket, opts = {}) {
  const { head, ball } = group.userData;
  const idx = WHEEL_ORDER.indexOf(pocket);
  const seatLocal = pocketAngle(idx);
  const instant = opts.dur === 1;

  const R_LIP = R_OUT + 1.2;
  const R_SEAT = (R_OUT + R_IN) / 2;
  const R_FRET = (R_OUT + R_IN) / 2 + 0.4;
  const yLip = 2.6;
  const ySeat = 1.7;
  const yFretTop = 2.05;

  const place = (worldAng, r, y) => {
    const localAng = worldAng - head.rotation.y;
    ball.position.set(Math.cos(localAng) * r, y, Math.sin(localAng) * r);
  };

  if (instant) {
    head.rotation.y = 0;
    ball.position.set(Math.cos(seatLocal) * R_SEAT, ySeat, Math.sin(seatLocal) * R_SEAT);
    if (opts.onDone) opts.onDone();
    return;
  }

  const totalMs = opts.dur || 6000;
  let headW = (3.2 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1);
  const headDamp = 0.34;
  let ballAng = Math.random() * Math.PI * 2;
  let ballW = -Math.sign(headW) * (11 + Math.random() * 3);
  let r = R_LIP, rV = 0;
  let y = yLip, yV = 0;
  let phase = 'orbit';
  let lastTap = 0;
  let settleProgress = 0;

  const start = performance.now();
  let last = start;
  let done = false;

  function frame(now) {
    let dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    const elapsed = now - start;

    headW *= Math.exp(-headDamp * dt);
    head.rotation.y += headW * dt;

    if (phase === 'orbit') {
      ballW *= Math.exp(-0.55 * dt);
      ballAng += ballW * dt;
      if (Math.abs(ballW) < 4.4 || elapsed > totalMs * 0.5) { phase = 'drop'; yV = 0; }
      place(ballAng, r, y);
    } else if (phase === 'drop') {
      ballW *= Math.exp(-0.7 * dt);
      ballAng += ballW * dt;
      rV += (-(r - R_FRET)) * 6 * dt; rV *= Math.exp(-2.0 * dt); r += rV * dt;
      yV += -26 * dt; y += yV * dt;
      if (y <= yFretTop) {
        y = yFretTop; yV = Math.abs(yV) * 0.42; phase = 'scatter';
        if (opts.onTap) opts.onTap();
        ballW += (headW - ballW) * 0.25;
      }
      place(ballAng, r, y);
    } else if (phase === 'scatter') {
      ballW += (headW - ballW) * 1.6 * dt;     // dragged toward wheel speed
      ballAng += ballW * dt;
      yV += -26 * dt; y += yV * dt;
      if (y <= ySeat) {
        y = ySeat;
        if (Math.abs(yV) > 1.2) {
          yV = Math.abs(yV) * 0.38;
          if (now - lastTap > 60) { lastTap = now; if (opts.onTap) opts.onTap(); }
          ballW += (Math.random() - 0.5) * 3.0;
        } else { yV = 0; }
      }
      const relW = Math.abs(ballW - headW);
      if ((relW < 1.2 && Math.abs(yV) < 0.5) || elapsed > totalMs * 0.9) {
        phase = 'settle'; settleProgress = 0;
        // snap ballAng to the nearest revolution of the pocket's current world angle
        const want = seatLocal + head.rotation.y;
        const k = Math.round((ballAng - want) / (Math.PI * 2));
        ballAng = want + k * Math.PI * 2;        // continuous, no visible jump (nearest rev)
      }
      place(ballAng, r, y);
    } else { // settle — ride the pocket; converge the small remaining offset, guaranteed finish
      settleProgress += dt;
      const target = seatLocal + head.rotation.y;   // tracks the drifting wheel
      const blend = Math.min(1, 9 * dt);
      ballAng += (target - ballAng) * blend;
      r += (R_SEAT - r) * Math.min(1, 9 * dt);
      yV += -26 * dt; y += yV * dt;
      if (y <= ySeat) { y = ySeat; yV = Math.abs(yV) > 0.4 ? Math.abs(yV) * 0.3 : 0; }
      place(ballAng, r, y);
      // finish when aligned + low bounce, or after a hard cap
      if ((Math.abs(target - ballAng) < 0.02 && Math.abs(yV) < 0.05) || settleProgress > 1.2) {
        ball.position.set(Math.cos(seatLocal) * R_SEAT, ySeat, Math.sin(seatLocal) * R_SEAT);
        if (!done && opts.onDone) { done = true; opts.onDone(); }
        return;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export { colorOf };
