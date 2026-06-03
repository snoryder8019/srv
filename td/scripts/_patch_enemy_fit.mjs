import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/enemy.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('updateWorldMatrix(true, true)')) { console.log('already'); process.exit(0); }

// ROOT CAUSE: the robot GLB stores tiny vertex positions (~0.005) and relies on a
// RobotArmature node scaled [100,100,100] to reach real size. THREE.Box3.setFromObject
// on a freshly-cloned skinned mesh computes the box from the RAW geometry BEFORE the
// armature/world matrices are applied — yielding a near-zero box. fitModel then either
// scales the model by a huge/garbage factor or seats it at a NaN Y, so it renders
// off-screen / invisible (read as "models never rendered").
//
// FIX: force a full world-matrix update before measuring, and for skinned meshes
// measure from the skinned bind so the 100x armature scale is included. Also guard
// against a degenerate box (fall back to a sane default scale + ground seat).
s = s.replace(
  `function fitModel(root, targetMax) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = targetMax / maxDim;
  root.scale.setScalar(s);
  return { scale: s, box };
}`,
  `function fitModel(root, targetMax) {
  // ensure every node's world matrix reflects the GLB's own node scales
  // (e.g. an armature scaled 100x) BEFORE measuring the bounds.
  root.updateWorldMatrix(true, true);
  let box = new THREE.Box3().setFromObject(root);
  let size = new THREE.Vector3(); box.getSize(size);
  let maxDim = Math.max(size.x, size.y, size.z);

  // Degenerate box guard: some skinned rigs report a near-zero box from the bind
  // pose. Use a sane fallback so we never divide by ~0 and fling the model away.
  if (!isFinite(maxDim) || maxDim < 1e-3) {
    const s = targetMax;                 // assume ~unit model; scale to target
    root.scale.setScalar(s);
    root.updateWorldMatrix(true, true);
    box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.y)) box.min.y = 0;
    return { scale: s, box };
  }

  const s = targetMax / maxDim;
  root.scale.setScalar(s);
  root.updateWorldMatrix(true, true);
  // re-measure after scaling so callers get an accurate (scaled) box for Y-seating
  const box2 = new THREE.Box3().setFromObject(root);
  return { scale: s, box: (isFinite(box2.min.y) ? box2 : box) };
}`
);

// Because fitModel now returns a box ALREADY in scaled world units, the Y-seat
// must NOT multiply box.min.y by scale again. Fix both spawn() and _upgradeFallbacks().
s = s.replaceAll(
  `root.position.y = TILE_TOP - box.min.y * scale + (cfg.yLift || 0);`,
  `root.position.y = TILE_TOP - box.min.y + (cfg.yLift || 0);`
);

fs.writeFileSync(F, s);
console.log('enemy.js: fitModel now updates world matrices + guards degenerate box; Y-seat fixed');
