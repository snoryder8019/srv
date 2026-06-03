import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/enemy.js';
let s = fs.readFileSync(F, 'utf8');

// ── DEBUG INSTRUMENTATION (temporary) ─────────────────────────────────────
// Goal: definitively locate why attackers are invisible. We:
//  1) log every spawn + first position fix to the console with counts,
//  2) ALWAYS attach a big, bright, unculled DEBUG CUBE to every enemy root so
//     that even if the GLTF/skinned model is the problem, *something* must show,
//  3) reveal immediately on spawn at a sane Y (don't wait for the first tick),
//  4) expose window.__enemyDebug() to dump live entity state from the console.
// Once we can see cubes, we know the pipeline works and can peel the model back.

if (!s.includes('__ENEMY_DEBUG__')) {
  // a) add a debug-cube geometry/material near the fallback geo
  s = s.replace(
    `const ENEMY_FALLBACK_GEO = new THREE.SphereGeometry(ENEMY_RADIUS, 14, 10);`,
    `const ENEMY_FALLBACK_GEO = new THREE.SphereGeometry(ENEMY_RADIUS, 14, 10);
const __ENEMY_DEBUG__ = true;   // TODO remove once attackers render
const DEBUG_CUBE_GEO = new THREE.BoxGeometry(1.2 * S, 1.2 * S, 1.2 * S);
function makeDebugCube(color = 0xff3366) {
  const m = new THREE.Mesh(DEBUG_CUBE_GEO, new THREE.MeshBasicMaterial({ color }));
  m.frustumCulled = false; m.renderOrder = 997; m.position.y = 0.9 * S; m.name = 'DEBUG_CUBE';
  return m;
}`
  );

  // b) instrument spawn(): log, attach debug cube, reveal immediately
  s = s.replace(
    `    root.visible = false;          // <-- hidden until first position fix (no center flash)
    this.scene.add(root);
    this.entities.set(id, { root, mixer, cfg, type, hpMax, target: null, placed: false, prev: null, yaw: 0, dying: false,
      flying: !!cfg.flying, baseY: root.position.y, phase: Math.random() * Math.PI * 2, bank: 0, isFallback });`,
    `    if (__ENEMY_DEBUG__) {
      // attach a bright cube so SOMETHING is always visible regardless of model state
      root.add(makeDebugCube(model ? 0x33ff88 : 0xff3366));   // green = had model, red = fallback
      root.visible = true;            // reveal immediately at spawn (don't wait for tick)
      console.log('[enemy.spawn]', id, 'type=', type, 'hasModel=', !!model, 'pos=', root.position.x.toFixed(1), root.position.z.toFixed(1), 'totalEntities=', this.entities.size + 1);
    } else {
      root.visible = false;          // <-- hidden until first position fix (no center flash)
    }
    this.scene.add(root);
    this.entities.set(id, { root, mixer, cfg, type, hpMax, target: null, placed: false, prev: null, yaw: 0, dying: false,
      flying: !!cfg.flying, baseY: root.position.y, phase: Math.random() * Math.PI * 2, bank: 0, isFallback });`
  );

  // c) instrument updatePosition(): log the first fix
  s = s.replace(
    `    if (!e.placed) {
      e.root.position.x = x;
      e.root.position.z = z;
      e.prev = { x, z };
      e.root.visible = true;       // reveal now that we know where it goes
      e.placed = true;
    }`,
    `    if (!e.placed) {
      e.root.position.x = x;
      e.root.position.z = z;
      e.prev = { x, z };
      e.root.visible = true;       // reveal now that we know where it goes
      e.placed = true;
      if (__ENEMY_DEBUG__) console.log('[enemy.place]', id, 'world=', x.toFixed(1), z.toFixed(1), 'q,r=', q, r);
    }`
  );

  // d) expose a console helper to dump entity state
  s = s.replace(
    `  clear() { for (const id of [...this.entities.keys()]) this._dispose(id); }`,
    `  debugDump() {
    const out = [];
    for (const [id, e] of this.entities.entries()) {
      out.push({ id, type: e.type, placed: e.placed, visible: e.root.visible,
        x: +e.root.position.x.toFixed(1), y: +e.root.position.y.toFixed(1), z: +e.root.position.z.toFixed(1),
        inScene: !!e.root.parent, children: e.root.children.length });
    }
    console.table(out);
    return out;
  }

  clear() { for (const id of [...this.entities.keys()]) this._dispose(id); }`
  );

  fs.writeFileSync(F, s);
  console.log('enemy.js: DEBUG instrumentation added (bright cubes + console logging)');
} else {
  console.log('debug already present');
}
