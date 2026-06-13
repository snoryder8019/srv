import fs from 'fs';
const F = '/srv/td/public/javascripts/game/play.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('isHunting')) { console.log('already'); process.exit(0); }

// 1) import the tactical helpers + THREE for raycasting
s = s.replace(
  `import { initTactical } from './tactical.js';`,
  `import { initTactical, isHunting, exposeEnemy } from './tactical.js';\nimport * as THREE from 'three';`
);

// 2) at the top of pointerup (after computing it's a tap), if hunting, raycast
//    enemies and expose the tapped one — takes precedence over placement.
s = s.replace(
  `  if (dist > TAP_MAX_PX || dt > TAP_MAX_MS) return;

  // Action-card apply mode takes precedence over placement.`,
  `  if (dist > TAP_MAX_PX || dt > TAP_MAX_MS) return;

  // HUNT MODE (tactical pause): tap a unit on the board to expose the infiltrator.
  if (isHunting()) {
    const picked = pickEnemy(e);
    if (picked) { exposeEnemy(picked); return; }
    // tapped empty ground while hunting — ignore (don't place towers mid-hunt)
    return;
  }

  // Action-card apply mode takes precedence over placement.`
);

// 3) add a pickEnemy raycaster near pickHex usage (before the pointerup listener)
s = s.replace(
  `// ---- Tap-vs-drag input: tap = place tower / apply card; drag = camera -----`,
  `// Raycast the tap against enemy model roots; returns the entity id or null.
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function pickEnemy(ev) {
  const rect = host.getBoundingClientRect();
  _ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1,
           -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  // build a list of enemy roots, remembering which id each belongs to
  const roots = [];
  for (const [id, ent] of enemyRenderer.entities.entries()) {
    if (ent.root) { ent.root.userData.__enemyId = id; roots.push(ent.root); }
  }
  const hits = _ray.intersectObjects(roots, true);
  if (!hits.length) return null;
  // walk up to the root that carries our id
  let o = hits[0].object;
  while (o && o.userData.__enemyId == null) o = o.parent;
  return o ? o.userData.__enemyId : null;
}

// ---- Tap-vs-drag input: tap = place tower / apply card; drag = camera -----`
);

fs.writeFileSync(F, s);
console.log('play.js: board-tap-to-expose wired (pickEnemy raycaster + hunt branch)');
