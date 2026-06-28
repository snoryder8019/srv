/**
 * environment3d.js — the world-anchored ROOM around every table.
 *
 * Replaces the old screen-pinned flat backdrop (scene.background = texture, which
 * never moved when you orbited) with a hybrid 3D environment:
 *
 *   1. DOME — the scene image is mapped onto a large inside-out sphere centered on
 *      the table. Because it lives in world space, orbiting/zooming the table moves
 *      the background WITH it (real parallax). This is the "background locked to
 *      the table" behaviour.
 *
 *   2. SATELLITES — a ring of low-poly tables out in the mid-ground, each a real
 *      object showing another live game (game + occupancy). Tap one to go play it.
 *      This is "parallel games / other tables to choose from", for real.
 *
 * Usage (table3d wires this up; games don't touch it directly):
 *   const env = createEnvironment({ scene, THREE, camera, renderer, tableRadius });
 *   env.setDome(url);                       // swap the room image (also the scene picker hook)
 *   env.loadSatellites({ game, tableId });  // fetch + build the other-tables ring
 *   env.update();                           // per frame (cheap; spins the dome a hair)
 */

import { buildAvatar } from './avatar3d.js';

const PORTAL = 'https://games.madladslab.com';
const MATCH = 'https://match.madladslab.com';
const GAME_TINT = {
  blackjack: 0x0e5c3a, baccarat: 0x0b4a6a, craps: 0x0b4d31, roulette: 0x123a2a,
  hearts: 0x3a1530, euchre: 0x143a2a, mahjong: 0x3a2a12, dominoes: 0x176b46,
  reels: 0x2a1147, 'royal-suits': 0x102a4a,
};
// Slot machines always sit on the floor as playable spots (single-player webgames
// on the portal, not tiles tables) — tapping one launches it. They also get a row
// on the back-wall board so the floor reads as a full parlor.
const SLOT_GAMES = [
  { game: 'reels', slot: true, phase: 'lobby', humans: 0, tableId: null },
  { game: 'royal-suits', slot: true, phase: 'lobby', humans: 0, tableId: null },
];

export function createParlor(opts = {}) {
  const { scene, THREE, camera, renderer } = opts;
  if (!scene || !THREE || !camera || !renderer) { console.warn('[parlor] needs scene+THREE+camera+renderer'); return null; }
  const TABLE_R = opts.tableRadius || 34;
  // SHARED parlor used by BOTH tiles + reels. Data endpoints resolve against API
  // (same-origin '' for tiles; the tiles host for reels). Feature flags let a host
  // drop pieces — e.g. reels shows the live board read-only and skips its own betting.
  const API = opts.apiBase || '';
  const FEAT = Object.assign({ betting: true }, opts.features || {});
  const FLOOR_Y = (opts.floorY != null) ? opts.floorY : -8;   // host sets its own floor depth (shallow = real table height)
  // The play surface lives at y=0; the parlor FLOOR (FLOOR_Y above) sits well below
  // it so every table stands on a real pedestal instead of looking sunk. Hosts set
  // their own depth (tiles -15; reels passes its taller cabinet's floor).

  // ---------- DOME ----------
  // Radius must exceed the FURTHEST camera zoom-out (games set maxDistance up to
  // 320) so the camera never falls outside the dome, AND stay under the camera far
  // plane (1600) so the far wall never clips. 460 clears both with margin.
  const DOME_R = 1500;   // spread out — bigger parlor room
  const domeMat = new THREE.MeshBasicMaterial({ color: 0x2a1408, side: THREE.BackSide, fog: false, depthWrite: false });  // mahogany parlor
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 48, 32), domeMat);
  dome.renderOrder = -1;
  scene.add(dome);
  let _domeTex = null;
  function setDome(url) {
    if (!url) return;
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;   // seam runs behind; horizontal wrap is clean
      if (_domeTex) _domeTex.dispose();
      _domeTex = tex;
      domeMat.map = tex; domeMat.color.set(0xffffff); domeMat.needsUpdate = true;
    }, undefined, () => { /* keep flat dome color */ });
  }

  // ---------- BACK-WALL SCOREBOARD ----------
  // A big neon (green↔blue) board high on the back wall listing every live table:
  // game, phase, players, and live progress/score. Fed by the same list the
  // satellites use (socket push + poll), so it stays live with the floor.
  const SB_W = 1024, SB_H = 576;
  const sbCanvas = document.createElement('canvas'); sbCanvas.width = SB_W; sbCanvas.height = SB_H;
  const sbCtx = sbCanvas.getContext('2d');
  const sbTex = new THREE.CanvasTexture(sbCanvas); sbTex.colorSpace = THREE.SRGBColorSpace;
  const sbMat = new THREE.MeshBasicMaterial({ map: sbTex, transparent: true, fog: false, side: THREE.DoubleSide, depthWrite: false });
  const sbMesh = new THREE.Mesh(new THREE.PlaneGeometry(520, 292), sbMat);
  sbMesh.renderOrder = 0;
  scene.add(sbMesh);
  // Portrait phones have a narrow horizontal FOV, so a wide board reads HUGE and
  // up-in-your-face. Scale it down + push it further back on small/portrait screens.
  function fitScoreboard() {
    const a = window.innerWidth / window.innerHeight;
    // LIVE TABLES board sits to the LEFT of the bar; on a phone keep it centered so
    // the narrow FOV doesn't shove it off-screen.
    if (a < 0.85) { sbMesh.scale.setScalar(0.46); sbMesh.position.set(-80, 150, -700); }
    else if (a < 1.25) { sbMesh.scale.setScalar(0.62); sbMesh.position.set(-300, 150, -585); }
    else { sbMesh.scale.setScalar(0.82); sbMesh.position.set(-490, 168, -535); }
  }
  fitScoreboard();
  window.addEventListener('resize', fitScoreboard);

  // ════════ MAHOGANY PARLOR FURNITURE (built once) ════════
  function makeWood(base, streak) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#' + base.toString(16).padStart(6, '0'); c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 80; i++) {
      c.globalAlpha = 0.04 + Math.random() * 0.10;
      c.strokeStyle = '#' + streak.toString(16).padStart(6, '0');
      c.lineWidth = 0.5 + Math.random() * 2.2;
      const x = Math.random() * 256;
      c.beginPath(); c.moveTo(x, 0);
      c.bezierCurveTo(x + (Math.random() - 0.5) * 26, 85, x + (Math.random() - 0.5) * 26, 170, x + (Math.random() - 0.5) * 18, 256);
      c.stroke();
    }
    c.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  const mahogany = new THREE.MeshStandardMaterial({ map: makeWood(0x4a2410, 0x2a1208), roughness: 0.55, metalness: 0.15 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8860b, metalness: 0.85, roughness: 0.3 });
  const bookTargets = [];   // meshes that open the betting panel when tapped

  // wood floor under the whole parlor
  const floorTex = makeWood(0x3a1c0e, 0x1a0c06); floorTex.repeat.set(12, 12);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(DOME_R * 0.82, 64), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; scene.add(floor);

  // ── shotgun bar under the scoreboard ──
  const bar = new THREE.Group(); bar.position.set(0, FLOOR_Y, -470); scene.add(bar);
  const BL = 320, BH = 26, BD = 20;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(BL, 3, BD), new THREE.MeshStandardMaterial({ map: makeWood(0x5a2c12, 0x301406), roughness: 0.4, metalness: 0.2 }));
  counter.position.y = BH; bar.add(counter); counter.userData.book = true; bookTargets.push(counter);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(BL, BH, 2), mahogany); apron.position.set(0, BH / 2, BD / 2 - 1); bar.add(apron);
  const footrail = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, BL, 16), brass); footrail.rotation.z = Math.PI / 2; footrail.position.set(0, 5, BD / 2 + 3); bar.add(footrail);
  const backbar = new THREE.Mesh(new THREE.BoxGeometry(BL, 42, 4), mahogany); backbar.position.set(0, 23, -BD / 2 - 8); bar.add(backbar);
  for (let i = 0; i < BL / 9; i++) {
    const col = [0x2e7d32, 0x8e1c1c, 0xd4a017, 0x6b3a1e, 0x355e3b][i % 5];
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.3, 5.5, 8), new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.2 }));
    bottle.position.set(-BL / 2 + 7 + i * 9, 27, -BD / 2 - 6); bar.add(bottle);
  }
  const parlorAvatars = [];   // idle-animated patrons + bartenders
  for (let i = -3; i <= 3; i++) {
    const stool = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.2, 16), new THREE.MeshStandardMaterial({ color: 0x6b1f1f, roughness: 0.6 })); seat.position.y = 16; stool.add(seat);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 16, 12), brass); post.position.y = 8; stool.add(post);
    stool.position.set(i * 42, 0, BD / 2 + 10); bar.add(stool);
    // a patron on some stools, facing the bar (−Z)
    if (i % 2 === 0) {
      try {
        const p = buildAvatar({ seat: i + 3, seatColor: [0x2f7fe0, 0xc0392b, 0x27ae60, 0xe67e22][(i + 3) % 4], scale: 3 });
        p.position.set(i * 42, 0, BD / 2 + 13); p.rotation.y = Math.PI;   // face the bar
        bar.add(p); parlorAvatars.push(p);
      } catch (e) {}
    }
  }
  // bartenders BEHIND the bar, facing the patrons (+Z)
  for (const bx of [-BL / 4, BL / 8]) {
    try {
      const t = buildAvatar({ seat: 9, seatColor: 0x10303a, scale: 3 });
      t.position.set(bx, 0, -BD / 2 - 3); t.rotation.y = 0;   // face the front
      bar.add(t); parlorAvatars.push(t);
    } catch (e) {}
  }

  // ── bar board: cycles SPORTSBOOK ⇄ KENO (simulated draws + bets) ──
  const BB_W = 1024, BB_H = 384;
  const bbCv = document.createElement('canvas'); bbCv.width = BB_W; bbCv.height = BB_H;
  const bbCtx = bbCv.getContext('2d');
  const bbTex = new THREE.CanvasTexture(bbCv); bbTex.colorSpace = THREE.SRGBColorSpace;
  const bbMesh = new THREE.Mesh(new THREE.PlaneGeometry(384, 144), new THREE.MeshBasicMaterial({ map: bbTex, transparent: true, fog: false }));
  bbMesh.position.set(40, 128, -505); scene.add(bbMesh);   // raised up + slightly right (board is left)
  const bbFrame = new THREE.Mesh(new THREE.BoxGeometry(398, 158, 3), mahogany); bbFrame.position.set(40, 128, -509); scene.add(bbFrame);

  // Board now shows REAL data from the server: live ESPN scores + the authoritative
  // 25s keno draw. Polled, not simulated.
  let bookSports = [], bookKeno = null;
  let boardMode = 'sports', _bbCycle = 0, _bbRedraw = 0, _bbPollS = 99, _bbPollK = 99;

  function drawBarBoard() {
    const c = bbCtx; c.clearRect(0, 0, BB_W, BB_H);
    c.fillStyle = 'rgba(10,6,2,0.93)'; roundRect(c, 6, 6, BB_W - 12, BB_H - 12, 22); c.fill();
    c.strokeStyle = 'rgba(184,134,11,.5)'; c.lineWidth = 4; roundRect(c, 10, 10, BB_W - 20, BB_H - 20, 20); c.stroke();
    if (boardMode === 'sports') {
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.save(); c.shadowColor = 'rgba(255,180,90,.9)'; c.shadowBlur = 18; c.fillStyle = '#ffd9a3'; c.font = '800 44px system-ui';
      c.fillText('SPORTSBOOK', 40, 62); c.restore();
      c.fillStyle = '#7e9388'; c.font = '600 22px system-ui'; c.fillText('live scores · tap the bar to bet', 360, 58);
      const games = (bookSports || []).slice(0, 4);
      if (!games.length) { c.fillStyle = '#5f8478'; c.font = '600 28px system-ui'; c.fillText('loading live scores…', 40, 140); }
      let y = 116;
      for (const g of games) {
        c.fillStyle = '#7e9388'; c.textAlign = 'left'; c.font = '600 18px system-ui'; c.fillText(g.league, 50, y - 24);
        c.fillStyle = '#eafff2'; c.font = '700 30px system-ui';
        c.fillText(g.away, 50, y); c.fillText(g.home, 250, y);
        c.fillStyle = '#ffd34d'; c.textAlign = 'right'; c.font = '800 32px system-ui';
        c.fillText('' + g.as, 210, y); c.fillText('' + g.hs, 410, y);
        c.fillStyle = g.state === 'post' ? '#ff6a5a' : g.state === 'in' ? '#46e0c0' : '#bfe9ff'; c.textAlign = 'left'; c.font = '600 20px system-ui';
        c.fillText((g.detail || '').slice(0, 18), 460, y);
        c.fillStyle = '#e3c567'; c.textAlign = 'right'; c.font = '700 22px system-ui';
        c.fillText(`${g.away} ${g.odds.away}  ·  ${g.home} ${g.odds.home}`, BB_W - 40, y);
        y += 60;
      }
    } else {
      c.textAlign = 'left'; c.save(); c.shadowColor = 'rgba(120,240,205,.9)'; c.shadowBlur = 18; c.fillStyle = '#7ef9da'; c.font = '800 44px system-ui';
      c.fillText('KENO', 40, 62); c.restore();
      const k = bookKeno || { phase: 'open', secsLeft: 0, drawId: 0, drawn: [], last: { drawn: [] } };
      const shown = (k.phase === 'open' ? (k.last && k.last.drawn) || [] : k.drawn) || [];
      let sub;
      if (k.phase === 'open') { const s = k.secsLeft || 0; sub = 'Game #' + k.drawId + ' · next draw 0:' + (s < 10 ? '0' : '') + s + ' · tap bar to play'; }
      else if (k.phase === 'draw') sub = 'Game #' + k.drawId + ' · DRAWING…';
      else sub = 'Game #' + k.drawId + ' · RESULTS';
      c.fillStyle = k.phase === 'open' ? '#e3c567' : '#7ef9da'; c.font = '700 22px system-ui'; c.fillText(sub, 160, 58);
      const cols = 20, cw = (BB_W - 80) / cols, ch = 60, ox = 40, oy = 92;
      for (let n = 1; n <= 80; n++) {
        const i = n - 1, col = i % cols, row = Math.floor(i / cols);
        const x = ox + col * cw, y = oy + row * ch, hit = shown.includes(n);
        c.fillStyle = hit ? 'rgba(120,240,205,.92)' : 'rgba(40,24,12,.55)';
        roundRect(c, x + 2, y + 2, cw - 4, ch - 8, 6); c.fill();
        c.fillStyle = hit ? '#06140e' : '#9bb0a6'; c.textAlign = 'center'; c.font = (hit ? '800 ' : '600 ') + '24px system-ui';
        c.fillText('' + n, x + cw / 2, y + ch / 2 + 6);
      }
    }
    bbTex.needsUpdate = true;
  }
  function tickBarBoard(dt) {
    _bbCycle += dt; _bbPollS += dt; _bbPollK += dt;
    if (_bbCycle > 11) { _bbCycle = 0; boardMode = boardMode === 'sports' ? 'keno' : 'sports'; }
    if (_bbPollS > 18) { _bbPollS = 0; fetch(API + '/book/sports', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d && d.games) bookSports = d.games; }).catch(() => {}); }
    if (_bbPollK > 1.4) { _bbPollK = 0; fetch(API + '/book/keno', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d && d.ok) bookKeno = d; }).catch(() => {}); }
    _bbRedraw += dt; if (_bbRedraw > 0.4) { _bbRedraw = 0; drawBarBoard(); }
  }
  drawBarBoard();
  bbMesh.userData.book = true; bookTargets.push(bbMesh);   // tap the board OR the bar to open betting

  function drawScoreboard(list) {
    const c = sbCtx; c.clearRect(0, 0, SB_W, SB_H);
    // glass panel
    c.fillStyle = 'rgba(4,16,20,0.9)'; roundRect(c, 8, 8, SB_W - 16, SB_H - 16, 30); c.fill();
    // neon frame (cyan-green glow)
    c.save(); c.shadowColor = 'rgba(70,240,205,0.95)'; c.shadowBlur = 26;
    c.strokeStyle = 'rgba(90,240,205,0.9)'; c.lineWidth = 5; roundRect(c, 10, 10, SB_W - 20, SB_H - 20, 28); c.stroke(); c.restore();
    // title
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.save(); c.shadowColor = 'rgba(80,200,255,0.95)'; c.shadowBlur = 24;
    c.fillStyle = '#7ef9da'; c.font = '800 54px system-ui'; c.fillText('LIVE  TABLES', SB_W / 2, 72); c.restore();
    c.strokeStyle = 'rgba(90,210,235,0.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(42, 100); c.lineTo(SB_W - 42, 100); c.stroke();

    const rows = (list || []).filter((t) => t && t.game).slice(0, 9);
    if (!rows.length) {
      c.fillStyle = '#5f8478'; c.font = '600 34px system-ui'; c.fillText('no live tables — be the first to sit down', SB_W / 2, 320);
      sbTex.needsUpdate = true; return;
    }
    const top = 150, rowH = 46;
    rows.forEach((t, i) => {
      const y = top + i * rowH;
      if (i % 2 === 0) { c.fillStyle = 'rgba(24,70,72,0.20)'; roundRect(c, 30, y - 30, SB_W - 60, 40, 10); c.fill(); }
      const phase = t.phase || 'lobby';
      // game name (neon green; slots get a 🎰)
      c.textAlign = 'left';
      c.save(); c.shadowColor = 'rgba(60,240,190,0.85)'; c.shadowBlur = 12;
      c.fillStyle = t.slot ? '#d9b8ff' : '#9ffbe0'; c.font = '700 34px system-ui';
      c.fillText((t.slot ? '🎰 ' : '') + cap(t.game), 48, y); c.restore();
      // phase / type tag
      let pcol, ptxt;
      if (t.slot) { pcol = '#c79bff'; ptxt = 'SLOTS'; }
      else if (phase === 'playing') { pcol = '#46e0c0'; ptxt = '● LIVE'; }
      else if (phase === 'gameOver') { pcol = '#e0795a'; ptxt = 'OVER'; }
      else { pcol = '#e3c567'; ptxt = 'OPEN'; }
      c.fillStyle = pcol; c.font = '700 24px system-ui'; c.fillText(ptxt, 412, y - 2);
      // players
      const players = t.slot ? '—' : ((t.humans != null ? t.humans : 0) + (t.seatCount ? ('/' + t.seatCount) : ''));
      c.fillStyle = '#8fd6ad'; c.font = '600 25px system-ui'; c.fillText('● ' + players, 580, y - 2);
      // progress / score (neon blue, right)
      let prog = '—';
      if (t.slot) prog = 'play ▸';
      else if (t.casino) prog = phase === 'playing' ? 'in play' : 'open';
      else if (t.topScore != null && (t.handNo || t.gamesPlayed)) prog = 'top ' + t.topScore;
      else if (t.handNo) prog = 'hand ' + t.handNo;
      c.textAlign = 'right';
      c.save(); c.shadowColor = 'rgba(80,200,255,0.8)'; c.shadowBlur = 12;
      c.fillStyle = '#bfe9ff'; c.font = '700 27px system-ui'; c.fillText(prog, SB_W - 50, y); c.restore();
    });
    sbTex.needsUpdate = true;
  }
  drawScoreboard([]);   // initial empty board

  // ---------- SATELLITES (the living parlor floor) ----------
  const satGroup = new THREE.Group();
  scene.add(satGroup);
  const satTargets = [];          // pickable felt discs (userData carries the table info)
  const satById = new Map();      // tableId -> { group, info, mine }
  const winAnims = [];            // active from-afar big-win pops
  const seenWin = new Map();      // tableId -> last win ts we animated (poll de-dupe)
  let _onPick = null, _pollTimer = null, _ctx = {};

  // Is this table one of MY <=3 games? The room shell publishes this bridge.
  const isMine = (id) => !!(id && window.__mllRoom && window.__mllRoom.isMine && window.__mllRoom.isMine(id));

  function makeLabel(line1, line2, accent) {
    const cvs = document.createElement('canvas'); cvs.width = 512; cvs.height = 256;
    const c = cvs.getContext('2d');
    c.fillStyle = 'rgba(8,18,13,.80)'; roundRect(c, 14, 56, 484, 150, 22); c.fill();
    c.strokeStyle = accent || 'rgba(120,200,160,.5)'; c.lineWidth = 4; roundRect(c, 14, 56, 484, 150, 22); c.stroke();
    c.textAlign = 'center';
    c.fillStyle = '#eafff2'; c.font = '800 60px system-ui'; c.fillText(line1, 256, 122);
    c.fillStyle = accent ? '#ffe9a8' : '#8fd6ad'; c.font = '600 36px system-ui'; c.fillText(line2, 256, 174);
    const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(40, 20, 1);
    return spr;
  }

  // mini 3x3 reel face for a slot machine's screen
  function slotFaceTexture() {
    const cv = document.createElement('canvas'); cv.width = 384; cv.height = 340;
    const c = cv.getContext('2d');
    c.fillStyle = '#05030c'; c.fillRect(0, 0, 384, 340);
    const syms = ['🍒', '🔔', '7', '💎', '★', '🍋', 'BAR'];
    const cw = 118, ch = 100, gx = 12, gy = 14;
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
      const x = gx + col * (cw + 6), y = gy + r * (ch + 6);
      c.fillStyle = '#150b28'; roundRect(c, x, y, cw, ch, 12); c.fill();
      c.strokeStyle = 'rgba(155,107,255,.55)'; c.lineWidth = 3; roundRect(c, x, y, cw, ch, 12); c.stroke();
      const s = syms[(r * 5 + col * 3 + 1) % syms.length];
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = '#c79bff'; c.shadowBlur = 18; c.fillStyle = '#ecdcff';
      c.font = (s.length <= 2 ? '800 70px' : '800 30px') + ' system-ui';
      c.fillText(s, x + cw / 2, y + ch / 2); c.shadowBlur = 0;
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  // neon marquee nameplate
  function neonNameTexture(name) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const c = cv.getContext('2d'); c.fillStyle = '#0a0416'; c.fillRect(0, 0, 512, 128);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#c79bff'; c.shadowBlur = 30;
    c.fillStyle = '#f1e6ff'; c.font = '900 64px system-ui';
    c.fillText(String(name).toUpperCase().slice(0, 12), 256, 72);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }

  function buildSatellite(info, angle, radius) {
    const mine = isMine(info.tableId);
    const slot = !!info.slot;
    const g = new THREE.Group();
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    g.position.set(x, FLOOR_Y, z);   // satellites stand on the floor like the main table

    // ── SLOTS render as a little upright machine, NOT a felt table disc ──
    if (slot) {
      g.rotation.y = Math.atan2(-x, -z);   // face the room centre (player)
      // mahogany-sided cabinet with a neon screen + a chrome pull handle on the side
      const body = new THREE.Mesh(new THREE.BoxGeometry(15, 24, 9), mahogany);
      body.position.y = 13; body.userData.satellite = info;
      g.add(body); satTargets.push(body);
      // neon edge trim
      for (const s of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.6, 24, 0.6),
          new THREE.MeshStandardMaterial({ color: 0x0a1a14, emissive: 0x9b6bff, emissiveIntensity: 0.9 }));
        edge.position.set(s * 7.6, 13, 4.6); g.add(edge);
      }
      // skinned screen: an actual mini reel face on the front (unlit = bright like a screen)
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(11, 10),
        new THREE.MeshBasicMaterial({ map: slotFaceTexture() }));
      screen.position.set(0, 15, 4.6); g.add(screen);
      // skinned marquee hood: the machine name in neon
      const nameTex = neonNameTexture(cap(info.game));
      const hood = new THREE.Mesh(new THREE.BoxGeometry(16, 3.4, 9.6),
        new THREE.MeshStandardMaterial({ map: nameTex, emissive: 0xc79bff, emissiveMap: nameTex, emissiveIntensity: 0.85, roughness: 0.4 }));
      hood.position.y = 25.5; g.add(hood);
      // slanted button deck
      const deck = new THREE.Mesh(new THREE.BoxGeometry(13, 3, 4),
        new THREE.MeshStandardMaterial({ color: 0x140a24, emissive: 0x3a1147, emissiveIntensity: 0.4, roughness: 0.5 }));
      deck.position.set(0, 6.5, 5.2); deck.rotation.x = -0.5; g.add(deck);
      // chrome pull handle on the right side
      const harm = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 7, 12),
        new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.9, roughness: 0.25 }));
      harm.position.set(8.4, 16, 1); g.add(harm);
      const hball = new THREE.Mesh(new THREE.SphereGeometry(1.2, 18, 14),
        new THREE.MeshStandardMaterial({ color: 0xd11a1a, metalness: 0.3, roughness: 0.35 }));
      hball.position.set(8.4, 20, 1); g.add(hball);
      // base
      const base = new THREE.Mesh(new THREE.BoxGeometry(17, 2, 11), mahogany);
      base.position.y = 1; g.add(base);
      const label = makeLabel('🎰 ' + cap(info.game), 'tap to play', 'rgba(176,139,255,.9)');
      label.position.set(0, 32, 0); g.add(label);
      g.userData.labelY = 32;
      satGroup.add(g);
      return g;
    }

    const r = 20;            // table-top radius
    const TOP = -FLOOR_Y;    // felt rises from the floor to the play-surface level (y=0)
    // WIDE, short table body (not a narrow podium) so it reads as a real table
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.66, TOP, 28), mahogany);
    ped.position.y = TOP / 2; g.add(ped);
    const tbase = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.78, 1.2, 28), mahogany);
    tbase.position.y = 0.6; g.add(tbase);
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.2, 44),
      new THREE.MeshStandardMaterial({ color: GAME_TINT[info.game] || 0x176b46, roughness: 0.95 }));
    felt.position.y = TOP; felt.userData.satellite = info;
    g.add(felt); satTargets.push(felt);
    // rail: gold if it's YOUR table, wood otherwise
    const railColor = mine ? 0xe3c567 : 0x5b3a1e;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(r + 0.7, 0.85, 12, 60),
      new THREE.MeshStandardMaterial({ color: railColor, roughness: 0.6, emissive: mine ? 0x4a3a00 : 0x000000 }));
    rail.rotation.x = -Math.PI / 2; rail.position.y = TOP + 0.6; g.add(rail);
    // analytics line: your table -> switch; slot -> play; others -> who/occupancy
    let line1 = cap(info.game), line2;
    if (slot) { line1 = '🎰 ' + cap(info.game); line2 = 'tap to play'; }
    else if (mine) line2 = '▶ tap to switch';
    else if (info.humans > 0) line2 = info.names && info.names.length ? `${info.names[0]}${info.humans > 1 ? ` +${info.humans - 1}` : ''}` : `${info.humans} playing`;
    else line2 = info.phase === 'lobby' ? 'open · sit down' : 'open';
    const label = makeLabel(line1, line2, mine ? 'rgba(227,197,103,.9)' : slot ? 'rgba(176,139,255,.9)' : null);
    label.position.set(0, 30, 0); g.add(label);
    g.userData.labelY = 30;
    satGroup.add(g);
    if (info.tableId) satById.set(info.tableId, { group: g, info, mine });
    return g;
  }

  function clearSatellites() {
    satTargets.length = 0; satById.clear();
    while (satGroup.children.length) {
      const g = satGroup.children.pop();
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      satGroup.remove(g);
    }
  }

  function applyList(list, game) {
    // slots always show as floor spots + board rows; live tables come first
    const slots = SLOT_GAMES.filter((s) => s.game !== game);
    // the scoreboard shows the REAL live tables (+ slots), so it reflects the floor.
    drawScoreboard((list || []).concat(slots));
    if (!list.length) {
      list = Object.keys(GAME_TINT).filter((g) => g !== game && !SLOT_GAMES.some((s) => s.game === g))
        .slice(0, 5).map((g) => ({ game: g, phase: 'lobby', humans: 0, tableId: null }));
    }
    // ring = live/placeholder tables + the slot machines, capped so it stays readable
    list = list.slice(0, 6).concat(slots).slice(0, 8);
    clearSatellites();
    // ASYMMETRIC scatter — hand-placed angle + radius multipliers so the parlor
    // feels like a real floor, not an evenly-spaced ring. The front/player side
    // (angles near +PI/2, toward the camera) is left open so nothing blocks your table.
    const R = TABLE_R + 120;
    const SPOTS = [
      { a: -1.20 * Math.PI, r: 0.92 }, { a: -0.96 * Math.PI, r: 1.34 }, { a: -0.72 * Math.PI, r: 1.02 },
      { a: -0.50 * Math.PI, r: 1.48 }, { a: -0.28 * Math.PI, r: 0.88 }, { a: -0.06 * Math.PI, r: 1.26 },
      { a: 0.16 * Math.PI, r: 1.04 }, { a: -0.84 * Math.PI, r: 0.72 },
    ];
    list.forEach((info, i) => {
      const sp = SPOTS[i % SPOTS.length];
      buildSatellite(info, sp.a, R * sp.r);
    });
    // fire from-afar pops for wins that happened while we were away / on others' tables
    for (const info of list) {
      if (info.lastWin && info.tableId && info.lastWin.ts > (seenWin.get(info.tableId) || 0)) {
        seenWin.set(info.tableId, info.lastWin.ts);
        bigWin(info.tableId, info.lastWin.amount, info.lastWin.name);
      }
    }
  }

  function refresh() {
    const { game, tableId } = _ctx;
    fetch(API + '/scene/tables' + (tableId ? `?exclude=${encodeURIComponent(tableId)}` : ''), { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => applyList((d && d.tables) || [], game))
      .catch(() => {});
  }

  // Fetch other live tables (poll keeps occupancy + wins fresh). Tap behaviour:
  //   • one of YOUR tables → fly/switch to it (room shell)
  //   • another LIVE table → SIT DOWN there (take an open seat / a bot's seat) via
  //     match /sit — you walk up to that exact table instead of spawning a new one
  //   • a game-type placeholder (no live table) → launch that game fresh
  function loadSatellites({ game, tableId, onPick } = {}) {
    _ctx = { game, tableId };
    _onPick = onPick || ((info) => {
      if (info.tableId && isMine(info.tableId) && window.__mllRoom && window.__mllRoom.switchTo) { window.__mllRoom.switchTo(info.tableId); return; }
      if (info.tableId && info.phase !== 'gameOver') {
        // sit at THIS table (server takes an open seat, else displaces a bot)
        location.href = `${MATCH}/sit?platform=tiles&tableId=${encodeURIComponent(info.tableId)}&game=${encodeURIComponent(info.game)}`;
        return;
      }
      location.href = `${PORTAL}/arcade/${encodeURIComponent(info.game)}/play`;
    });
    refresh();
    // slow poll is now just a FALLBACK; the server pushes parlor:tables live (3s)
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(refresh, 15000);
  }

  // ---------- from-afar BIG WIN animation ----------
  function bigWin(tableId, amount, name) {
    const sat = satById.get(tableId);
    if (!sat) return;
    // de-dupe socket-push vs poll for the same win within a short window
    const now = performance.now();
    if (sat._lastPop && now - sat._lastPop < 2500) return;
    sat._lastPop = now;
    const cvs = document.createElement('canvas'); cvs.width = 512; cvs.height = 256;
    const c = cvs.getContext('2d'); c.textAlign = 'center';
    c.fillStyle = '#ffe9a8'; c.font = '900 76px system-ui'; c.fillText('💰 BIG WIN', 256, 96);
    c.fillStyle = '#e3c567'; c.font = '800 70px system-ui'; c.fillText('+' + amount, 256, 176);
    const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0 }));
    spr.scale.set(30, 15, 1);
    spr.position.copy(sat.group.position); spr.position.y = 16;
    satGroup.add(spr);
    winAnims.push({ spr, t: 0, baseY: 16 });
  }

  // ---------- tap-to-pick (distinguish a tap from an orbit drag) ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0, downT = 0;
  function onDown(e) { downX = e.clientX; downY = e.clientY; downT = e.timeStamp; }
  function onUp(e) {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8 || e.timeStamp - downT > 350) return; // was a drag
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    // the bar / book board opens the betting panel (hosts without betting skip it)
    if (FEAT.betting && bookTargets.length) {
      const bh = ray.intersectObjects(bookTargets, false)[0];
      if (bh) { openBook(); return; }
    }
    if (!satTargets.length) return;
    const hit = ray.intersectObjects(satTargets, false)[0];
    if (hit && hit.object.userData.satellite && _onPick) _onPick(hit.object.userData.satellite);
  }
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  // ════════ BETTING PANEL — keno + sportsbook, wagered from the wallet ════════
  let _bookEl = null, _bookPoll = null, _bookTab = 'keno', _bookMine = null, _bookChips = null;
  const _kenoPick = new Set();
  function setChips(v) { if (v != null) _bookChips = v; const c = _bookEl && _bookEl.querySelector('#bkChips'); if (c) c.textContent = '🪙 ' + (_bookChips != null ? _bookChips : '—'); }
  function bkToast(msg, good) { const t = _bookEl && _bookEl.querySelector('#bkMsg'); if (t) { t.textContent = msg; t.style.color = good === false ? '#ff8a6a' : '#7ef9da'; } }

  function openBook() {
    if (_bookEl) { _bookEl.style.display = 'flex'; startBookPoll(); return; }
    const el = document.createElement('div'); _bookEl = el;
    el.style.cssText = 'position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;background:rgba(3,6,4,.78);pointer-events:auto;font-family:system-ui';
    el.innerHTML =
      '<div style="background:#0d1a14;border:1px solid #b8860b;border-radius:16px;width:min(700px,95vw);max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #1f3a2e">' +
          '<b style="color:#e3c567;letter-spacing:.08em">🍸 THE BAR</b>' +
          '<span id="bkChips" style="margin-left:auto;color:#8fd6ad;font-weight:700">🪙 —</span>' +
          '<button id="bkClose" style="border:none;background:#243a30;color:#cfe7d8;border-radius:8px;padding:6px 11px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;padding:10px 16px 4px"><button id="bkTabK" class="bkTab">KENO</button><button id="bkTabS" class="bkTab">SPORTSBOOK</button></div>' +
        '<div id="bkMsg" style="min-height:18px;padding:2px 16px;font-size:12px;font-weight:700;color:#7ef9da"></div>' +
        '<div id="bkBody" style="padding:4px 16px 18px"></div></div>';
    document.body.appendChild(el);
    const st = document.createElement('style');
    st.textContent = '.bkTab{flex:1;border:1px solid #1f3a2e;background:#11201a;color:#cfe7d8;border-radius:9px;padding:9px;font-weight:800;cursor:pointer}.bkTab.on{background:#e3c567;color:#0c1a10;border-color:#e3c567}.kn{aspect-ratio:1;border:1px solid #25402f;background:#10201a;color:#9bb0a6;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px;padding:0}.kn.on{background:#46e0c0;color:#06140e;border-color:#46e0c0}.kn.hit{outline:2px solid #e3c567}.bkbtn{border:none;border-radius:9px;padding:10px 14px;font-weight:800;cursor:pointer;background:#e3c567;color:#0c1a10}.bkbtn:disabled{opacity:.5}.sbet{border:1px solid #2d5a44;background:#16291f;color:#e9ecef;border-radius:8px;padding:6px 9px;font-weight:700;cursor:pointer}';
    el.appendChild(st);
    el.querySelector('#bkClose').onclick = closeBook;
    el.onclick = (e) => { if (e.target === el) closeBook(); };
    el.querySelector('#bkTabK').onclick = () => { _bookTab = 'keno'; renderBook(); };
    el.querySelector('#bkTabS').onclick = () => { _bookTab = 'sports'; renderBook(); };
    renderBook(); startBookPoll();
  }
  function closeBook() { if (_bookEl) _bookEl.style.display = 'none'; stopBookPoll(); }
  function startBookPoll() { stopBookPoll(); _bookPoll = setInterval(refreshBook, 1600); refreshBook(); }
  function stopBookPoll() { if (_bookPoll) clearInterval(_bookPoll); _bookPoll = null; }

  async function refreshBook() {
    try { const d = await (await fetch(API + '/book/mybets', { credentials: 'include' })).json(); _bookMine = d; if (d && d.chips != null) setChips(d.chips); } catch (e) {}
    try { bookKeno = await (await fetch(API + '/book/keno', { credentials: 'include' })).json(); } catch (e) {}
    updateBookDynamic();
  }

  function renderBook() {
    if (!_bookEl) return;
    _bookEl.querySelector('#bkTabK').classList.toggle('on', _bookTab === 'keno');
    _bookEl.querySelector('#bkTabS').classList.toggle('on', _bookTab === 'sports');
    const body = _bookEl.querySelector('#bkBody');
    if (_bookTab === 'keno') {
      let grid = '<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin:6px 0">';
      for (let n = 1; n <= 80; n++) grid += `<button class="kn${_kenoPick.has(n) ? ' on' : ''}" data-n="${n}">${n}</button>`;
      grid += '</div>';
      body.innerHTML =
        '<div id="bkKenoStatus" style="color:#8fd6ad;font-weight:700;margin:4px 0">…</div>' + grid +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
          '<span style="color:#7e9388;font-size:12px">Picked <b id="bkPickN">0</b>/10 · pays the catch table</span>' +
          '<input id="bkKWager" type="number" min="1" value="10" style="margin-left:auto;width:80px;padding:8px;border-radius:8px;border:1px solid #2d5a44;background:#0a1712;color:#eafff2">' +
          '<button class="bkbtn" id="bkKBet">PLACE BET</button>' +
          '<button class="sbet" id="bkKClear">Clear</button>' +
        '</div><div id="bkKResult" style="margin-top:8px;color:#e3c567;font-weight:700"></div>';
      body.querySelectorAll('.kn').forEach((b) => { b.onclick = () => toggleKeno(Number(b.dataset.n), b); });
      body.querySelector('#bkKClear').onclick = () => { _kenoPick.clear(); renderBook(); };
      body.querySelector('#bkKBet').onclick = placeKeno;
    } else {
      body.innerHTML = '<div id="bkSList" style="display:flex;flex-direction:column;gap:8px;margin-top:6px">loading live games…</div>' +
        '<div id="bkSMine" style="margin-top:12px"></div>';
      renderSportsList();
    }
    updateBookDynamic();
  }

  function toggleKeno(n, btn) {
    if (_kenoPick.has(n)) _kenoPick.delete(n);
    else { if (_kenoPick.size >= 10) { bkToast('max 10 numbers', false); return; } _kenoPick.add(n); }
    btn.classList.toggle('on'); const p = _bookEl.querySelector('#bkPickN'); if (p) p.textContent = _kenoPick.size;
  }
  async function placeKeno() {
    const w = Math.floor(Number(_bookEl.querySelector('#bkKWager').value) || 0);
    if (_kenoPick.size < 1) return bkToast('pick at least 1 number', false);
    const r = await (await fetch(API + '/book/keno/bet', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spots: [..._kenoPick], wager: w }) })).json();
    if (!r.ok) return bkToast(r.error || 'bet failed', false);
    setChips(r.chips); bkToast(`bet in for draw #${r.drawId} — good luck!`); _kenoPick.clear(); renderBook();
  }

  function renderSportsList() {
    const host = _bookEl && _bookEl.querySelector('#bkSList'); if (!host) return;
    const games = (bookSports || []).filter((g) => g.state === 'pre' || g.state === 'in').slice(0, 8);
    if (!games.length) { host.innerHTML = '<div style="color:#5f8478">no games open for betting right now</div>'; return; }
    const fmt = (n) => (n > 0 ? '+' : '') + n;
    host.innerHTML = games.map((g) => {
      const live = g.state === 'in';
      let rows = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">' +
        `<button class="sbet" data-g="${g.id}" data-t="ml" data-s="away">${g.away} ML ${g.odds.away}</button>` +
        `<button class="sbet" data-g="${g.id}" data-t="ml" data-s="home">${g.home} ML ${g.odds.home}</button>` +
        `<button class="sbet" data-g="${g.id}" data-t="spread" data-s="away">${g.away} ${fmt(-g.spread)}</button>` +
        `<button class="sbet" data-g="${g.id}" data-t="spread" data-s="home">${g.home} ${fmt(g.spread)}</button>`;
      if (live) rows +=
        `<button class="sbet" style="border-color:#e3c567;color:#e3c567" data-g="${g.id}" data-t="quarter" data-s="away">${g.away} Q${g.period}</button>` +
        `<button class="sbet" style="border-color:#e3c567;color:#e3c567" data-g="${g.id}" data-t="quarter" data-s="home">${g.home} Q${g.period}</button>`;
      rows += '</div>';
      return '<div style="border:1px solid #1f3a2e;border-radius:10px;padding:9px 11px">' +
        `<div style="display:flex;align-items:center;gap:8px"><div style="font-weight:700">${g.awayName} @ ${g.homeName}</div>` +
        `<span style="margin-left:auto;font-size:11px;color:${live ? '#46e0c0' : '#7e9388'}">${live ? '● LIVE ' : ''}${(g.detail || '').slice(0, 18)}</span></div>` +
        `<div style="font-size:12px;color:#bfe9ff">${g.away} ${g.as} — ${g.hs} ${g.home}${live ? '  ·  Q' + g.period + ' ' + g.clock : ''}</div>` +
        rows + '</div>';
    }).join('');
    host.querySelectorAll('.sbet').forEach((b) => { b.onclick = () => placeSports(b.dataset.g, b.dataset.t, b.dataset.s); });
  }
  async function placeSports(gameId, type, side) {
    const w = Math.floor(Number(prompt(`Bet how many chips? (${type === 'quarter' ? 'this quarter' : type === 'spread' ? 'spread' : 'moneyline'})`, '20')) || 0);
    if (w < 1) return;
    const r = await (await fetch(API + '/book/sports/bet', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId, type, side, wager: w }) })).json();
    if (!r.ok) return bkToast(r.error || 'bet failed', false);
    setChips(r.chips); bkToast('bet placed: ' + (r.bet && r.bet.label)); refreshBook();
  }

  function updateBookDynamic() {
    if (!_bookEl || _bookEl.style.display === 'none') return;
    if (_bookMine && _bookMine.chips != null) setChips(_bookMine.chips);
    if (_bookTab === 'keno') {
      const k = bookKeno || {};
      const stEl = _bookEl.querySelector('#bkKenoStatus');
      if (stEl) {
        if (k.phase === 'open') stEl.innerHTML = `Game #${k.drawId} · <b style="color:#e3c567">next draw 0:${(k.secsLeft || 0) < 10 ? '0' : ''}${k.secsLeft || 0}</b> — place your spots`;
        else if (k.phase === 'draw') stEl.innerHTML = `Game #${k.drawId} · <b style="color:#7ef9da">DRAWING…</b>`;
        else stEl.innerHTML = `Game #${k.drawId} · <b style="color:#7ef9da">RESULTS</b> — ${(k.drawn || []).join(' ')}`;
      }
      const res = _bookMine && _bookMine.keno && _bookMine.keno.result;
      const rEl = _bookEl.querySelector('#bkKResult');
      if (rEl && res) rEl.textContent = `Draw #${res.drawId}: matched ${res.matches} → ${res.payout > 0 ? 'WON ' + res.payout + ' 🪙' : 'no win'}`;
    } else {
      renderSportsList();
      const mine = (_bookMine && _bookMine.sports) || [];
      const mEl = _bookEl.querySelector('#bkSMine');
      if (mEl) mEl.innerHTML = mine.length ? '<div style="color:#7e9388;font-size:12px;margin-bottom:4px">YOUR BETS</div>' + mine.map((b) =>
        `<div style="display:flex;gap:8px;font-size:13px;padding:3px 0"><span>${b.label}</span><span style="margin-left:auto;color:${b.status === 'won' ? '#7ef9da' : b.status === 'lost' ? '#ff8a6a' : '#e3c567'}">${b.status}${b.payout ? ' +' + b.payout : ''}</span></div>`).join('') : '';
    }
  }

  // live push from the server's parlor feed (via the room shell socket) — keeps
  // satellites fresh without waiting on the slow poll. Excludes your own table.
  function setTables(list) {
    if (!Array.isArray(list)) return;
    applyList(list.filter((t) => t.tableId !== _ctx.tableId), _ctx.game);
  }

  // expose the bridge so the room shell's socket can pop wins + push live tables
  window.__mllParlor = { bigWin, setTables };

  // tick the from-afar win pops: rise + fade-in-out over ~2.6s, then remove
  function update() {
    tickBarBoard(0.016);   // animate the sportsbook + keno board
    for (const av of parlorAvatars) { const a = av.userData && av.userData.anim; if (a) a.update(0.016); }
    for (let i = winAnims.length - 1; i >= 0; i--) {
      const a = winAnims[i];
      a.t += 0.016;
      const k = a.t / 2.6;
      a.spr.position.y = a.baseY + k * 9;
      a.spr.material.opacity = k < 0.18 ? k / 0.18 : Math.max(0, 1 - (k - 0.18) / 0.82);
      if (k >= 1) {
        satGroup.remove(a.spr);
        if (a.spr.material.map) a.spr.material.map.dispose();
        a.spr.material.dispose();
        winAnims.splice(i, 1);
      }
    }
  }

  function dispose() {
    if (_pollTimer) clearInterval(_pollTimer);
    if (window.__mllParlor && window.__mllParlor.bigWin === bigWin) delete window.__mllParlor;
    renderer.domElement.removeEventListener('pointerdown', onDown);
    renderer.domElement.removeEventListener('pointerup', onUp);
    clearSatellites();
    if (_domeTex) _domeTex.dispose();
    sbMesh.geometry.dispose(); sbMat.dispose(); sbTex.dispose(); scene.remove(sbMesh);
    dome.geometry.dispose(); domeMat.dispose(); scene.remove(dome); scene.remove(satGroup);
  }

  return { setDome, loadSatellites, refresh, clearSatellites, bigWin, update, dispose, dome, satGroup, FLOOR_Y };
}

// --- tiny helpers ---
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export default { createParlor };
