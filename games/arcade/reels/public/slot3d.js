/**
 * slot3d.js — FULL 3D slot machine for the reels service.
 *
 * Server-authoritative (REELS_PROTOCOL.md): we read the machine config from
 * /api/state, render each reel as a vertical ladder of symbol tiles over the
 * physical strip, and on /api/spin we animate the reels spinning then PIN the
 * visible window to the server's returned `window` (via `stops`). The reels are
 * masked to the window with local clipping planes. Works for any layout
 * (classic-diamond 3x3, royal-suits 5x5, …) straight from the config.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildAvatar } from '/js/avatar3d.js?v=1781441125157';
import { fireConfetti } from '/js/confetti3d.js?v=1781441125157';
// SHARED parlor — LOCAL same-origin copy synced from /srv/games/_shared/js (sync.sh).
import { createParlor } from '/js/parlor3d.js?v=1781441125157';

const TILES = 'https://tiles.madladslab.com';   // reels pulls live tables/board from tiles (read-only)

const qs = new URLSearchParams(location.search);
const MACHINE = (qs.get('m') || 'classic-diamond').replace(/[^a-z0-9-]/gi, '');
const $ = (id) => document.getElementById(id);

// ── symbol glyphs + accents (fall back to the config label) ──
const GLYPH = {
  cherry: '🍒', lemon: '🍋', bell: '🔔', seven: '7', diamond: '💎', star: '★',
  bar: 'BAR', bar2: 'BAR×2', bar3: 'BAR×3', wild: 'JOKER', joker: 'JOKER', scatter: '★',
  spade: '♠', heart: '♥', club: '♣', ten: '10', jack: 'J', queen: 'Q', king: 'K', ace: 'A',
};
const ACCENT = {
  seven: '#ff5a3c', diamond: '#5ad0ff', star: '#ffd34d', scatter: '#ffd34d',
  bar: '#e3c567', bar2: '#e3c567', bar3: '#e3c567', cherry: '#ff5a7a', lemon: '#ffe14d',
  bell: '#ffcf5a', wild: '#c79bff', joker: '#c79bff',
  spade: '#dfe9ff', club: '#dfe9ff', heart: '#ff6a7a', ace: '#ffd34d', king: '#ffd34d', queen: '#ffd34d', jack: '#ffd34d', ten: '#bfe9ff',
};

let machine = null, chips = 0, freeSpins = null, pendingPick = null, shoe = null;
let denom = 1, betLevel = 1, lines = 1;
let spinning = false;

// ── boot ──
(async function boot() {
  let st;
  try {
    const r = await fetch('/api/state?machine=' + encodeURIComponent(MACHINE), { credentials: 'include' });
    if (r.status === 401) { location.href = '/auth/platform'; return; }
    st = await r.json();
  } catch (e) { $('loading').textContent = 'Could not load machine.'; return; }
  if (!st || !st.ok) { $('loading').textContent = (st && st.error) || 'Unknown machine.'; return; }

  machine = st.machine; chips = st.chips ?? 0; freeSpins = st.freeSpins; pendingPick = st.pendingPick; shoe = st.shoe;
  $('mName').textContent = machine.name || 'Reels';
  document.title = (machine.name || 'Reels') + ' 3D · madladslab';
  // sensible bet defaults: smallest denom, max lines, bet ×1
  denom = machine.denominations[0];
  lines = machine.lineOptions[machine.lineOptions.length - 1];
  betLevel = machine.betLevels[0];

  buildControls();
  buildScene();
  updateReadouts();
  $('loading').style.display = 'none';
  if (pendingPick) openPick(pendingPick);
})();

// ── HUD controls ──
function buildControls() {
  const mk = (host, vals, get, set) => {
    const el = $(host); el.innerHTML = '';
    vals.forEach((v) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = v;
      b.onclick = () => { set(v); paintRow(host, vals, get); updateReadouts(); };
      el.appendChild(b);
    });
    paintRow(host, vals, get);
  };
  mk('denomRow', machine.denominations, () => denom, (v) => denom = v);
  mk('linesRow', machine.lineOptions, () => lines, (v) => lines = v);
  mk('betRow', machine.betLevels, () => betLevel, (v) => betLevel = v);

  $('spinBtn').onclick = spin;
  $('resetcam').onclick = () => resetCam && resetCam();
  $('classicBtn').onclick = () => { location.href = '/classic?m=' + encodeURIComponent(MACHINE); };
  $('bonusClose').onclick = () => { $('bonus').style.display = 'none'; };
}
function paintRow(host, vals, get) {
  const cur = get();
  [...$(host).children].forEach((b, i) => b.classList.toggle('on', vals[i] === cur));
}
function totalBet() { return denom * betLevel * lines; }
function updateReadouts() {
  $('chips').textContent = chips;
  const free = freeSpins && freeSpins.remaining > 0;
  $('roBet').textContent = free ? 'FREE' : totalBet();
  const sb = $('spinBtn');
  sb.classList.toggle('free', !!free);
  sb.textContent = free ? `FREE SPIN ×${freeSpins.remaining}` : 'SPIN';
}
let _toastT = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('show'), 1800); }

// ════════════════════════ 3D SCENE ════════════════════════
let renderer, scene, camera, controls, resetCam, handle, _parlor = null;
let topMesh = null, topCtx = null, topTex = null, _topPulse = 0, _topAcc = 0;   // top bonus screen
const reels = [];          // per-reel { group, tiles[], strip, S, pos, tween }
const avatars = [];        // seated parlor patrons (idle-animated)
const texCache = new Map(); // symbolId -> THREE.Texture

// top bonus screen above the marquee: collection fill / free-spins / idle
function drawTopBonus() {
  if (!topCtx) return;
  const c = topCtx, W = 1024, H = 240;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#06030e'; c.fillRect(0, 0, W, H);
  c.textBaseline = 'middle';
  const pulse = 0.6 + 0.4 * Math.abs(Math.sin(_topPulse * 2));
  if (shoe && shoe.fill) {
    // collection bonus fill bar (e.g. Dealer Shoe)
    c.textAlign = 'left'; c.fillStyle = '#c79bff'; c.font = '800 56px system-ui';
    c.fillText((shoe.label || 'BONUS').toUpperCase(), 40, 56);
    c.textAlign = 'right'; c.fillStyle = '#ecdcff'; c.font = '800 52px system-ui';
    c.fillText(shoe.count + ' / ' + shoe.fill, W - 40, 56);
    const bx = 40, bw = W - 80, by = 120, bh = 78, frac = Math.max(0, Math.min(1, shoe.count / shoe.fill));
    c.fillStyle = 'rgba(80,40,140,.35)'; round(c, bx, by, bw, bh, 18); c.fill();
    c.save(); c.shadowColor = '#c79bff'; c.shadowBlur = 30 * pulse;
    const g = c.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#7a3bd0'); g.addColorStop(1, '#c79bff');
    c.fillStyle = g; round(c, bx, by, Math.max(bh, bw * frac), bh, 18); c.fill(); c.restore();
  } else if (freeSpins && freeSpins.remaining > 0) {
    c.textAlign = 'center'; c.save(); c.shadowColor = '#46e0c0'; c.shadowBlur = 36 * pulse;
    c.fillStyle = '#7ef9da'; c.font = '900 92px system-ui';
    c.fillText('FREE SPINS  ×' + freeSpins.remaining, W / 2, H / 2); c.restore();
  } else {
    c.textAlign = 'center'; c.save(); c.shadowColor = '#c79bff'; c.shadowBlur = 26 * pulse;
    c.fillStyle = 'rgba(199,155,255,' + (0.55 + 0.35 * pulse) + ')'; c.font = '900 76px system-ui';
    c.fillText('★  BONUS  ★', W / 2, H / 2); c.restore();
  }
  topTex.needsUpdate = true;
}
let REELS = 3, ROWS = 3;
const TILE = 6.4, GAP = 0.5;
let winTopY = 0, winBotY = 0, winCenterY = 0;

function symbolTexture(id) {
  if (texCache.has(id)) return texCache.get(id);
  const sym = (machine.symbols && machine.symbols[id]) || {};
  const glyph = GLYPH[id] || sym.label || id;
  const accent = ACCENT[id] || '#9ffbe0';
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  // tile background
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#10201a'); g.addColorStop(1, '#0a1712');
  c.fillStyle = g; round(c, 10, 10, 236, 236, 26); c.fill();
  c.strokeStyle = accent; c.lineWidth = 6; c.globalAlpha = 0.85; round(c, 12, 12, 232, 232, 24); c.stroke(); c.globalAlpha = 1;
  // glyph
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = accent; c.shadowBlur = 26; c.fillStyle = accent;
  const big = glyph.length <= 2;
  c.font = (big ? '800 150px' : '800 60px') + ' system-ui';
  c.fillText(glyph, 128, big ? 132 : 128);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  texCache.set(id, tex); return tex;
}

function buildScene() {
  REELS = machine.layout.reels; ROWS = machine.layout.rows;
  const canvas = $('scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  resize();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06100c);
  // no near fog — it would swallow the shared parlor (bar/board/tables/dome out
  // past z-470). Keep it far beyond the camera far-plane so nothing visible fogs.
  scene.fog = new THREE.Fog(0x06100c, 1800, 3000);

  const reelW = REELS * TILE + (REELS - 1) * GAP;
  const winH = ROWS * TILE;
  winCenterY = 0; winTopY = winH / 2; winBotY = -winH / 2;

  const D = 9;                       // cabinet depth (real 3D body)
  const upperH = winH * 0.78 + 14;   // hood: holds the title marquee + the bonus top-screen
  const lowerH = winH * 0.7 + 10;    // control deck + base below
  const totalH = winH + upperH + lowerH;
  const cabCY = (upperH - lowerH) / 2;          // cabinet vertical centre
  const floorY = -winH / 2 - lowerH;            // base sits here

  camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 2400);  // far enough for the shared dome
  const dist = totalH * 1.5 + 40;
  camera.position.set(0, 8, dist);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);
  controls.minDistance = dist * 0.42; controls.maxDistance = 760;   // pull back to take in the whole parlor
  // clamp tilt: never near-overhead (scene upends) and never past horizontal (would
  // dip below the floor and see outside the room). 0.46π keeps a margin above horizon.
  controls.minPolarAngle = Math.PI * 0.22; controls.maxPolarAngle = Math.PI * 0.46;
  controls.enablePan = false; controls.update();
  const HOME = { p: camera.position.clone(), t: controls.target.clone() };
  resetCam = () => { camera.position.copy(HOME.p); controls.target.copy(HOME.t); controls.update(); };

  // ───────── ROOM ─────────
  scene.add(new THREE.AmbientLight(0xbcd6e6, 0.55));
  const key = new THREE.DirectionalLight(0xfff2dc, 0.9); key.position.set(10, 60, 40);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 10; key.shadow.camera.far = 260;
  key.shadow.camera.left = -120; key.shadow.camera.right = 120; key.shadow.camera.top = 120; key.shadow.camera.bottom = -120;
  scene.add(key);
  const rimA = new THREE.PointLight(0x46e0c0, 0.8, 240); rimA.position.set(-reelW, winH, 24); scene.add(rimA);
  const rimB = new THREE.PointLight(0x9b6bff, 0.7, 240); rimB.position.set(reelW, winH, 24); scene.add(rimB);

  // ── SHARED parlor: dome · mahogany floor · shotgun bar · sports/keno board ·
  //    satellite tables · bartenders+patrons — the SAME module the tiles scene uses.
  //    Live board pulls from tiles read-only; betting stays on tiles (cross-origin
  //    session) so it's display-only here. Floor matches the slot cabinet's base.
  _parlor = createParlor({ scene, THREE, camera, renderer, tableRadius: reelW + 6, floorY, apiBase: TILES, features: { betting: false } });
  if (_parlor) _parlor.loadSatellites({ game: MACHINE });   // populate the table ring around the slot

  // ───────── CABINET (framed window = real depth, open face) ─────────
  const cab = new THREE.Group(); scene.add(cab);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a2c34, roughness: 0.5, metalness: 0.5 });
  const insetMat = new THREE.MeshStandardMaterial({ color: 0x03080a, roughness: 0.9 });
  const neon = (c) => new THREE.MeshStandardMaterial({ color: 0x0a1a14, emissive: c, emissiveIntensity: 0.8, roughness: 0.4 });

  const sideX = reelW / 2 + 2;
  // back wall of the cabinet (behind the reels)
  const back = new THREE.Mesh(new THREE.BoxGeometry(reelW + 8, totalH, 2), insetMat);
  back.position.set(0, cabCY, -D / 2); back.castShadow = true; cab.add(back);
  // side panels (give the box real depth)
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(2.4, totalH, D), bodyMat);
    side.position.set(s * (sideX + 1), cabCY, 0); side.castShadow = true; cab.add(side);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, winH + upperH, 0.5), neon(0x2bd3a0));
    strip.position.set(s * (sideX + 0.1), winH / 4, D / 2); cab.add(strip);
  }
  // top hood + glowing marquee
  const top = new THREE.Mesh(new THREE.BoxGeometry(reelW + 8, upperH, D), bodyMat);
  top.position.set(0, winH / 2 + upperH / 2, 0); top.castShadow = true; cab.add(top);
  const marquee = new THREE.Mesh(new THREE.BoxGeometry(reelW + 6, upperH * 0.34, 1.2), nameMarquee());
  marquee.position.set(0, winH / 2 + upperH * 0.30, D / 2 + 0.3); cab.add(marquee);
  // TOP BONUS SCREEN above the title — collection fill / free-spins / idle, animated
  const topCv = document.createElement('canvas'); topCv.width = 1024; topCv.height = 240;
  topCtx = topCv.getContext('2d');
  topTex = new THREE.CanvasTexture(topCv); topTex.colorSpace = THREE.SRGBColorSpace;
  topMesh = new THREE.Mesh(new THREE.PlaneGeometry(reelW + 4, upperH * 0.34),
    new THREE.MeshBasicMaterial({ map: topTex }));
  topMesh.position.set(0, winH / 2 + upperH * 0.74, D / 2 + 0.35); cab.add(topMesh);
  // a thin neon frame around the top screen
  const topFrame = new THREE.Mesh(new THREE.BoxGeometry(reelW + 6, upperH * 0.34 + 1.4, 1),
    new THREE.MeshStandardMaterial({ color: 0x0a1a14, emissive: 0xc79bff, emissiveIntensity: 0.7 }));
  topFrame.position.set(0, winH / 2 + upperH * 0.74, D / 2 + 0.15); cab.add(topFrame);
  drawTopBonus();
  // lower body + slanted control deck + base
  const lower = new THREE.Mesh(new THREE.BoxGeometry(reelW + 8, lowerH, D), bodyMat);
  lower.position.set(0, -winH / 2 - lowerH / 2, 0); lower.castShadow = true; cab.add(lower);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(reelW + 6, 5, 7), neon(0x1d7a5c));
  deck.position.set(0, -winH / 2 - 4, D / 2 - 1); deck.rotation.x = -0.5; cab.add(deck);
  const base = new THREE.Mesh(new THREE.BoxGeometry(reelW + 12, 3, D + 4), bodyMat);
  base.position.set(0, floorY + 1.5, 0); base.receiveShadow = true; cab.add(base);

  // window bezel frame (front), leaving the window open
  const fT = 1.1, frontZ = D / 2;
  const bar = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.6), neon(0x2bd3a0)); m.position.set(x, y, frontZ); cab.add(m); };
  bar(reelW + fT * 2, fT, 0, winH / 2 + fT / 2); bar(reelW + fT * 2, fT, 0, -winH / 2 - fT / 2);
  bar(fT, winH, -reelW / 2 - fT / 2, 0); bar(fT, winH, reelW / 2 + fT / 2, 0);
  for (let r = 1; r < REELS; r++) { const x = -reelW / 2 + r * (TILE + GAP) - GAP / 2; const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, winH, 0.6), insetMat); m.position.set(x, 0, frontZ - 0.6); cab.add(m); }

  // pull handle (right side, real 3D)
  handle = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 8, 16), new THREE.MeshStandardMaterial({ color: 0xbfc6cc, metalness: 0.85, roughness: 0.3 }));
  rod.position.y = 4; handle.add(rod);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 18), new THREE.MeshStandardMaterial({ color: 0xff5a3c, metalness: 0.3, roughness: 0.35 }));
  knob.position.y = 8; handle.add(knob);
  handle.position.set(sideX + 3, winH / 2 - 3, D / 2 - 1); scene.add(handle);
  handle.userData.base = handle.position.y; handle.userData.pull = 0;

  // ───────── REELS (in front of the back wall, behind the bezel) ─────────
  const clip = [
    new THREE.Plane(new THREE.Vector3(0, -1, 0), winTopY),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -winBotY),
  ];
  const VIS = ROWS + 4;
  for (let r = 0; r < REELS; r++) {
    const strip = machine.strips[r]; const S = strip.length;
    const group = new THREE.Group();
    group.position.set(-reelW / 2 + TILE / 2 + r * (TILE + GAP), 0, frontZ - 2);
    scene.add(group);
    const tiles = [];
    for (let i = 0; i < VIS; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, clippingPlanes: clip });
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(TILE - 0.5, TILE - 0.5), mat);
      group.add(tile); tiles.push(tile);
    }
    reels.push({ group, tiles, strip, S, pos: Math.floor(Math.random() * S), tween: null, VIS });
    layoutReel(reels[r]);
  }

  // (parlor tables/avatars/bar/board now come from the shared module above)

  window.addEventListener('resize', resize);
  animate();
}

// glowing marquee texture with the machine name
function nameMarquee() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#06140e'; c.fillRect(0, 0, 1024, 256);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = '#2bd3a0'; c.shadowBlur = 40; c.fillStyle = '#7ef9da';
  c.font = '900 120px system-ui'; c.fillText((machine.name || 'REELS').toUpperCase(), 512, 138);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, emissive: 0x2bd3a0, emissiveIntensity: 0.5, emissiveMap: tex, roughness: 0.4 });
}

// a ring of small casino tables with low-poly seated patrons, for parlor ambiance
function buildParlor(floorY, dist) {
  const SEAT_COL = [0x2f7fe0, 0xc0392b, 0x27ae60, 0xe67e22, 0x8e44ad, 0x16a085];
  const ringR = dist * 0.62;
  const spots = [
    { a: Math.PI * 0.78, seats: 4 }, { a: Math.PI * 0.22, seats: 4 },
    { a: Math.PI * 1.12, seats: 3 }, { a: Math.PI * 1.88, seats: 3 },
    { a: Math.PI * 1.5, seats: 4 },
  ];
  for (const sp of spots) {
    const tx = Math.cos(sp.a) * ringR, tz = Math.sin(sp.a) * ringR - ringR * 0.15;
    if (tz > dist * 0.2) continue;   // keep tables behind/around, not in front of the camera
    const tbl = new THREE.Group(); tbl.position.set(tx, floorY, tz); scene.add(tbl);
    const TR = 10;   // larger parlor tables than the tiles scene
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(TR, TR, 0.6, 28),
      new THREE.MeshStandardMaterial({ color: 0x14603f, roughness: 0.9 }));
    felt.position.y = 5.4; felt.receiveShadow = true; tbl.add(felt);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.6, 5.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x20140c, roughness: 0.8 }));
    ped.position.y = 2.6; tbl.add(ped);
    // seat the patrons facing the table centre
    for (let s = 0; s < sp.seats; s++) {
      const ang = (s / sp.seats) * Math.PI * 2 + 0.4;
      const av = buildAvatar({ seat: s, seatColor: SEAT_COL[(s + spots.indexOf(sp)) % SEAT_COL.length], scale: 2.2 });
      av.position.set(Math.cos(ang) * (TR + 2.4), 0, Math.sin(ang) * (TR + 2.4));
      av.rotation.y = Math.atan2(-Math.cos(ang), -Math.sin(ang));   // face the table centre (+Z = forward)
      tbl.add(av); avatars.push(av);
    }
  }
}

function resize() {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (camera) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); }
}

function setTileSymbol(tile, id) {
  if (tile.userData.sym === id) return;
  tile.userData.sym = id;
  tile.material.map = symbolTexture(id); tile.material.needsUpdate = true;
}

// place a reel's tiles from its fractional position over the strip
function layoutReel(reel) {
  const base = Math.floor(reel.pos); const frac = reel.pos - base;
  const half = (reel.VIS - 1) / 2;
  for (let i = 0; i < reel.VIS; i++) {
    const k = i - half;
    const idx = ((base + k) % reel.S + reel.S) % reel.S;
    const tile = reel.tiles[i];
    setTileSymbol(tile, reel.strip[idx]);
    tile.position.y = winCenterY + (frac - k) * TILE;
  }
}

// ── spin flow ──
async function spin() {
  if (spinning || !machine) return;
  const free = freeSpins && freeSpins.remaining > 0;
  if (!free && totalBet() > chips) { toast('Not enough chips'); return; }
  spinning = true; $('spinBtn').disabled = true;
  $('roWin').textContent = '0'; hideBanner();
  handle.userData.pull = 1;     // yank the handle
  // start all reels free-spinning
  for (const reel of reels) { reel.tween = null; reel.spinV = 0.9 + Math.random() * 0.3; reel.free = true; }

  let data;
  try {
    const r = await fetch('/api/spin', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: MACHINE, denom, betLevel, lines }),
    });
    data = await r.json();
    if (!r.ok || !data.ok) {
      if (data && data.code === 'BONUS_PENDING') { stopAllImmediately(); openPick(data.pendingPick); }
      else toast((data && data.error) || 'Spin failed');
      endSpin(); return;
    }
  } catch (e) { toast('Spin failed'); endSpin(); return; }

  // pin each reel to the server window via stops (center symbol = strip[(stops+floor(rows/2))])
  const mid = Math.floor(ROWS / 2);
  reels.forEach((reel, r) => {
    reel.free = false;
    const want = (((data.stops[r] + mid) % reel.S) + reel.S) % reel.S;
    const loops = 5 + r * 2;                       // staggered stop
    let to = reel.pos + loops * reel.S;
    const toMod = ((Math.round(to) % reel.S) + reel.S) % reel.S;
    to += (((want - toMod) % reel.S) + reel.S) % reel.S;
    reel.tween = { from: reel.pos, to, t: 0, dur: 1.0 + r * 0.4 };
  });
  reels._result = data;
}

function stopAllImmediately() { for (const reel of reels) { reel.free = false; reel.tween = null; } }

function onLanded(data) {
  chips = data.chips ?? chips;
  freeSpins = data.freeSpins; pendingPick = data.pendingPick; shoe = data.shoe ?? shoe;
  const sess = data.session && data.session.machine;
  if (sess) $('roSess').textContent = (sess.won - sess.wagered >= 0 ? '+' : '') + (sess.won - sess.wagered);
  if (data.payout > 0) {
    $('roWin').textContent = data.payout;
    showBanner(data.bigWin ? 'BIG WIN' : 'WIN', '+' + data.payout, data.bigWin);
    flashWins(data);
    if (data.bigWin) { try { fireConfetti({ count: 200 }); } catch (e) {} }
  }
  if (data.bonus && data.bonus.type === 'freespins') { showBanner('FREE SPINS', '×' + data.bonus.spins, true); try { fireConfetti({ count: 160 }); } catch (e) {} }
  drawTopBonus();
  updateReadouts();
  endSpin();
  if (pendingPick) setTimeout(() => openPick(pendingPick), 700);
}

function endSpin() { spinning = false; $('spinBtn').disabled = false; }

// quick win flash: pulse the winning tiles' scale (wins carry line rows where available)
function flashWins(data) {
  const cells = new Set();
  for (const w of (data.wins || [])) {
    const rowsArr = w.rows || (w.payline && w.payline.rows) || null;
    if (Array.isArray(rowsArr)) rowsArr.forEach((row, r) => cells.add(r + ':' + row));
  }
  reels.forEach((reel, r) => {
    const half = (reel.VIS - 1) / 2;
    for (let row = 0; row < ROWS; row++) {
      const k = row - Math.floor(ROWS / 2);
      const tile = reel.tiles[Math.round(half + k)];
      if (tile && (cells.size === 0 || cells.has(r + ':' + row))) pulse(tile);
    }
  });
}
const pulses = [];
function pulse(tile) { pulses.push({ tile, t: 0 }); }

// ── banners ──
let _banT = null;
function showBanner(big, sub, hold) {
  $('bannerBig').textContent = big; $('bannerSub').textContent = sub;
  $('banner').classList.add('show'); clearTimeout(_banT);
  _banT = setTimeout(hideBanner, hold ? 2600 : 1500);
}
function hideBanner() { $('banner').classList.remove('show'); }

// ── pick bonus ──
function openPick(pp) {
  $('bonusTitle').textContent = pp.label || 'Bonus';
  $('bonusMsg').textContent = 'Pick one to reveal your prize.';
  $('bonusResult').textContent = ''; $('bonusClose').style.display = 'none';
  const host = $('bonusPicks'); host.innerHTML = '';
  for (let i = 0; i < (pp.options || 3); i++) {
    const b = document.createElement('button'); b.className = 'pick'; b.textContent = '?';
    b.onclick = () => resolvePick(i, b);
    host.appendChild(b);
  }
  $('bonus').style.display = 'flex';
}
async function resolvePick(choice, btn) {
  [...$('bonusPicks').children].forEach((b) => b.disabled = true);
  try {
    const r = await fetch('/api/bonus/pick', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) { toast((d && d.error) || 'Bonus failed'); $('bonus').style.display = 'none'; return; }
    btn.textContent = '×' + (d.mult ?? d.picked ?? '✓');
    chips = d.chips ?? chips; pendingPick = null;
    $('bonusResult').textContent = 'You won ' + (d.amount ?? 0) + ' chips!';
    $('bonusClose').style.display = 'inline-block';
    updateReadouts();
  } catch (e) { toast('Bonus failed'); $('bonus').style.display = 'none'; }
}

// ── render loop ──
let _last = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - _last) / 1000 || 0); _last = now;

  for (const reel of reels) {
    if (reel.free) { reel.pos += reel.spinV * 60 * dt; layoutReel(reel); }
    else if (reel.tween) {
      const tw = reel.tween; tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = 1 - Math.pow(1 - k, 3);     // ease-out cubic
      reel.pos = tw.from + (tw.to - tw.from) * e;
      layoutReel(reel);
      if (k >= 1) {
        reel.pos = ((Math.round(tw.to) % reel.S) + reel.S) % reel.S; reel.tween = null; layoutReel(reel);
        // all stopped? settle the result
        if (reels._result && reels.every((x) => !x.tween && !x.free)) { const d = reels._result; reels._result = null; onLanded(d); }
      }
    }
  }

  // handle spring
  if (handle) {
    const target = handle.userData.pull ? -3.2 : 0;
    handle.userData.off = (handle.userData.off || 0) + (target - (handle.userData.off || 0)) * Math.min(1, dt * 10);
    handle.position.y = handle.userData.base + handle.userData.off;
    if (handle.userData.pull && handle.userData.off < -3.0) handle.userData.pull = 0;
  }

  // win pulses
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i]; p.t += dt;
    const s = 1 + 0.18 * Math.sin(Math.min(Math.PI, p.t * 7));
    p.tile.scale.setScalar(s);
    if (p.t > Math.PI / 7) { p.tile.scale.setScalar(1); pulses.splice(i, 1); }
  }

  for (const av of avatars) { const a = av.userData && av.userData.anim; if (a) a.update(dt); }
  if (_parlor) _parlor.update();   // shared parlor: board polling, avatars, win pops

  // pulse the top bonus screen (~8fps redraw)
  _topPulse += dt; _topAcc += dt;
  if (topCtx && _topAcc > 0.12) { _topAcc = 0; drawTopBonus(); }

  controls && controls.update();
  renderer.render(scene, camera);
}

function round(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
