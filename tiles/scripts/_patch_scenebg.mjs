/**
 * One-shot patch: add SD scene-background support to the 3D clients.
 *   1) table3d.js   — shared core learns opts.bgImage / opts.bgScene + exposes setBackgroundImage
 *   2) hearts3d.js  — passes bgScene:'hearts'
 *   3) dominoes3d.js— (own inline scene) loads /scene/url/dominoes after its color bg
 * Exact-match replaces with assertions; idempotent (skips if already patched).
 */
import fs from 'fs';

const edits = [];
function patch(file, anchor, insert, marker) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(marker)) { edits.push(`skip (already patched): ${file}`); return; }
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor count ${n} (expected 1) in ${file}`);
  fs.writeFileSync(file, src.replace(anchor, anchor + insert));
  edits.push(`patched: ${file}`);
}

const DIR = '/srv/tiles/public/js';

// 1) table3d.js — after the fog line, add the bg-image loader + scene resolve.
patch(
  `${DIR}/table3d.js`,
  `  scene.fog = new THREE.Fog(opts.bg ?? 0x0a1a12, 170, 320); // far so zoom-out never fogs the table`,
  `

  // ---- optional SD scene background (mll GPU tunnel) ----
  // Default is the flat color above. Pass opts.bgImage (a URL) or opts.bgScene (a
  // slug resolved server-side via /scene/url/:slug) to draw a generated backdrop.
  // Failure is silent — the flat-color background already rendered.
  function applyBackgroundImage(url) {
    if (!url) return;
    new THREE.TextureLoader().load(
      url,
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex; },
      undefined,
      () => { /* keep flat-color fallback */ }
    );
  }
  if (opts.bgImage) {
    applyBackgroundImage(opts.bgImage);
  } else if (opts.bgScene) {
    fetch(\`/scene/url/\${encodeURIComponent(opts.bgScene)}\`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.url) applyBackgroundImage(d.url); })
      .catch(() => {});
  }`,
  'applyBackgroundImage'
);

// 1b) table3d.js — expose setBackgroundImage on the returned API.
patch(
  `${DIR}/table3d.js`,
  `    resetCamera, setCamera,`,
  `
    setBackgroundImage: applyBackgroundImage,`,
  'setBackgroundImage:'
);

// 2) hearts3d.js — opt into the hearts backdrop.
patch(
  `${DIR}/hearts3d.js`,
  `  tableRadius: 34, feltColor: 0x14633f,`,
  `
  bgScene: 'hearts',`,
  `bgScene: 'hearts'`
);

// 3) dominoes3d.js — own inline scene; load the dominoes backdrop after its color.
patch(
  `${DIR}/dominoes3d.js`,
  `scene.background = new THREE.Color(0x0a1a12);`,
  `
// SD scene background (mll GPU tunnel): swap in a generated backdrop if one exists.
// Silent fallback to the flat color above on any failure.
fetch('/scene/url/dominoes')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    if (!d || !d.url) return;
    new THREE.TextureLoader().load(d.url, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex; });
  })
  .catch(() => {});`,
  "fetch('/scene/url/dominoes')"
);

console.log(edits.join('\n'));
console.log('done');
