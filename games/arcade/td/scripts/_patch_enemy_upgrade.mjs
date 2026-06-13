import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/enemy.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('_upgradeFallbacks')) { console.log('already'); process.exit(0); }

// PROBLEM: on a big map, enemies spawn before the GLB finishes downloading, so
// they get the fallback sphere ("dots") and were never upgraded once the model
// arrived. FIX: track which entities are on the fallback, and when a model
// finishes preloading, rebuild those entities with the real animated model.

// 1) in _preload, after storing the model, upgrade any waiting fallbacks.
s = s.replace(
  `      this._loader.load(cfg.url, (gltf) => {
        // store under every type that uses this url
        for (const [t, c] of Object.entries(ENEMY_MODELS)) {
          if (c.url === cfg.url) this.models[t] = { scene: gltf.scene, animations: gltf.animations };
        }
      }, undefined, (err) => console.warn(\`[enemies] preload failed \${cfg.url}\`, err));`,
  `      this._loader.load(cfg.url, (gltf) => {
        // store under every type that uses this url
        for (const [t, c] of Object.entries(ENEMY_MODELS)) {
          if (c.url === cfg.url) this.models[t] = { scene: gltf.scene, animations: gltf.animations };
        }
        this._upgradeFallbacks();   // swap any "dot" placeholders for the real model
      }, undefined, (err) => console.warn(\`[enemies] preload failed \${cfg.url}\`, err));`
);

// 2) mark fallback entities + remember their type so we can upgrade them.
s = s.replace(
  `    } else {
      // fallback sphere until the model finishes preloading
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45 });
      root = new THREE.Mesh(ENEMY_FALLBACK_GEO, mat);
      root.position.y = TILE_TOP + ENEMY_RADIUS;
    }

    root.visible = false;          // <-- hidden until first position fix (no center flash)
    this.scene.add(root);
    this.entities.set(id, { root, mixer, cfg, hpMax, target: null, placed: false, prev: null, yaw: 0, dying: false,
      flying: !!cfg.flying, baseY: root.position.y, phase: Math.random() * Math.PI * 2, bank: 0 });`,
  `      isFallback = false;
    } else {
      // fallback sphere until the model finishes preloading
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45 });
      root = new THREE.Mesh(ENEMY_FALLBACK_GEO, mat);
      root.position.y = TILE_TOP + ENEMY_RADIUS;
      isFallback = true;
    }

    root.visible = false;          // <-- hidden until first position fix (no center flash)
    this.scene.add(root);
    this.entities.set(id, { root, mixer, cfg, type, hpMax, target: null, placed: false, prev: null, yaw: 0, dying: false,
      flying: !!cfg.flying, baseY: root.position.y, phase: Math.random() * Math.PI * 2, bank: 0, isFallback });`
);

// 3) declare isFallback in spawn() scope (before the if/else)
s = s.replace(
  `    const model = this.models[type];
    let root, mixer = null;

    if (model) {`,
  `    const model = this.models[type];
    let root, mixer = null, isFallback = false;

    if (model) {`
);

// 4) add the _upgradeFallbacks method (rebuild fallback entities with the model,
//    preserving their current position/visibility so they don't pop or flash).
s = s.replace(
  `  updatePosition(id, q, r, hp) {`,
  `  // Once a model finishes preloading, replace any fallback "dot" placeholders
  // already on the board with the real animated model, in place.
  _upgradeFallbacks() {
    for (const [id, e] of this.entities.entries()) {
      if (!e.isFallback || e.dying) continue;
      const model = this.models[e.type];
      if (!model) continue;
      const cfg = e.cfg;
      const oldRoot = e.root;
      let root;
      try {
        root = cfg.skinned ? skeletonClone(model.scene) : model.scene.clone(true);
      } catch (err) { continue; }   // keep the dot if the clone fails
      const { box, scale } = fitModel(root, ENEMY_FIT * (cfg.sizeMul || 1));
      root.position.x = oldRoot.position.x;
      root.position.z = oldRoot.position.z;
      root.position.y = TILE_TOP - box.min.y * scale + (cfg.yLift || 0);
      root.rotation.y = oldRoot.rotation.y;
      root.visible = oldRoot.visible;
      const mixer = new THREE.AnimationMixer(root);
      const clip = THREE.AnimationClip.findByName(model.animations, cfg.clip) || model.animations[0];
      if (clip) mixer.clipAction(clip).play();
      this.scene.remove(oldRoot);
      this.scene.add(root);
      e.root = root; e.mixer = mixer; e.isFallback = false; e.baseY = root.position.y;
    }
  }

  updatePosition(id, q, r, hp) {`
);

fs.writeFileSync(F, s);
console.log('enemy.js: fallback dots now upgrade to the model once it preloads');
