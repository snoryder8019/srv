import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/enemy.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('frustumCulled = false')) { console.log('already'); process.exit(0); }

// Skinned GLTF meshes cloned via SkeletonUtils keep a bounding sphere computed at
// the tiny bind-pose scale, so Three.js frustum-CULLS them (treats them as an
// off-screen speck) — towers can still target the logical enemy, but nothing
// renders. Disable frustum culling on every child mesh of a cloned enemy, and
// force the skinned bounds to recompute. Helper applied right after each clone.
s = s.replace(
  `function fitModel(root, targetMax) {`,
  `// Make a cloned enemy reliably visible: no frustum culling (skinned bind-pose
// bounds are wrong), ensure it casts/receives nothing weird, and recompute any
// skinned mesh bounds so shadows/raycasts behave.
function prepEnemyRoot(root) {
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.isSkinnedMesh && typeof o.computeBoundingSphere === 'function') {
        try { o.computeBoundingSphere(); } catch (e) {}
      }
    }
  });
  return root;
}

function fitModel(root, targetMax) {`
);

// call prepEnemyRoot right after both clones
s = s.replace(
  `      root = cfg.skinned ? skeletonClone(model.scene) : model.scene.clone(true);
      const { box, scale } = fitModel(root, ENEMY_FIT * (cfg.sizeMul || 1));
      // seat base on the ground (+ optional lift for fliers), centre horizontally`,
  `      root = cfg.skinned ? skeletonClone(model.scene) : model.scene.clone(true);
      prepEnemyRoot(root);
      const { box, scale } = fitModel(root, ENEMY_FIT * (cfg.sizeMul || 1));
      // seat base on the ground (+ optional lift for fliers), centre horizontally`
);
s = s.replace(
  `      try {
        root = cfg.skinned ? skeletonClone(model.scene) : model.scene.clone(true);
      } catch (err) { continue; }   // keep the dot if the clone fails
      const { box, scale } = fitModel(root, ENEMY_FIT * (cfg.sizeMul || 1));`,
  `      try {
        root = cfg.skinned ? skeletonClone(model.scene) : model.scene.clone(true);
        prepEnemyRoot(root);
      } catch (err) { continue; }   // keep the dot if the clone fails
      const { box, scale } = fitModel(root, ENEMY_FIT * (cfg.sizeMul || 1));`
);

fs.writeFileSync(F, s);
console.log('enemy.js: disabled frustum culling on cloned enemy meshes (fixes invisible skinned models)');
