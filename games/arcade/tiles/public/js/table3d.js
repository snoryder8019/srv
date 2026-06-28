/**
 * table3d.js — the SHARED 3D tabletop core for every game on the tiles table.
 *
 * One place to own (and therefore upgrade once for all games):
 *   • renderer + scene + fog
 *   • CAMERA + controls  ← the upgradable camera logic lives HERE, not per-game
 *   • lighting + shadow frustum
 *   • felt table + rail + vignette
 *   • seats around the table ("checked-in" billboarded plates)
 *   • settle physics (drop/spring to a server-pinned transform) + a physics hook
 *   • a WebAudio sound kit
 *   • the render loop (drives controls, settles, and per-frame game hooks)
 *
 * A game module calls `createTable3D(opts)` and gets back an API to drive its own
 * objects. The core knows NOTHING about bones/cards/dice — games own that. This
 * keeps camera + physics improvements in a single file that every game inherits.
 *
 * Usage (per game):
 *   import { createTable3D } from './table3d.js?v=1781441125092';
 *   const T = createTable3D({ tableRadius: 34 });
 *   T.scene.add(myStuff);
 *   T.onFrame((now, dt) => { ... });          // per-frame game animation
 *   T.settle(mesh, finalY, finalRotY);        // drop-and-settle a placed object
 *   T.buildSeats(n, mySeat); T.updateSeat(i, {...});
 *   T.raycast(clientX, clientY, targets);     // pointer picking against game meshes
 *   T.Sound.play();  T.resetCamera();
 *
 * Camera spec (shared, hex/Towers feel — see CAMERA CONFIG below to tune once):
 *   one-finger / left-drag = orbit · two-finger / right-drag = pan · wheel = zoom.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildAvatar } from './avatar3d.js?v=1781441125092';
import { mountCamDebug } from './camDebug.js?v=1781441125092';
import { createEnvironment } from './environment3d.js?v=1781441125092';
import { mountRoomShell } from './roomShell.js?v=1781441125092';

export function createTable3D(opts = {}) {
  const TABLE_R = opts.tableRadius || 34;
  const canvas = document.getElementById(opts.canvasId || 'scene');

  // Stable game slug for the persisted opening camera (save + load use this same
  // key). URL path (/lobby/<game>) is authoritative; fall back to opts/title.
  const GAME = (opts.game
    || (location.pathname.match(/\/lobby\/([^/?#]+)/) || [])[1]
    || (document.title || '').split(' ')[0]
    || 'default').toLowerCase();

  // ---- renderer ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg ?? 0x0a1a12);
  // Fog starts BEYOND the furthest camera zoom-out (maxDistance ≤ 320 across
  // games) so zooming out never fades the table or satellites — especially on
  // mobile pinch-zoom, where the old 170 near-plane fogged the felt right out.
  scene.fog = new THREE.Fog(opts.bg ?? 0x0a1a12, 600, 1400);

  // ---- world-anchored ROOM (dome + satellites) — see environment3d.js ----
  // The background is NO LONGER screen-pinned. The scene image is mapped onto a
  // dome in world space, so orbiting/zooming the table moves the room WITH it
  // (parallax). `applyBackgroundImage` keeps its name (the camDebug scene picker
  // calls it) but now swaps the DOME texture. The env is built below once camera +
  // controls exist; any backdrop requested before then is queued in _pendingDome.
  let _env = null, _pendingDome = null;
  function fitBackground() { /* dome uses UV mapping — nothing to aspect-fit */ }
  function applyBackgroundImage(url) { if (!url) return; if (_env) _env.setDome(url); else _pendingDome = url; }
  if (opts.bgImage) {
    applyBackgroundImage(opts.bgImage);
  } else if (opts.bgScene) {
    fetch(`/scene/url/${encodeURIComponent(opts.bgScene)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.url) applyBackgroundImage(d.url); })
      .catch(() => {});
  }

  // ============================ CAMERA CONFIG ============================
  // *** This block is the single source of truth for camera feel across ALL
  // *** games. Tune here once; hearts, euchre, craps, roulette all inherit it.
  const CAMERA = {
    fov: 46,
    start: opts.cameraStart || { x: 0, y: 58, z: 96 }, // outside the table frame, elevated
    target: opts.cameraTarget || { x: 0, y: 1.0, z: 0 },
    minDistance: 14, maxDistance: 420,   // expanded: closer macro + much wider room pull-back
    // clamp vertical tilt: never near-overhead (scene flips/upends) and never past
    // horizontal (camera would dip below the floor and see outside the room).
    minPolar: Math.PI * 0.17, maxPolar: Math.PI * 0.46,
    damping: 0.09, panSpeed: 1.1, zoomSpeed: 1.15, rotateSpeed: 0.9,
  };
  // near=1 (not 0.1): with far at 2200 a 0.1 near gives a 22000:1 ratio that wrecks
  // depth precision, so the felt (y≈0) and the parlor floor (y≈-0.2) z-fight into a
  // blue/brown speckle. minDistance is 14, so a 1-unit near never clips anything.
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 1, 2200);
  camera.position.set(CAMERA.start.x, CAMERA.start.y, CAMERA.start.z);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = CAMERA.damping;
  controls.target.set(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);
  controls.minDistance = CAMERA.minDistance;
  controls.maxDistance = CAMERA.maxDistance;
  controls.minPolarAngle = CAMERA.minPolar;
  controls.maxPolarAngle = CAMERA.maxPolar;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.panSpeed = CAMERA.panSpeed;
  controls.zoomSpeed = CAMERA.zoomSpeed;
  controls.rotateSpeed = CAMERA.rotateSpeed;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.update();
  const HOME = { pos: camera.position.clone(), target: controls.target.clone() };
  function resetCamera() { camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.update(); }
  // expose for live retuning + future upgrades (e.g. cinematic moves, follow-cam)
  function setCamera(partial = {}) {
    Object.assign(CAMERA, partial);
    if (partial.minDistance != null) controls.minDistance = partial.minDistance;
    if (partial.maxDistance != null) controls.maxDistance = partial.maxDistance;
    if (partial.minPolar != null) controls.minPolarAngle = partial.minPolar;
    if (partial.maxPolar != null) controls.maxPolarAngle = partial.maxPolar;
    if (partial.damping != null) controls.dampingFactor = partial.damping;
  }
  // ======================================================================

  // ---- build the world-anchored room now that camera + controls exist ----
  // Dome parallax + a satellite ring of other live tables (tap one to go play it).
  // Pass opts.environment:false to opt a game out; opts.tableId excludes your own
  // table from the ring. Any backdrop requested earlier (queued) applies now.
  _env = createEnvironment({ scene, THREE, camera, renderer, tableRadius: TABLE_R });
  if (_env && _pendingDome) { _env.setDome(_pendingDome); _pendingDome = null; }
  if (_env && opts.environment !== false) _env.loadSatellites({ game: GAME, tableId: opts.tableId });

  // ---- persistent "My Tables" room shell (up to 3 games + turn badges) ----
  if (opts.roomShell !== false) { try { mountRoomShell({}); if (_env) _env.refresh(); } catch (e) { /* non-fatal */ } }

  // ---- load this game's persisted opening framing (admin-saved via the cog) ----
  // Snap to the saved start/target on entry so every player opens on the locked-in
  // angle. Updates HOME too, so the reset-camera button returns here. Silent
  // fallback to the default/opts framing when nothing is saved for this game.
  fetch('/scene/camera/' + encodeURIComponent(GAME), { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const c = d && d.camera;
      if (!c || !c.start || !c.target) return;
      camera.position.set(c.start.x, c.start.y, c.start.z);
      controls.target.set(c.target.x, c.target.y, c.target.z);
      if (c.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
      controls.update();
      HOME.pos.copy(camera.position);
      HOME.target.copy(controls.target);
    })
    .catch(() => {});

  // ---- lighting ----
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x14241b, 0.55));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.15);
  key.position.set(18, 40, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 200;
  const SH = TABLE_R + 6;
  key.shadow.camera.left = -SH; key.shadow.camera.right = SH;
  key.shadow.camera.top = SH; key.shadow.camera.bottom = -SH;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 0.4);
  rim.position.set(-16, 16, -18);
  scene.add(rim);

  // ---- felt + rail + vignette ----
  // The felt sits nearly coplanar with the parlor floor (environment3d, y≈-0.2);
  // with the far plane pushed out to 2200 the depth buffer can't separate them and
  // they z-fight (felt blue ⇄ floor brown speckle). polygonOffset pulls the felt
  // fragments forward in depth so it ALWAYS wins over the floor, and a small lift
  // adds physical clearance. (Stays under the zones at y≈0.04 and cards at y≈0.18.)
  const feltColor = opts.feltColor ?? 0x176b46;
  const felt = new THREE.Mesh(new THREE.CircleGeometry(TABLE_R, 64),
    new THREE.MeshStandardMaterial({ color: feltColor, roughness: 0.92 }));
  felt.rotation.x = -Math.PI / 2; felt.position.y = 0.02; felt.receiveShadow = true; scene.add(felt);
  const ring = new THREE.Mesh(new THREE.RingGeometry(TABLE_R * 0.62, TABLE_R, 64),
    new THREE.MeshBasicMaterial({ color: 0x0c3a26, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; scene.add(ring);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R + 0.6, 1.1, 16, 80),
    new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.6, metalness: 0.1 }));
  rail.rotation.x = -Math.PI / 2; rail.position.y = 0.2; rail.castShadow = true; rail.receiveShadow = true; scene.add(rail);
  // ---- table body to the parlor floor (uses the shared parlor's FLOOR_Y) ----
  // WIDE, SHORT body so it reads as a real table standing on the floor — not a
  // tall narrow podium.
  const FLOOR_Y = (_env && _env.FLOOR_Y != null) ? _env.FLOOR_Y : -8;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R * 0.94, TABLE_R * 0.82, -FLOOR_Y, 48),
    new THREE.MeshStandardMaterial({ color: 0x3a1c0e, roughness: 0.72, metalness: 0.08 }));
  drum.position.y = FLOOR_Y / 2; drum.castShadow = true; scene.add(drum);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R * 0.8, TABLE_R * 0.88, 1.2, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.85 }));
  ped.position.y = FLOOR_Y + 0.6; ped.receiveShadow = true; scene.add(ped);

  // ---- seats ("checked-in" plates around the table) ----
  const SEAT_GROUP = new THREE.Group(); scene.add(SEAT_GROUP);
  const seatNodes = [];
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function makeLabelSprite() {
    const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 120;
    const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(7.5, 3.5, 1); sp.userData = { cvs, tex }; return sp;
  }
  // info fields:
  //   name, sub, turn, you, color           — original
  //   maker (bool)   — golden border + 👑 (euchre: trump-caller's team)
  //   partner (bool) — blue/purple border (euchre: your partner's seat)
  //   handInfo       — optional third line, smaller (e.g. '5 cards' / '13 tiles')
  function drawLabel(sp, { name, sub, turn, you, color, maker, partner, handInfo }) {
    const { cvs, tex } = sp.userData; const c = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    c.clearRect(0, 0, W, H);
    // plate background: turn=green tint, maker=golden tint, else dark
    c.fillStyle = turn ? 'rgba(47,191,113,0.92)' : (maker ? 'rgba(40,32,8,0.86)' : 'rgba(8,18,13,0.82)');
    rr(c, 6, 6, W - 12, H - 12, 16); c.fill();
    // border priority: turn > maker > partner
    let bw = 0, bc = null;
    if (turn) { bc = '#bdf5d4'; bw = 3; }
    else if (maker) { bc = '#e3c567'; bw = 4; }       // golden border for makers
    else if (partner) { bc = '#8a7fe0'; bw = 4; }     // blue/purple border for partner
    if (bc) { c.strokeStyle = bc; c.lineWidth = bw; rr(c, 6, 6, W - 12, H - 12, 16); c.stroke(); }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    let nm = name || 'Seat';
    if (maker) nm = '👑 ' + nm;
    else if (partner) nm = '🤝 ' + nm;
    c.fillStyle = you ? '#ffe9a8' : '#eef6ef'; c.font = 'bold 34px system-ui';
    c.fillText(nm, W / 2, 40);
    if (color != null) {
      c.fillStyle = '#' + (color >>> 0).toString(16).padStart(6, '0');
      c.beginPath(); c.arc(28, 40, 11, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2; c.stroke();
    }
    c.fillStyle = turn ? '#06351c' : (maker ? '#f1dd9a' : '#9fb0a6'); c.font = '24px system-ui';
    c.fillText(sub || '', W / 2, 74);
    if (handInfo) {
      c.fillStyle = turn ? '#0a3d22' : '#7e8f85'; c.font = '20px system-ui';
      c.fillText(handInfo, W / 2, 102);
    }
    tex.needsUpdate = true;
  }
  // seat azimuth: local player (mySeat) sits south (+Z, nearest camera home)
  function seatAngle(seatIndex, mySeat, n) {
    const rel = ((seatIndex - (mySeat || 0)) + n) % n;
    return Math.PI / 2 + (rel / n) * Math.PI * 2;
  }
  function buildSeats(n, mySeat) {
    for (const s of seatNodes) SEAT_GROUP.remove(s.group);
    seatNodes.length = 0;
    for (let i = 0; i < n; i++) {
      const angle = seatAngle(i, mySeat, n);
      const g = new THREE.Group();
      const Rr = TABLE_R - 4.5;
      const x = Math.cos(angle) * Rr, z = Math.sin(angle) * Rr;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.12, 32),
        new THREE.MeshStandardMaterial({ color: 0x0e2a1c, roughness: 0.8, emissive: 0x000000 }));
      disc.position.set(x, 0.06, z); disc.receiveShadow = true; g.add(disc);
      // active-turn pulse ring: a thin emissive ring around the seat disc, faded
      // in/out by the frame loop when this seat is the current turn.
      const turnRing = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 40),
        new THREE.MeshBasicMaterial({ color: 0x2fbf71, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      turnRing.rotation.x = -Math.PI / 2; turnRing.position.set(x, 0.14, z); g.add(turnRing);
      const sp = makeLabelSprite(); sp.position.set(x, 3.0, z); g.add(sp);
      // low-poly seated avatar, hidden until a player/bot occupies the seat
      const av = buildAvatar({ seat: i, seatColor: 0x2f7fe0, scale: 2.6 });
      // sit slightly outside the disc so the figure leans over the rail
      const avR = TABLE_R + 3.5;
      const outX = Math.cos(angle) * avR, outZ = Math.sin(angle) * avR;
      av.position.set(outX, 0, outZ);
      av.rotation.y = Math.atan2(-outX, -outZ);   // face the table centre (0,0)
      av.visible = false;
      g.add(av);
      SEAT_GROUP.add(g);
      seatNodes.push({ group: g, disc, turnRing, sprite: sp, avatar: av, angle, seat: i, x, z, isTurn: false, winFlash: 0 });
    }
    return seatNodes;
  }
  // info now also accepts: isTurn (bool, drives the seat pulse), maker, partner,
  // handInfo (third label line). `turn` (the plate's green fill) still works; if
  // isTurn is omitted it falls back to `turn` so existing callers keep their glow.
  function updateSeat(i, info) {
    const node = seatNodes[i]; if (!node) return;
    drawLabel(node.sprite, info);
    node.isTurn = info.isTurn != null ? !!info.isTurn : !!info.turn;
  }
  function seatPosition(i) { const n = seatNodes[i]; return n ? new THREE.Vector3(n.x, 0, n.z) : null; }
  function seatAngleOf(i) { const n = seatNodes[i]; return n ? n.angle : 0; }
  // Show/hide + recolour a seat's avatar. info: { present, color, active }
  function setSeatAvatar(i, info = {}) {
    const node = seatNodes[i]; if (!node || !node.avatar) return;
    const av = node.avatar;
    av.visible = info.present !== false;
    if (typeof info.color === 'number') {
      // retint the jacket/shoulders/arm-upper (the seat-colour parts)
      av.traverse((o) => {
        if (o.isMesh && o.material && o.userData && o.userData.body) o.material.color.setHex(info.color);
      });
      // simpler: mark body meshes on first call (jacket = torso + shoulders + upper arms)
    }
    if (av.userData && av.userData.anim) av.userData.anim.setActive(!!info.active);
  }
  function seatAvatar(i) { const n = seatNodes[i]; return n ? n.avatar : null; }

  // ---- active-turn pulse (driven each frame from the seat's isTurn flag) ----
  // A green ring around the active seat's disc breathes in/out so players can find
  // the current turn in 3D space, pairing with the HUD turn badge. Also gives the
  // disc a faint emissive lift. Brief golden flash when a seat wins a trick.
  function stepSeatPulses(now) {
    const pulse = 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(now * 0.005));
    for (const n of seatNodes) {
      if (n.turnRing) {
        const target = n.isTurn ? pulse : 0;
        n.turnRing.material.opacity += (target - n.turnRing.material.opacity) * 0.15;
        n.turnRing.scale.setScalar(n.isTurn ? (1 + 0.04 * Math.sin(now * 0.005)) : 1);
      }
      if (n.disc && n.disc.material.emissive) {
        const e = n.isTurn ? 0.12 * pulse : 0;
        n.disc.material.emissive.setRGB(0, e, e * 0.6);
      }
      // trick-winner golden flash, decays over ~900ms
      if (n.winFlash > 0) {
        n.winFlash = Math.max(0, n.winFlash - 0.018);
        if (n.turnRing) {
          const f = n.winFlash;
          n.turnRing.material.color.setRGB(0.89 * f + 0.18 * (1 - f), 0.77 * f + 0.75 * (1 - f), 0.40 * f + 0.44 * (1 - f));
          n.turnRing.material.opacity = Math.max(n.turnRing.material.opacity, f);
          if (n.winFlash === 0) n.turnRing.material.color.setHex(0x2fbf71);
        }
      }
    }
  }

  /**
   * highlightTrickWinner(seatIndex, duration) — brief golden glow on the winning
   * seat's pulse ring after a trick resolves. duration is advisory (the flash decays
   * on its own ~0.9s). Pairs with the HUD's transient "X won the trick" note.
   */
  function highlightTrickWinner(seatIndex) {
    const n = seatNodes[seatIndex]; if (!n) return;
    n.winFlash = 1;
    try { Sound.trick(); } catch (e) {}
  }

  // ---- playable-position markers (shared end/position highlight framework) ----
  // Dominoes' open ends, mahjong rack/pool slots, etc. Markers live in PLAY_MARKERS
  // and are replaced wholesale by setPlayableMarkers(); createPlayableMarker() builds
  // one if a game wants to manage them itself.
  const PLAY_MARKERS = new THREE.Group(); scene.add(PLAY_MARKERS);
  let _onPlayablePositions = null;
  function createPlayableMarker(position, type = 'ring', color = 0xe3c567, o = {}) {
    let mesh;
    if (type === 'cross') {
      const g = new THREE.Group();
      const bar = () => new THREE.Mesh(new THREE.BoxGeometry(o.size ?? 2.2, 0.05, 0.4),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o.opacity ?? 0.85, depthWrite: false }));
      const a = bar(), b = bar(); b.rotation.y = Math.PI / 2; g.add(a); g.add(b); mesh = g;
    } else {
      const r = o.size ?? 1.6;
      mesh = new THREE.Mesh(new THREE.RingGeometry(r * 0.62, r, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o.opacity ?? 0.85, side: THREE.DoubleSide, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
    }
    if (position) mesh.position.set(position.x || 0, (position.y != null ? position.y : 0.16), position.z || 0);
    mesh.userData = { playableMarker: true, type };
    return mesh;
  }
  // Replace all active markers. positions: array of {x,z,y?,type?,color?,size?}.
  function setPlayableMarkers(positions = [], def = {}) {
    while (PLAY_MARKERS.children.length) {
      const m = PLAY_MARKERS.children.pop();
      m.traverse && m.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    }
    for (const p of positions) {
      PLAY_MARKERS.add(createPlayableMarker(p, p.type || def.type || 'ring', p.color || def.color || 0xe3c567, p));
    }
    if (_onPlayablePositions) { try { _onPlayablePositions(positions); } catch (e) {} }
  }
  function clearPlayableMarkers() { setPlayableMarkers([]); }
  function onPlayablePositions(fn) { _onPlayablePositions = fn; }

  /**
   * adjustMaterialForDistance(mesh, opts) — distance-aware legibility helper for
   * tile faces. Returns 'far' if the mesh is beyond opts.threshold world units from
   * the camera, else 'close'. Optionally brightens the face material's emissive a
   * touch at distance. Game clients pass the result to tile3d.setTileLod().
   */
  function adjustMaterialForDistance(mesh, opts = {}) {
    if (!mesh) return 'close';
    const d = camera.position.distanceTo(mesh.getWorldPosition(new THREE.Vector3()));
    const far = d > (opts.threshold ?? 70);
    if (opts.brighten !== false) {
      const face = Array.isArray(mesh.material) ? mesh.material[2] : mesh.material;
      if (face && face.emissive) { const e = far ? 0.18 : 0; face.emissive.setRGB(e, e, e * 0.95); }
    }
    return far ? 'far' : 'close';
  }

  // ---- settle physics (drop/spring to a SERVER-pinned transform) ----
  // The server decides the final transform; we only animate the approach. This is
  // the "simulate but pin to server result" pattern — extend per game (dice add a
  // tumble, chips a scatter) but the contract stays: the rest pose is authoritative.
  const SETTLING = [];
  function settle(mesh, finalY, finalRotY, o = {}) {
    const dropH = o.dropH ?? (6 + Math.random() * 2);
    const wobble = o.wobble ?? (Math.random() - 0.5) * 0.5;
    const tilt = (Math.random() - 0.5) * 0.18;
    mesh.position.y = finalY + dropH;
    mesh.rotation.y = finalRotY + wobble; mesh.rotation.x = tilt; mesh.rotation.z = (Math.random() - 0.5) * 0.12;
    SETTLING.push({ mesh, toY: finalY, fromY: finalY + dropH, toRotY: finalRotY, fromRotY: finalRotY + wobble,
      fromRotX: tilt, fromRotZ: mesh.rotation.z, t: 0, dur: o.dur ?? (360 + Math.random() * 120), landed: false,
      onLand: o.onLand });
  }
  function settleEase(p) { if (p >= 1) return 1; const s = 1 - Math.pow(1 - p, 3); return s - Math.sin(p * Math.PI) * 0.06 * (1 - p); }
  function stepSettles(dt) {
    for (let i = SETTLING.length - 1; i >= 0; i--) {
      const s = SETTLING[i]; s.t += dt; const p = Math.min(1, s.t / s.dur); const e = settleEase(p);
      s.mesh.position.y = s.fromY + (s.toY - s.fromY) * e;
      s.mesh.rotation.y = s.fromRotY + (s.toRotY - s.fromRotY) * e;
      s.mesh.rotation.x = s.fromRotX * (1 - e); s.mesh.rotation.z = s.fromRotZ * (1 - e);
      if (!s.landed && p > 0.82) { s.landed = true; Sound.click(); if (s.onLand) s.onLand(); }
      if (p >= 1) { s.mesh.position.y = s.toY; s.mesh.rotation.set(0, s.toRotY, 0); SETTLING.splice(i, 1); }
    }
  }

  // ---- card flight (the "frisbee throw" to the middle) ----
  // Arc a mesh from its current transform to a target position+rotation along a
  // parabola, spinning a bit on the way, then drop in. Like settle, the TARGET is
  // authoritative (server-decided resting spot); only the flight is animated.
  const FLIGHTS = [];
  function flyTo(mesh, to, o = {}) {
    const from = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    const fromRot = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z };
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    FLIGHTS.push({
      mesh, from, to,
      fromRot, toRot: { x: to.rx ?? 0, y: to.ry ?? 0, z: to.rz ?? 0 },
      t: 0, dur: o.dur ?? (420 + dist * 6),     // farther throw = a bit longer
      arc: o.arc ?? Math.min(10, 4 + dist * 0.18), // parabola peak height
      spin: o.spin ?? (Math.PI * 2),            // total yaw (flat) spin during flight
      tumble: o.tumble ?? (Math.PI * 2 * 1.5),  // a turn or two over the long axis, in-flight
      landed: false, onLand: o.onLand,
    });
  }
  function flyEase(p) { return 1 - Math.pow(1 - p, 2.2); } // ease-out toward the target
  function stepFlights(dt) {
    for (let i = FLIGHTS.length - 1; i >= 0; i--) {
      const f = FLIGHTS[i]; f.t += dt; const p = Math.min(1, f.t / f.dur); const e = flyEase(p);
      // horizontal interpolation (eased), plus a parabolic vertical arc on top
      f.mesh.position.x = f.from.x + (f.to.x - f.from.x) * e;
      f.mesh.position.z = f.from.z + (f.to.z - f.from.z) * e;
      const baseY = f.from.y + (f.to.y - f.from.y) * e;
      f.mesh.position.y = baseY + Math.sin(Math.PI * p) * f.arc;
      // Base rotation eases from launch pose to the authoritative target. The card
      // lies flat (x≈PI/2), so an IN-PLANE spin (like a flicked card / frisbee) is a
      // rotation about its face normal = the mesh's local Z after the x-tilt. We add
      // that spin on Z, fading to zero by landing so it resolves cleanly flat. No
      // end-over-end flip (that was the wrong axis).
      const fade = (1 - p);                       // 1 at launch -> 0 at land
      const planeSpin = (f.tumble + f.spin) * fade; // total in-plane revolutions, decaying
      f.mesh.rotation.x = f.fromRot.x + (f.toRot.x - f.fromRot.x) * e;
      f.mesh.rotation.y = f.fromRot.y + (f.toRot.y - f.fromRot.y) * e;
      f.mesh.rotation.z = f.fromRot.z + (f.toRot.z - f.fromRot.z) * e + planeSpin;
      if (!f.landed && p >= 1) {
        f.landed = true;
        f.mesh.position.set(f.to.x, f.to.y, f.to.z);
        f.mesh.rotation.set(f.toRot.x, f.toRot.y, f.toRot.z);
        Sound.play(); if (f.onLand) f.onLand();
        FLIGHTS.splice(i, 1);
      }
    }
  }

  // ---- shuffle + deal flourish (game start) ----
  // Cosmetic only: a temp deck of face-down cards gathers in the center, riffles,
  // then deals out toward each seat. Uses injected buildCardFn so the core stays
  // card-agnostic. Cleans up its temp meshes when done, then calls onDone so the
  // game can render the real hands. Server state is untouched throughout.
  let _dealing = false;
  function dealAnimation(opts = {}) {
    const buildCardFn = opts.buildCard; if (!buildCardFn || _dealing) { opts.onDone && opts.onDone(); return; }
    const seats = opts.seats || seatNodes.map((sn) => sn.seat);
    const perSeat = opts.perSeat || 13;
    _dealing = true;
    const grp = new THREE.Group(); scene.add(grp);
    const DECK_N = 24;                       // visual deck thickness (not all 52, for perf)
    const center = new THREE.Vector3(0, 1.2, 0);
    const cards = [];
    for (let i = 0; i < DECK_N; i++) {
      const m = buildCardFn(null);           // face-down backs
      m.position.set(center.x, center.y + i * 0.05, center.z);
      m.rotation.set(Math.PI / 2, 0, 0);
      m.traverse((o) => { if (o.isMesh) { o.renderOrder = 2000 + i; if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((mm) => { mm.depthTest = false; mm.depthWrite = false; }); } } });
      grp.add(m); cards.push(m);
    }
    Sound.deal();

    // phase timings (ms)
    const GATHER = 420, RIFFLE = 760, DEAL = 900;
    const t0 = performance.now();
    let lastRiffleSound = 0;

    function frame(now) {
      const t = now - t0;
      if (t < GATHER) {
        // gather: cards converge from a loose spread into a neat stack
        const p = t / GATHER;
        cards.forEach((m, i) => {
          const e = 1 - Math.pow(1 - p, 3);
          m.position.x = center.x * e + (m.userData._gx ?? (m.userData._gx = (Math.random() - 0.5) * 26)) * (1 - e);
          m.position.z = center.z * e + (m.userData._gz ?? (m.userData._gz = (Math.random() - 0.5) * 18)) * (1 - e);
          m.position.y = center.y + i * 0.05;
        });
      } else if (t < GATHER + RIFFLE) {
        // riffle: split the stack into two halves that lift, fan apart, and merge
        const p = (t - GATHER) / RIFFLE;
        const wob = Math.sin(p * Math.PI * 4);             // a few quick oscillations
        const open = Math.sin(p * Math.PI);                // split opens then closes
        cards.forEach((m, i) => {
          const half = i < DECK_N / 2 ? -1 : 1;
          m.position.x = center.x + half * open * 4.0;
          m.position.y = center.y + i * 0.05 + open * 2.2 + (half * wob * 0.6);
          m.position.z = center.z;
          m.rotation.z = half * open * 0.25 * wob;
        });
        if (now - lastRiffleSound > 90) { Sound.tick(); lastRiffleSound = now; }
      } else if (t < GATHER + RIFFLE + DEAL) {
        // deal: fling a card toward each seat in turn (round-robin), face down
        const p = (t - GATHER - RIFFLE) / DEAL;
        const dealt = Math.floor(p * cards.length);
        for (let i = 0; i < cards.length; i++) {
          const m = cards[i];
          if (i <= dealt && !m.userData._sent) {
            m.userData._sent = true;
            const seat = seats[i % seats.length];
            const sp = seatPosition(seat) || center;
            const ang = seatAngleOf(seat);
            const tx = sp.x * 0.62, tz = sp.z * 0.62;
            flyTo(m, { x: tx, y: 1.0, z: tz, rx: Math.PI / 2, ry: -ang + Math.PI / 2, rz: 0 },
              { dur: 300, arc: 5, spin: Math.PI, tumble: Math.PI });
          }
        }
      } else {
        // done: clear temp meshes, hand back to the game
        scene.remove(grp);
        grp.traverse((o) => { if (o.geometry) o.geometry.dispose && o.geometry.dispose(); });
        _dealing = false;
        opts.onDone && opts.onDone();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- sound kit ----
  const Sound = (function () {
    let ctx = null, muted = false, master = null;
    try { muted = localStorage.getItem('cards_muted') === '1'; } catch (e) {}
    function ac() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      }
      return ctx;
    }
    // plain enveloped oscillator (kept for simple cues)
    function beep(f, d, g = 0.05, type = 'sine') { if (muted) return; const a = ac(); const o = a.createOscillator(), gn = a.createGain(); o.type = type; o.frequency.value = f; gn.gain.value = g; o.connect(gn); gn.connect(master); o.start(); gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d); o.stop(a.currentTime + d); }
    // tone with soft attack + optional pitch glide
    function tone(f, o2 = {}) {
      if (muted) return; const a = ac(); const t = a.currentTime + (o2.t0 || 0);
      const o = a.createOscillator(), gn = a.createGain();
      o.type = o2.type || 'sine'; o.frequency.setValueAtTime(f, t);
      if (o2.glide) o.frequency.exponentialRampToValueAtTime(o2.glide, t + (o2.dur || 0.2));
      const peak = o2.gain || 0.05, dur = o2.dur || 0.2;
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur * 0.3));
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.03);
    }
    // metallic coin/chip clink — inharmonic partials, fast decay (the "ching")
    function clink(base, o2 = {}) {
      if (muted) return; const a = ac(); const t = a.currentTime + (o2.t0 || 0);
      const dur = o2.dur || 0.13, gain = o2.gain || 0.06;
      const g = a.createGain(); g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur); g.connect(master);
      [1, 2.76, 5.40, 8.93].forEach((r, i) => {            // bell/metal inharmonic ratios
        const o = a.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = base * r;
        const og = a.createGain(); og.gain.value = 1 / (i + 1.6);
        o.connect(og); og.connect(g); o.start(t); o.stop(t + dur);
      });
    }
    // short filtered noise burst (card flick / brush)
    function noise(dur, o2 = {}) {
      if (muted) return; const a = ac(); const t = a.currentTime + (o2.t0 || 0);
      const len = Math.max(1, Math.floor(a.sampleRate * dur));
      const buf = a.createBuffer(1, len, a.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource(); src.buffer = buf;
      const f = a.createBiquadFilter(); f.type = o2.type || 'bandpass'; f.frequency.value = o2.freq || 1800; f.Q.value = o2.q || 0.7;
      const g = a.createGain(); g.gain.setValueAtTime(o2.gain || 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur);
    }
    return {
      play: () => beep(320, 0.08, 0.04, 'triangle'),
      yourTurn: () => { tone(560, { dur: 0.12, gain: 0.05 }); tone(760, { t0: 0.09, dur: 0.14, gain: 0.05 }); },
      trick: () => { tone(660, { dur: 0.22, gain: 0.045 }); tone(990, { dur: 0.22, gain: 0.022 }); },   // soft reveal ding (root+fifth)
      deal: () => noise(0.07, { freq: 2200, q: 0.6, gain: 0.05 }),                                       // card flick "fwip"
      tick: () => clink(1500, { gain: 0.03, dur: 0.06 }),                                                // crisp dice tick
      click: () => clink(900, { gain: 0.045, dur: 0.07 }),                                               // tactile chip tap
      chip: () => { clink(2100, { gain: 0.06, dur: 0.12 }); clink(2600, { t0: 0.03, gain: 0.04, dur: 0.10 }); },   // GOLD coin ching
      coin: (n = 7) => { for (let i = 0; i < n; i++) clink(1700 + Math.random() * 1400, { t0: i * 0.06, gain: 0.05 * (1 - i / (n * 1.6)), dur: 0.16 }); },  // coin cascade
      alert: () => beep(200, 0.25, 0.06, 'square'),
      win: () => {   // gold-coin cascade + bright major arpeggio
        for (let i = 0; i < 8; i++) clink(1800 + Math.random() * 1500, { t0: i * 0.055, gain: 0.05 * (1 - i / 14), dur: 0.18 });
        [523, 659, 784, 1047].forEach((f, i) => tone(f, { t0: 0.05 + i * 0.085, dur: 0.4, gain: 0.05, type: 'triangle' }));
      },
      lose: () => { tone(360, { dur: 0.3, gain: 0.05, glide: 300 }); tone(285, { t0: 0.14, dur: 0.34, gain: 0.05, glide: 240 }); },
      resume: () => { try { ac().resume(); } catch (e) {} },
      isMuted: () => muted, setMuted: (m) => { muted = m; },
      // let the shared mixer's Effects/Master sliders attenuate the table SFX so
      // they're not stuck at full volume (only mute used to be honoured).
      setVolume: (v) => { try { ac(); if (master) master.gain.value = Math.max(0, Math.min(1, v)); } catch (e) {} },
      getVolume: () => (master ? master.gain.value : 0.9),
    };
  })();

  // ---- pointer picking ----
  const _raycaster = new THREE.Raycaster();
  const _ptr = new THREE.Vector2();
  function raycast(clientX, clientY, targets) {
    const r = renderer.domElement.getBoundingClientRect();
    _ptr.x = ((clientX - r.left) / r.width) * 2 - 1;
    _ptr.y = -((clientY - r.top) / r.height) * 2 + 1;
    _raycaster.setFromCamera(_ptr, camera);
    return _raycaster.intersectObjects(targets, true);
  }

  // ---- compass (couples on-screen directions to the table) ----
  // A small N/E/S/W rose, top-right, that rotates with the camera so we can refer
  // to table directions consistently. North = world -Z; the local player sits South
  // (+Z). It reads the camera azimuth each frame so "up" on the rose is where the
  // camera is looking. Shared in the core so every game has the same reference.
  let _compass = null, _compassNeedle = null;
  function buildCompass() {
    const el = document.createElement('div');
    el.id = 'compass';
    el.style.cssText = 'position:fixed;top:56px;right:12px;width:60px;height:60px;z-index:30;' +
      'pointer-events:none;';
    el.innerHTML =
      '<svg viewBox="0 0 100 100" style="width:100%;height:100%;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">' +
      '<circle cx="50" cy="50" r="46" fill="rgba(8,18,13,.66)" stroke="rgba(255,255,255,.18)" stroke-width="2"/>' +
      '<g id="compassRose">' +
      '<polygon points="50,8 44,50 56,50" fill="#e0524d"/>' +     // North arrow (red)
      '<polygon points="50,92 44,50 56,50" fill="#cfd8d2"/>' +    // South
      '<text x="50" y="26" text-anchor="middle" font-size="15" font-weight="800" fill="#ffd9d6" font-family="system-ui">N</text>' +
      '<text x="50" y="84" text-anchor="middle" font-size="11" fill="#9fb0a6" font-family="system-ui">S</text>' +
      '<text x="84" y="54" text-anchor="middle" font-size="11" fill="#9fb0a6" font-family="system-ui">E</text>' +
      '<text x="16" y="54" text-anchor="middle" font-size="11" fill="#9fb0a6" font-family="system-ui">W</text>' +
      '</g></svg>';
    document.body.appendChild(el);
    _compass = el; _compassNeedle = el.querySelector('#compassRose');
  }
  function updateCompass() {
    if (!_compassNeedle) return;
    // azimuth of the camera around the table center, in screen terms. atan2 of the
    // camera's offset gives the bearing; rotate the rose so North stays world-fixed.
    const dx = camera.position.x - controls.target.x;
    const dz = camera.position.z - controls.target.z;
    const az = Math.atan2(dx, dz);              // 0 when camera is due +Z (south)
    _compassNeedle.setAttribute('transform', `rotate(${(az * 180 / Math.PI).toFixed(1)} 50 50)`);
  }
  if (new URLSearchParams(location.search).get('cam') === '1') buildCompass();

  // ---- camera debugger / opening-view tool (shared module) ----
  // The full tool — live readout, touch nudge pad, FOV slider, scene picker, and
  // SAVE OPENING VIEW (per game) — now lives in camDebug.js so every game (and the
  // bespoke dominoes scene) share ONE implementation. Gated to ?cam=1 OR admin.
  function mountDebugger() {
    mountCamDebug(
      { camera, controls, THREE, setBackgroundImage: applyBackgroundImage, resetCamera },
      { game: GAME });
  }
  if (new URLSearchParams(location.search).get('cam') === '1') { mountDebugger(); }
  else {
    fetch('/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.user && d.user.isAdmin === true) mountDebugger(); })
      .catch(() => {});
  }


  // ---- resize + loop ----
  function resize() { const w = window.innerWidth, h = window.innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); fitBackground(); }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  const _frameHooks = [];
  function onFrame(fn) { _frameHooks.push(fn); }
  // Optional post-processing pass after a game renders the trick area. The game
  // calls fireTrickRender(tricksArray, meshes) right after laying out trick cards;
  // a registered onTrickRender hook can add labels/glow per played card (each card's
  // userData carries {code, seatAngle, seatLabel}).
  let _onTrickRender = null;
  function onTrickRender(fn) { _onTrickRender = fn; }
  function fireTrickRender(tricks, meshes) { if (_onTrickRender) { try { _onTrickRender(tricks, meshes); } catch (e) {} } }
  let _last = performance.now();
  function tick() {
    const now = performance.now(); const dt = Math.min(50, now - _last); _last = now;
    requestAnimationFrame(tick);
    controls.update();
    updateCompass();
    if (_env) _env.update();
    stepSettles(dt);
    stepFlights(dt);
    stepSeatPulses(now);
    const dts = dt / 1000;
    for (const n of seatNodes) {
      if (n.avatar && n.avatar.visible && n.avatar.userData && n.avatar.userData.anim) {
        n.avatar.userData.anim.update(dts);
      }
    }
    for (const fn of _frameHooks) { try { fn(now, dt); } catch (e) {} }
    renderer.render(scene, camera);
  }
  tick();

  return {
    THREE, scene, camera, controls, renderer, TABLE_R,
    resetCamera, setCamera,
    setBackgroundImage: applyBackgroundImage,
    environment: () => _env,
    reloadRoom: () => { if (_env) _env.loadSatellites({ game: GAME, tableId: opts.tableId }); },
    buildSeats, updateSeat, seatPosition, seatAngleOf, seatNodes, setSeatAvatar, seatAvatar,
    settle, flyTo, dealAnimation, isDealing: () => _dealing, onFrame, raycast, Sound,
    highlightTrickWinner,
    PLAY_MARKERS, createPlayableMarker, setPlayableMarkers, clearPlayableMarkers, onPlayablePositions,
    adjustMaterialForDistance,
    onTrickRender, fireTrickRender,
  };
}
