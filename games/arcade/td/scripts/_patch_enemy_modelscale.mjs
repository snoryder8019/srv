import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/enemy.js';
let s = fs.readFileSync(F, 'utf8');

// Replace _preload + _makeModel so the SOURCE scene is scaled ONCE at load time
// (skinned meshes break when you rescale a cloned wrapper group — the skeleton's
// bone matrices win and the mesh collapses/invisible). We bake target scale into
// gltf.scene before cloning, so every clone is already correctly sized and we
// never touch a clone's scale.
const startMarker = '  _preload() {';
const endMarker = `  // When a model finishes loading, upgrade every live entity that uses it and is
  // still on its primitive.`;
const startIdx = s.indexOf(startMarker);
const endIdx = s.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) { console.log('markers not found'); process.exit(1); }

const replacement = `  _preload() {
    const urls = new Set();
    for (const spec of Object.values(SPEC)) if (spec.model) urls.add(spec.model);
    for (const url of urls) {
      this._loader.load(url, (gltf) => {
        const src = gltf.scene;
        // measure native height (armature node-scale included) and bake a base
        // scale into the SOURCE so clones never need rescaling.
        src.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(src);
        const h = box.max.y - box.min.y;
        let base = (isFinite(h) && h > 1e-3) ? (TARGET_H / h) : 1;
        if (!isFinite(base) || base <= 0 || base > 1000) base = 1;
        src.scale.setScalar(base);
        src.updateWorldMatrix(true, true);
        const box2 = new THREE.Box3().setFromObject(src);
        const footY = isFinite(box2.min.y) ? box2.min.y : 0;
        src.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
        this.models[url] = { scene: src, animations: gltf.animations, footY };
        this._upgradeToModels(url);
      }, undefined, () => { /* keep primitives on failure */ });
    }
  }

  // Clone the (already-scaled) source. sizeMul applies a SMALL extra factor via a
  // wrapper group — for NON-skinned variety we'd scale the clone, but to stay safe
  // with skinned meshes we wrap and scale the wrapper, keeping the skinned clone at
  // its native (source) scale inside.
  _makeModel(url, sizeMul) {
    const m = this.models[url];
    if (!m) return null;
    let inner;
    try { inner = skeletonClone(m.scene); } catch (e) {
      try { inner = m.scene.clone(true); } catch (e2) { return null; }
    }
    inner.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
    inner.position.y = -m.footY;          // feet on y=0 (relative to native scale)
    // wrapper carries the per-type sizeMul so we never rescale the skinned clone itself
    const root = new THREE.Group();
    root.scale.setScalar(sizeMul || 1);
    root.add(inner);
    let mixer = null;
    const clip = m.animations && (THREE.AnimationClip.findByName(m.animations, 'Running') || m.animations[0]);
    if (clip) { mixer = new THREE.AnimationMixer(inner); mixer.clipAction(clip).play(); }
    return { root, mixer };
  }

`;

s = s.slice(0, startIdx) + replacement + s.slice(endIdx);
fs.writeFileSync(F, s);
console.log('enemy.js: source scaled once at load, clones never rescaled (skinned-safe)');
