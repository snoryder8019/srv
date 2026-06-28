/**
 * camDebug.js — ONE shared camera debugger + opening-view tool for every table.
 *
 * Supersedes the inline cam HUD that used to live in table3d.js and the bespoke
 * copy in dominoes3d.js. Works with ANY scene by taking a plain api object:
 *
 *   mountCamDebug({
 *     camera, controls,            // required (THREE.PerspectiveCamera + OrbitControls)
 *     THREE,                       // optional — enables precise orbit/tilt nudging
 *     setBackgroundImage,          // optional — (url) => void, enables the scene picker
 *     resetCamera,                 // optional — () => void, "reset to opening view"
 *   }, { game: 'blackjack' });
 *
 * What it gives the operator (admin or ?cam=1) on phone OR desktop:
 *   • live readout: distance, azimuth, tilt, FOV, start xyz, target xyz
 *   • touch nudge pad: orbit / tilt / dolly / raise-lower target (hold to repeat)
 *   • FOV slider
 *   • scene picker: preview every room backdrop live before you frame the shot
 *   • SAVE OPENING VIEW → POST /dev/camera/:game  (start, target, fov)
 *   • copy JSON, reset
 *
 * The panel is DRAGGABLE and remembers its position — it is the reference
 * implementation for the dynamic-desktop movable modals.
 */

const LS_POS = 'camdbg.pos';
const LS_SCENE = (g) => 'camdbg.scene.' + g;

function gameSlug(opts) {
  return (opts.game
    || (location.pathname.match(/\/lobby\/([^/?#]+)/) || [])[1]
    || (document.title || '').split(' ')[0]
    || 'default').toLowerCase();
}

const r1 = (n) => Math.round(n * 10) / 10;
const deg = (rad) => Math.round(rad * 180 / Math.PI);

export function mountCamDebug(api = {}, opts = {}) {
  const { camera, controls } = api;
  if (!camera || !controls) { console.warn('[camDebug] needs camera + controls'); return null; }
  if (document.getElementById('camDbgCog')) return null; // already mounted
  const THREE = api.THREE || (typeof window !== 'undefined' && window.THREE) || null;
  const GAME = gameSlug(opts);

  // ---------- orbit math (rotate camera around its target) ----------
  function applyOrbit({ dTheta = 0, dPhi = 0, dRadius = 0 }) {
    const off = { x: camera.position.x - controls.target.x,
                  y: camera.position.y - controls.target.y,
                  z: camera.position.z - controls.target.z };
    let radius = Math.hypot(off.x, off.y, off.z) || 0.001;
    let theta = Math.atan2(off.x, off.z);          // azimuth around Y
    let phi = Math.acos(Math.max(-1, Math.min(1, off.y / radius))); // polar from +Y
    theta += dTheta;
    phi = Math.max(0.05, Math.min(Math.PI * 0.495, phi + dPhi));
    radius = Math.max(controls.minDistance || 2, Math.min(controls.maxDistance || 5000, radius + dRadius));
    const sinPhi = Math.sin(phi);
    camera.position.set(
      controls.target.x + radius * sinPhi * Math.sin(theta),
      controls.target.y + radius * Math.cos(phi),
      controls.target.z + radius * sinPhi * Math.cos(theta));
    controls.update();
  }
  function raiseTarget(dy) {
    controls.target.y += dy; camera.position.y += dy; controls.update();
  }
  function setFov(v) { camera.fov = v; camera.updateProjectionMatrix(); }

  // ---------- DOM ----------
  const PANEL_CSS = 'position:fixed;z-index:200;width:min(290px,86vw);max-height:82vh;overflow:auto;' +
    'background:rgba(8,18,13,.95);color:#cfe7d8;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'border:1px solid rgba(120,200,160,.28);border-radius:14px;box-shadow:0 14px 42px rgba(0,0,0,.6);' +
    '-webkit-user-select:none;user-select:none;touch-action:none;backdrop-filter:blur(6px)';
  const panel = document.createElement('div');
  panel.id = 'camDbgPanel';
  panel.style.cssText = PANEL_CSS + ';display:none';

  // header (drag handle)
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:grab;' +
    'background:linear-gradient(180deg,rgba(40,80,58,.6),rgba(20,40,28,.3));' +
    'border-bottom:1px solid rgba(120,200,160,.2);border-radius:14px 14px 0 0;position:sticky;top:0';
  head.innerHTML = '<span style="font:800 13px system-ui;letter-spacing:.3px;color:#eafff2">🎥 CAMERA · ' +
    GAME.toUpperCase() + '</span>';
  const spacer = document.createElement('div'); spacer.style.flex = '1'; head.appendChild(spacer);
  const closeX = mkBtn('✕', 'background:#3a1d1d;color:#f0c9c9;padding:4px 9px;font-size:12px');
  closeX.onclick = () => { panel.style.display = 'none'; };
  head.appendChild(closeX);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.style.cssText = 'padding:12px';
  panel.appendChild(body);

  // readout
  const readout = document.createElement('div');
  readout.style.cssText = 'white-space:pre;line-height:1.55;background:rgba(0,0,0,.3);padding:8px 10px;' +
    'border-radius:9px;border:1px solid rgba(255,255,255,.08);margin-bottom:10px;font-size:12px';
  body.appendChild(readout);

  // nudge pad
  body.appendChild(sectionLabel('NUDGE'));
  const pad = document.createElement('div');
  pad.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px';
  const STEP_T = 0.08, STEP_P = 0.05, STEP_R = 4, STEP_Y = 0.6;
  pad.append(
    holdBtn('◀', () => applyOrbit({ dTheta: STEP_T }), 'orbit left'),
    holdBtn('▲', () => applyOrbit({ dPhi: -STEP_P }), 'tilt up'),
    holdBtn('▼', () => applyOrbit({ dPhi: STEP_P }), 'tilt down'),
    holdBtn('▶', () => applyOrbit({ dTheta: -STEP_T }), 'orbit right'),
    holdBtn('＋', () => applyOrbit({ dRadius: -STEP_R }), 'dolly in'),
    holdBtn('⤒', () => raiseTarget(STEP_Y), 'target up'),
    holdBtn('⤓', () => raiseTarget(-STEP_Y), 'target down'),
    holdBtn('－', () => applyOrbit({ dRadius: STEP_R }), 'dolly out'),
  );
  body.appendChild(pad);

  // FOV slider
  body.appendChild(sectionLabel('FOV'));
  const fovWrap = document.createElement('div');
  fovWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px';
  const fov = document.createElement('input');
  fov.type = 'range'; fov.min = '25'; fov.max = '80'; fov.step = '1';
  fov.value = String(Math.round(camera.fov));
  fov.style.cssText = 'flex:1;accent-color:#43e08a';
  const fovVal = document.createElement('span');
  fovVal.style.cssText = 'width:34px;text-align:right;color:#eafff2;font-weight:700';
  fovVal.textContent = fov.value;
  fov.oninput = () => { setFov(+fov.value); fovVal.textContent = fov.value; };
  fovWrap.append(fov, fovVal);
  body.appendChild(fovWrap);

  // scene picker (only if the host can swap the backdrop)
  if (typeof api.setBackgroundImage === 'function') {
    body.appendChild(sectionLabel('SCENE BACKDROP'));
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px';
    body.appendChild(chips);
    loadScenes(chips, api.setBackgroundImage, GAME);
  }

  // actions
  const actions = document.createElement('div');
  actions.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
  const saveBtn = mkBtn('📍 SAVE VIEW', 'background:#2fbf71;color:#05230f;grid-column:1/3;padding:11px;font:800 14px system-ui');
  saveBtn.onclick = () => saveOpeningView(saveBtn, GAME, camera, controls);
  const copyBtn = mkBtn('⧉ Copy JSON', 'background:#243a30;color:#cfe7d8;padding:9px;font-weight:700');
  copyBtn.onclick = () => copyJson(copyBtn, camera, controls);
  const resetBtn = mkBtn('⟲ Reset', 'background:#243a30;color:#cfe7d8;padding:9px;font-weight:700');
  resetBtn.onclick = () => { if (typeof api.resetCamera === 'function') api.resetCamera(); fov.value = String(Math.round(camera.fov)); fovVal.textContent = fov.value; };
  actions.append(saveBtn, copyBtn, resetBtn);
  body.appendChild(actions);

  document.body.appendChild(panel);

  // restore position
  restorePos(panel);
  makeDraggable(panel, head);

  // floating cog toggle
  const cog = mkBtn('🎥', 'position:fixed;left:10px;bottom:60px;z-index:201;width:40px;height:40px;' +
    'border-radius:11px;background:rgba(17,35,26,.9);color:#cfe7d8;border:1px solid rgba(120,200,160,.3);' +
    'font-size:17px;box-shadow:0 4px 14px rgba(0,0,0,.45)');
  cog.id = 'camDbgCog'; cog.title = 'Camera debugger';
  cog.onclick = () => { panel.style.display = (panel.style.display === 'none' ? 'block' : 'none'); };
  document.body.appendChild(cog);

  // live readout loop
  (function tick() {
    requestAnimationFrame(tick);
    if (panel.style.display === 'none') return;
    const p = camera.position, t = controls.target;
    const dx = p.x - t.x, dz = p.z - t.z, dy = p.y - t.y;
    const dist = Math.round(Math.hypot(dx, dy, dz));
    const tilt = 90 - deg(Math.acos(Math.max(-1, Math.min(1, dy / (dist || 1)))));
    readout.textContent =
      `dist ${dist}   az ${deg(Math.atan2(dx, dz))}°   tilt ${tilt}°   fov ${Math.round(camera.fov)}\n` +
      `start  ${r1(p.x)}, ${r1(p.y)}, ${r1(p.z)}\n` +
      `target ${r1(t.x)}, ${r1(t.y)}, ${r1(t.z)}`;
  })();

  return { panel, cog, show: () => { panel.style.display = 'block'; }, hide: () => { panel.style.display = 'none'; } };
}

// ---------- helpers ----------
function mkBtn(label, extra = '') {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'border:none;border-radius:9px;cursor:pointer;font:700 13px system-ui;' +
    'transition:filter .12s;' + extra;
  b.onpointerdown = (e) => e.stopPropagation();
  return b;
}
function holdBtn(label, fn, title) {
  const b = mkBtn(label, 'background:#1d3a2b;color:#dff7e8;padding:13px 0;font-size:16px');
  b.title = title;
  let raf = null, t0 = 0;
  const loop = () => { fn(); raf = requestAnimationFrame(loop); };
  const start = (e) => { e.preventDefault(); e.stopPropagation(); fn(); t0 = Date.now(); raf = requestAnimationFrame(() => { const wait = setInterval(() => { if (Date.now() - t0 > 220) { clearInterval(wait); loop(); } }, 30); b._wait = wait; }); };
  const stop = () => { if (raf) cancelAnimationFrame(raf); if (b._wait) clearInterval(b._wait); raf = null; };
  b.addEventListener('pointerdown', start);
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointerleave', stop);
  b.addEventListener('pointercancel', stop);
  return b;
}
function sectionLabel(txt) {
  const d = document.createElement('div');
  d.textContent = txt;
  d.style.cssText = 'font:700 10px system-ui;letter-spacing:1.2px;color:#6fae8c;margin:0 0 6px';
  return d;
}
function loadScenes(chips, setBg, game) {
  fetch('/scene/catalog', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const scenes = (d && d.scenes) || [];
      if (!scenes.length) { chips.innerHTML = '<span style="color:#6fae8c;font-size:11px">no rendered scenes yet</span>'; return; }
      const saved = localStorage.getItem(LS_SCENE(game));
      scenes.forEach((s) => {
        const slug = s.slug || s;
        const c = mkBtn(slug, 'background:#243a30;color:#bfe0cd;padding:6px 10px;font-size:11px;font-weight:700');
        c.onclick = () => {
          fetch('/scene/url/' + encodeURIComponent(slug)).then((r) => r.json()).then((j) => {
            if (j && j.url) { setBg(j.url); localStorage.setItem(LS_SCENE(game), slug); markActive(chips, c); }
          });
        };
        if (slug === saved) markActive(chips, c);
        chips.appendChild(c);
      });
    })
    .catch(() => { chips.innerHTML = '<span style="color:#a66;font-size:11px">scene catalog unavailable</span>'; });
}
function markActive(chips, active) {
  [...chips.children].forEach((c) => { c.style.background = '#243a30'; c.style.color = '#bfe0cd'; });
  active.style.background = '#43e08a'; active.style.color = '#05230f';
}
function framePayload(camera, controls) {
  const p = camera.position, t = controls.target;
  return {
    start: { x: r1(p.x), y: r1(p.y), z: r1(p.z) },
    target: { x: r1(t.x), y: r1(t.y), z: r1(t.z) },
    fov: Math.round(camera.fov),
    dist: Math.round(p.distanceTo(t)),
    az: deg(Math.atan2(p.x - t.x, p.z - t.z)),
  };
}
function saveOpeningView(btn, game, camera, controls) {
  const payload = { game, ...framePayload(camera, controls) };
  const label = btn.textContent;
  fetch('/dev/camera/' + encodeURIComponent(game), {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
    .then((r) => { if (!r.ok) throw new Error('save failed'); btn.textContent = '✓ SAVED'; btn.style.background = '#e3c567';
      setTimeout(() => { btn.textContent = label; btn.style.background = '#2fbf71'; }, 1200); })
    .catch(() => { btn.textContent = '✗ failed'; setTimeout(() => { btn.textContent = label; }, 1200); });
}
function copyJson(btn, camera, controls) {
  const txt = JSON.stringify(framePayload(camera, controls), null, 2);
  const done = () => { const l = btn.textContent; btn.textContent = '✓ copied'; setTimeout(() => { btn.textContent = l; }, 1100); };
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, () => {});
  else { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove(); }
}
function makeDraggable(panel, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
  handle.addEventListener('pointerdown', (e) => {
    drag = true; handle.style.cursor = 'grabbing';
    const rect = panel.getBoundingClientRect(); ox = rect.left; oy = rect.top; sx = e.clientX; sy = e.clientY;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const nx = Math.max(0, Math.min(window.innerWidth - 40, ox + e.clientX - sx));
    const ny = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy));
    panel.style.left = nx + 'px'; panel.style.top = ny + 'px'; panel.style.right = 'auto';
  });
  const end = (e) => { if (!drag) return; drag = false; handle.style.cursor = 'grab';
    localStorage.setItem(LS_POS, JSON.stringify({ left: panel.style.left, top: panel.style.top }));
    try { handle.releasePointerCapture(e.pointerId); } catch (err) {} };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
function restorePos(panel) {
  try {
    const p = JSON.parse(localStorage.getItem(LS_POS));
    if (p && p.left && p.top) { panel.style.left = p.left; panel.style.top = p.top; panel.style.right = 'auto'; return; }
  } catch (e) {}
  panel.style.right = '10px'; panel.style.top = '90px';
}

export default { mountCamDebug };
