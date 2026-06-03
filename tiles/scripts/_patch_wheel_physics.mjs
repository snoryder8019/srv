/**
 * Rewrite spinTo() in wheel3d.js with a reactive ball drop:
 *   • orbit: ball rides the lip, shedding angular speed to drag
 *   • drop:  when it slows past holding speed (or time), gravity pulls it off the
 *            lip; it spirals in and falls onto the track
 *   • scatter: it strikes frets — each contact bounces it up, the spinning wheel
 *            drags its angular velocity, fret hits kick/scatter it, energy bleeds
 *   • settle: low-energy, co-rotating with the wheel — eased into the exact
 *            painted pocket so the server result is honored, then locked
 * Integrated with dt so the motion genuinely reacts to the drop.
 */
import fs from 'fs';
const F = '/srv/tiles/public/js/wheel3d.js';
let s = fs.readFileSync(F, 'utf8');

const startIdx = s.indexOf('export function spinTo(group, pocket, opts = {}) {');
const endMarker = '\nexport { colorOf };';
const endIdx = s.indexOf(endMarker);
if (startIdx < 0 || endIdx < 0) { console.log('anchors not found'); process.exit(1); }
const head = s.slice(0, startIdx);

const newFn = `export function spinTo(group, pocket, opts = {}) {
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
`;

s = head + newFn + s.slice(endIdx);
fs.writeFileSync(F, s);
console.log('spinTo rewritten with reactive drop physics (guaranteed settle)');
