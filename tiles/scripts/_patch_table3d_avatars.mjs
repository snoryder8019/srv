import fs from 'fs';
const F = '/srv/tiles/public/js/table3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('setSeatAvatar')) { console.log('already'); process.exit(0); }

// 1) import the avatar builder
s = s.replace(
  `import { OrbitControls } from 'three/addons/controls/OrbitControls.js';`,
  `import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\nimport { buildAvatar } from './avatar3d.js';`
);

// 2) in buildSeats, add an avatar to each seat group, facing the table centre.
//    The seat sits at (x,z); the avatar should face inward (toward 0,0). We place
//    it just behind the disc (pushed outward a touch) and rotate to look at centre.
s = s.replace(
  `      const sp = makeLabelSprite(); sp.position.set(x, 3.0, z); g.add(sp);
      SEAT_GROUP.add(g);
      seatNodes.push({ group: g, disc, sprite: sp, angle, seat: i, x, z });`,
  `      const sp = makeLabelSprite(); sp.position.set(x, 3.0, z); g.add(sp);
      // low-poly seated avatar, hidden until a player/bot occupies the seat
      const av = buildAvatar({ seat: i, seatColor: 0x2f7fe0, scale: 1.15 });
      // sit slightly outside the disc so the figure leans over the rail
      const outX = Math.cos(angle) * (Rr + 1.6), outZ = Math.sin(angle) * (Rr + 1.6);
      av.position.set(outX, 0, outZ);
      av.rotation.y = Math.atan2(-outX, -outZ);   // face the table centre (0,0)
      av.visible = false;
      g.add(av);
      SEAT_GROUP.add(g);
      seatNodes.push({ group: g, disc, sprite: sp, avatar: av, angle, seat: i, x, z });`
);

// 3) add setSeatAvatar + drive avatar animation each frame. Insert helpers after
//    seatAngleOf.
s = s.replace(
  `  function seatAngleOf(i) { const n = seatNodes[i]; return n ? n.angle : 0; }`,
  `  function seatAngleOf(i) { const n = seatNodes[i]; return n ? n.angle : 0; }
  // Show/hide + recolour a seat's avatar. info: { present, color, active }
  function setSeatAvatar(i, info = {}) {
    const node = seatNodes[i]; if (!node || !node.avatar) return;
    const av = node.avatar;
    av.visible = info.present !== false;
    if (typeof info.color === 'number') {
      // retint the jacket/shoulders/arm-upper (the seat-colour parts)
      av.traverse((o) => {
        if (o.isMesh && o.material && o.userData && o.userData.body) o.material.color.setHex(info.color);
      });
      // simpler: mark body meshes on first call (jacket = torso + shoulders + upper arms)
    }
    if (av.userData && av.userData.anim) av.userData.anim.setActive(!!info.active);
  }
  function seatAvatar(i) { const n = seatNodes[i]; return n ? n.avatar : null; }`
);

// 4) drive avatar idle/turn animation in the tick loop (dt is in ms -> seconds)
s = s.replace(
  `    for (const fn of _frameHooks) { try { fn(now, dt); } catch (e) {} }
    renderer.render(scene, camera);`,
  `    const dts = dt / 1000;
    for (const n of seatNodes) {
      if (n.avatar && n.avatar.visible && n.avatar.userData && n.avatar.userData.anim) {
        n.avatar.userData.anim.update(dts);
      }
    }
    for (const fn of _frameHooks) { try { fn(now, dt); } catch (e) {} }
    renderer.render(scene, camera);`
);

// 5) export the new helpers
s = s.replace(
  `    buildSeats, updateSeat, seatPosition, seatAngleOf, seatNodes,`,
  `    buildSeats, updateSeat, seatPosition, seatAngleOf, seatNodes, setSeatAvatar, seatAvatar,`
);

fs.writeFileSync(F, s);
console.log('table3d: avatars built per seat + setSeatAvatar + per-frame anim wired');
