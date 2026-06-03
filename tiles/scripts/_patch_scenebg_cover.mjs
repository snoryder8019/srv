/**
 * One-shot patch #2: make the SD scene background responsive "cover" + re-fit on
 * resize (it is already screen-PINNED because a scene.background texture never
 * moves with the camera). Center-crops to fill the viewport with no distortion.
 *   1) table3d.js   — _bgTex + fitBackground(), called on load and in resize()
 *   2) dominoes3d.js— _sceneBgTex + fitSceneBg(), called on load and in resize()
 * Exact-match replaces with assertions; idempotent (skips if already patched).
 */
import fs from 'fs';

const edits = [];
function patch(file, anchor, replacement, marker) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(marker)) { edits.push(`skip (already patched): ${file} [${marker}]`); return; }
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor count ${n} (expected 1) in ${file} for anchor:\n${anchor}`);
  fs.writeFileSync(file, src.replace(anchor, replacement));
  edits.push(`patched: ${file} [${marker}]`);
}

const DIR = '/srv/tiles/public/js';

// 1) table3d.js — upgrade applyBackgroundImage to store the texture + cover-fit.
patch(
  `${DIR}/table3d.js`,
  `  function applyBackgroundImage(url) {
    if (!url) return;
    new THREE.TextureLoader().load(
      url,
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex; },
      undefined,
      () => { /* keep flat-color fallback */ }
    );
  }`,
  `  let _bgTex = null;
  function fitBackground() {
    if (!_bgTex || !_bgTex.image) return;
    const canvasAspect = window.innerWidth / window.innerHeight;
    const imageAspect = _bgTex.image.width / _bgTex.image.height;
    const a = imageAspect / canvasAspect;
    _bgTex.wrapS = _bgTex.wrapT = THREE.ClampToEdgeWrapping;
    if (a > 1) { _bgTex.repeat.set(1 / a, 1); _bgTex.offset.set((1 - 1 / a) / 2, 0); }
    else { _bgTex.repeat.set(1, a); _bgTex.offset.set(0, (1 - a) / 2); }
    _bgTex.needsUpdate = true;
  }
  function applyBackgroundImage(url) {
    if (!url) return;
    new THREE.TextureLoader().load(
      url,
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; _bgTex = tex; scene.background = tex; fitBackground(); },
      undefined,
      () => { /* keep flat-color fallback */ }
    );
  }`,
  'fitBackground'
);

// 1b) table3d.js — re-fit on resize.
patch(
  `${DIR}/table3d.js`,
  `  function resize() { const w = window.innerWidth, h = window.innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); }`,
  `  function resize() { const w = window.innerWidth, h = window.innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); fitBackground(); }`,
  'renderer.setSize(w, h, false); fitBackground();'
);

// 2) dominoes3d.js — store texture + cover-fit on load.
patch(
  `${DIR}/dominoes3d.js`,
  `fetch('/scene/url/dominoes')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    if (!d || !d.url) return;
    new THREE.TextureLoader().load(d.url, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex; });
  })
  .catch(() => {});`,
  `let _sceneBgTex = null;
function fitSceneBg() {
  if (!_sceneBgTex || !_sceneBgTex.image) return;
  const canvasAspect = window.innerWidth / window.innerHeight;
  const imageAspect = _sceneBgTex.image.width / _sceneBgTex.image.height;
  const a = imageAspect / canvasAspect;
  _sceneBgTex.wrapS = _sceneBgTex.wrapT = THREE.ClampToEdgeWrapping;
  if (a > 1) { _sceneBgTex.repeat.set(1 / a, 1); _sceneBgTex.offset.set((1 - 1 / a) / 2, 0); }
  else { _sceneBgTex.repeat.set(1, a); _sceneBgTex.offset.set(0, (1 - a) / 2); }
  _sceneBgTex.needsUpdate = true;
}
fetch('/scene/url/dominoes')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    if (!d || !d.url) return;
    new THREE.TextureLoader().load(d.url, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; _sceneBgTex = tex; scene.background = tex; fitSceneBg(); });
  })
  .catch(() => {});`,
  'fitSceneBg'
);

// 2b) dominoes3d.js — re-fit on resize (note: no leading indent, distinct from table3d).
patch(
  `${DIR}/dominoes3d.js`,
  `function resize() { const w = window.innerWidth, h = window.innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); }`,
  `function resize() { const w = window.innerWidth, h = window.innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); fitSceneBg(); }`,
  'renderer.setSize(w, h, false); fitSceneBg();'
);

console.log(edits.join('\n'));
console.log('done');
