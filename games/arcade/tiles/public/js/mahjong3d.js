/**
 * mahjong3d.js — Mahjong on the shared 3D table.
 *
 * Thin game layer over the shared core (table3d), socket client (tableclient3d),
 * HUD (hud3d), and tile meshes (tile3d). Mahjong-specific rendering:
 *   • my tiles as an upright face-up RACK along the south rail, tappable to discard
 *   • a Draw button (and a Mahjong! button when the hand is complete) in the HUD
 *   • opponents' tiles as face-down rows at their seats (count only — concealed)
 *   • the central DISCARD POOL (recent discards laid flat, newest highlighted)
 *
 * Data shape (mahjong variant):
 *   priv.hand: ["B3","C5","WE",…]   priv.drew: code|null   priv.legal: [{type:'draw'}|{type:'discard',tile,id}|{type:'win'}]
 *   priv.yourTurn  priv.wall
 *   view.handCounts[]  view.wall  view.lastDiscards[]  view.points[]  view.turn
 * Each declared win = points; first to winScore wins.
 */
import { createTable3D } from './table3d.js?v=1781441125092';
import { createTableClient } from './tableclient3d.js';
import { createHUD } from './hud3d.js';
import { buildTile, setTileLod, TILE_W, TILE_H, TILE_T } from './tile3d.js';

const T = createTable3D({
  tableRadius: 34, feltColor: 0x13633f,
  bgScene: 'mahjong',
  cameraStart: { x: 4.5, y: 48, z: 132 },
  cameraTarget: { x: 7, y: 18, z: 78 },
});
T.setCamera({ maxDistance: 320 });
const THREE = T.THREE;

const RACK = new THREE.Group(); T.scene.add(RACK);     // my tiles, face-up
const POOL = new THREE.Group(); T.scene.add(POOL);     // central discards
const OPP = new THREE.Group(); T.scene.add(OPP);       // opponents' concealed rows
const MELDS = new THREE.Group(); T.scene.add(MELDS);   // everyone's exposed claimed melds

const rackMeshes = [];      // { mesh, code, slot }
// Client-side cosmetic ordering of MY tiles. Server owns membership + legality;
// this owns only the left->right arrangement (sorted by default, drag to reorder).
let rackOrder = [];

// suit/honor sort key so a freshly drawn tile slots into a tidy hand
const SUIT_ORD = { B: 0, C: 1, K: 2, W: 3, D: 4 };
function tileKey(code) {
  const s = SUIT_ORD[code[0]] ?? 9;
  const r = parseInt(code.slice(1), 10);
  return s * 100 + (isNaN(r) ? code.charCodeAt(1) : r);
}
// When the hand's MEMBERSHIP is unchanged we honour the player's manual drag order.
// When a tile is drawn/discarded/claimed (membership changed) we re-sort the WHOLE
// hand by suit so melds stay readable, rather than dangling the new tile off the end.
function reconcileRack(serverHand) {
  const have = serverHand.slice();
  const sameMembership = (() => {
    if (have.length !== rackOrder.length) return false;
    const ca = {}, cb = {};
    for (const c of have) ca[c] = (ca[c] || 0) + 1;
    for (const c of rackOrder) cb[c] = (cb[c] || 0) + 1;
    for (const k in ca) if (ca[k] !== cb[k]) return false;
    for (const k in cb) if (ca[k] !== cb[k]) return false;
    return true;
  })();
  if (sameMembership) {
    // membership identical — keep current arrangement (manual drags preserved)
    return;
  }
  // membership changed: rebuild a fully suit-sorted hand
  rackOrder = have.slice().sort((a, b) => tileKey(a) - tileKey(b));
}

// tile3d builds each mesh with material order [edge,edge,face,back,edge,edge] where
// the edge material is SHARED across all tiles — so we only ever touch the per-tile
// face (idx 2) + back (idx 3) materials, never the shared edges (would leak globally).
function tileOwnMaterials(mesh) {
  const m = mesh.material;
  if (!Array.isArray(m)) return m ? [m] : [];
  return [m[2], m[3]].filter(Boolean);
}

// Apply discardable / locked styling to a rack tile.
function setRackTileVisual(mesh, discardable, isDrew) {
  tileOwnMaterials(mesh).forEach((mat) => {
    if (mat.transparent === undefined) return;
    mat.transparent = true;
    if (!discardable) {
      // locked: dim and grey-shade so the hand clearly looks non-interactive
      mat.opacity = 0.6;
      if (mat.emissive) mat.emissive.setHex(0x222222);
    } else {
      mat.opacity = 1;
      if (mat.emissive) mat.emissive.setHex(isDrew ? 0x16401f : 0x000000);
    }
    mat.needsUpdate = true;
  });
}

// --- my rack: upright tiles in a straight row just inside the south rail ---
function renderRack() {
  for (const m of RACK.children.slice()) RACK.remove(m);
  rackMeshes.length = 0;
  const priv = C.priv; if (!priv || !priv.hand) return;
  reconcileRack(priv.hand);
  const tiles = rackOrder.slice();
  const n = tiles.length; if (!n) return;

  const canDiscard = priv.yourTurn && (priv.legal || []).some((a) => a.type === 'discard');
  const drew = priv.drew || null;             // the just-drawn tile (sits slightly proud)

  const stepX = TILE_W + 0.28;                // tiles sit side by side, small gap
  const span = stepX * (n - 1);
  const z0 = T.TABLE_R - 8.5;
  const RACK_Y = 4.4;
  const mid = (n - 1) / 2;

  tiles.forEach((code, i) => {
    const mesh = buildTile(code);
    const x = (i - mid) * stepX;
    const isDrew = drew && code === drew && i === tiles.length - 1; // highlight the drawn tile
    mesh.position.set(x, RACK_Y + (isDrew ? 1.4 : 0), z0 + (isDrew ? 1.2 : 0));
    // stand the tile upright facing the south camera (face +Y tipped toward viewer)
    mesh.rotation.set(Math.PI / 2 - 0.92, 0, 0);
    mesh.userData = { code, slot: i, kind: 'rack', canPick: canDiscard };
    // Visually signal whether this tile can be discarded right now. When it's not
    // our turn (or no legal discard), darken + dim the whole rack so it reads as
    // "locked"; when discardable, the just-drawn tile gets a soft green glow.
    setRackTileVisual(mesh, canDiscard, isDrew);
    RACK.add(mesh);
    rackMeshes.push({ mesh, code, slot: i, x });
  });
}

// --- central discard pool: recent discards laid flat, newest brightest ---
let _prevPool = '';
function renderPool() {
  const v = (C.state && C.state.view) || {};
  const discards = v.lastDiscards || [];
  const key = discards.join(',');
  const grew = discards.length && key !== _prevPool;
  _prevPool = key;
  for (const m of POOL.children.slice()) POOL.remove(m);
  if (!discards.length) return;
  // Lay the recent discards as a left->right timeline: oldest on the left, the
  // freshly-discarded (claimable) tile on the right, lifted + glowing so it's
  // unambiguous which tile is "live" during a claim window.
  const show = discards.slice(-8);
  const n = show.length;
  const stepX = TILE_W + 0.55;
  const x0 = -((n - 1) / 2) * stepX;
  show.forEach((code, idx) => {
    const x = x0 + idx * stepX;
    const z = 0;
    const mesh = buildTile(code);
    mesh.position.set(x, 0.9, z);
    mesh.rotation.set(Math.PI / 2, 0, 0);            // flat, face up
    const fresh = idx === n - 1;
    tileOwnMaterials(mesh).forEach((mm) => {
      if (mm.transparent === undefined) return;
      mm.transparent = true;
      // older tiles fade out the further back in time they are
      mm.opacity = fresh ? 1 : Math.max(0.42, 0.85 - (n - 1 - idx) * 0.08);
      if (fresh && mm.emissive) mm.emissive.setHex(0x4a3a0c);   // gold glow on the latest
      mm.needsUpdate = true;
    });
    if (fresh) { mesh.scale.multiplyScalar(1.08); mesh.userData = { kind: 'pool', isLatest: true }; }
    else mesh.userData = { kind: 'pool' };
    POOL.add(mesh);
    if (grew && fresh) {
      mesh.position.y += 8;
      T.flyTo(mesh, { x, y: 0.9, z, rx: Math.PI / 2, ry: 0, rz: 0 }, { dur: 380, arc: 5, spin: Math.PI / 2 });
    }
  });
}

// --- opponents: a face-down row at each non-local seat (count only) ---
function renderOpponents() {
  for (const m of OPP.children.slice()) OPP.remove(m);
  const s = C.state; if (!s) return;
  const v = s.view || {};
  const counts = v.handCounts || [];
  const n = (s.seats || []).length || 4;
  for (let seat = 0; seat < n; seat++) {
    if (seat === C.mySeat) continue;
    const cnt = counts[seat] || 0; if (!cnt) continue;
    const ang = T.seatAngleOf(seat);
    const px = -Math.sin(ang), pz = Math.cos(ang);    // tangent (row spread)
    const show = Math.min(cnt, 14);
    const stepT = (TILE_W + 0.2) * 0.62;
    const mid = (show - 1) / 2;
    const r = T.TABLE_R - 7.0;
    for (let i = 0; i < show; i++) {
      const mesh = buildTile(null);                   // concealed
      const rel = i - mid;
      const cx = Math.cos(ang) * r + px * rel * stepT;
      const cz = Math.sin(ang) * r + pz * rel * stepT;
      mesh.position.set(cx, 5.0, cz);
      // upright, backs toward the table center
      mesh.rotation.set(Math.PI / 2 - 0.92, ang + Math.PI, 0);
      mesh.userData = { kind: 'opp', seat };
      OPP.add(mesh);
    }
  }
}

// ------------------------------------------------------------------ client + HUD
const C = createTableClient({
  onState(s) { onState(s); },
  onPriv() { if (!T.isDealing()) renderRack(); HUD.render(); },
  onEvent(ev) { onEvent(ev); },
  onOver(o) { HUD.showOver(o); },
  onReconnect(on, msg, rejoin) { HUD.showReconnect(on, msg, rejoin); },
  onError(msg) { HUD.setStatus('⚠ ' + msg); },
});

let lastSeatCount = 0, prevTurn = null, prevHandNo = null;

// --- exposed melds: small face-up tile groups inside each seat ---
function renderMelds() {
  for (const m of MELDS.children.slice()) MELDS.remove(m);
  const s = C.state; if (!s) return;
  const v = s.view || {};
  const melds = v.melds || [];
  const n = (s.seats || []).length || 4;
  for (let seat = 0; seat < n; seat++) {
    const sets = melds[seat] || []; if (!sets.length) continue;
    const ang = T.seatAngleOf(seat);
    const px = -Math.sin(ang), pz = Math.cos(ang);     // tangent
    const inward = ang + Math.PI;
    const r = T.TABLE_R - 13.5;                          // a ring inside the concealed row
    const flatTiles = [];
    sets.forEach((md) => { md.tiles.forEach((code) => flatTiles.push(code)); flatTiles.push(null); }); // null = gap between melds
    const stepT = (2.6 + 0.18) * 0.52;
    const mid = (flatTiles.length - 1) / 2;
    flatTiles.forEach((code, i) => {
      if (code == null) return;
      const rel = i - mid;
      const cx = Math.cos(ang) * r + px * rel * stepT;
      const cz = Math.sin(ang) * r + pz * rel * stepT;
      // far LOD for melds belonging to opponents (read across the table)
      const far = seat !== C.mySeat;
      const mesh = buildTile(code, far ? { lod: 'far' } : {});
      mesh.position.set(cx, 1.0, cz);
      mesh.rotation.set(Math.PI / 2, inward, 0);        // flat, face up, oriented to the seat
      mesh.scale.setScalar(0.82);
      mesh.userData = { kind: 'meld', seat };
      MELDS.add(mesh);
    });
  }
}

function renderTable() {
  if (T.isDealing()) return;
  renderPool();
  renderRack();
  renderOpponents();
  renderMelds();
}

// Distance-aware legibility: swap opponents' face-up meld tiles to a higher-contrast
// "far" face when the camera is pulled back, so claimed sets stay readable across
// the table. Throttled to a few times a second (LOD changes are coarse).
let _lodAcc = 0;
T.onFrame((now, dt) => {
  _lodAcc += dt || 16;
  if (_lodAcc < 250) return;
  _lodAcc = 0;
  for (const mesh of MELDS.children) {
    if (!mesh.userData || mesh.userData.seat === C.mySeat) continue;
    setTileLod(mesh, T.adjustMaterialForDistance(mesh));
  }
});

function onState(s) {
  const v = s.view || {};
  const n = (s.seats || []).length;
  if (n && n !== lastSeatCount) { T.buildSeats(n, C.mySeat); lastSeatCount = n; }
  updateSeats(s, v);

  const newHand = s.handNo && s.handNo !== prevHandNo && s.phase !== 'lobby';
  if (newHand && !T.isDealing()) {
    for (const g of [RACK, OPP, POOL, MELDS]) for (const m of g.children.slice()) g.remove(m);
    T.dealAnimation({
      buildCard: buildTile,
      seats: (s.seats || []).map((x) => x.seat),
      perSeat: 13,
      onDone: () => { renderTable(); HUD.render(); },
    });
  } else {
    renderTable();
  }

  if (T.Sound && v.turn === C.mySeat && prevTurn !== C.mySeat && s.phase === 'playing') T.Sound.yourTurn && T.Sound.yourTurn();
  prevTurn = v.turn; prevHandNo = s.handNo;
  HUD.render();
  HUD.renderVote(s.vote);
  if (s.phase === 'lobby') HUD.hideOver();
}

function updateSeats(s, v) {
  const melds = v.melds || [];
  for (let i = 0; i < (s.seats || []).length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const cnt = (v.handCounts && v.handCounts[i] != null) ? v.handCounts[i] : '';
    const pts = (v.points && v.points[i] != null) ? v.points[i] : 0;
    const turn = v.turn === i && s.phase === 'playing';
    const name = (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : '');
    const meldN = (melds[i] || []).length;
    let sub, handInfo;
    if (s.phase === 'lobby') sub = seat.ready ? 'ready' : (seat.platformId ? 'waiting' : 'empty');
    else {
      sub = `${cnt} tiles · ${pts} pt`;
      // exposed-meld count is a threat cue: more melds = closer to a win
      if (meldN) handInfo = meldN + ' meld' + (meldN > 1 ? 's' : '') + (meldN >= 3 ? ' ⚠' : '');
    }
    T.updateSeat(i, { name, sub, turn, isTurn: turn, you: i === C.mySeat, handInfo });
  }
}

function onEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'drew' && T.Sound) T.Sound.tick && T.Sound.tick();
  if (ev.type === 'discarded' && T.Sound) T.Sound.play && T.Sound.play();
  if (ev.type === 'mahjong' && T.Sound) T.Sound.win && T.Sound.win();
  if (ev.type === 'wallExhausted' && T.Sound) T.Sound.alert && T.Sound.alert();
  if (ev.type === 'turn:timeout' && T.Sound) T.Sound.alert && T.Sound.alert();
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
}

// ------------------------------------------------------------------ actions/info
function lastDiscardCode(v) {
  const d = (v && v.lastDiscards) || [];
  return d.length ? d[d.length - 1] : null;
}

// Rough client-side completeness estimate: greedily pulls melds (pungs first, then
// chows) and a pair out of the concealed hand, counts already-exposed melds, and
// reports how many melds are still needed. A standard win = 4 melds + 1 pair.
function handCompleteness(priv, view) {
  const hand = (priv && priv.hand) || [];
  if (!hand.length) return null;
  const exposed = (view && view.melds && view.melds[C.mySeat]) ? view.melds[C.mySeat].length : 0;
  const counts = {};
  for (const c of hand) counts[c] = (counts[c] || 0) + 1;
  let melds = 0, pair = false;
  // pungs
  for (const k in counts) { while (counts[k] >= 3) { counts[k] -= 3; melds++; } }
  // chows (suited only: B/C/K, numeric)
  const suits = ['B', 'C', 'K'];
  for (const s of suits) {
    for (let r = 1; r <= 7; r++) {
      const a = s + r, b = s + (r + 1), cc = s + (r + 2);
      while (counts[a] > 0 && counts[b] > 0 && counts[cc] > 0) { counts[a]--; counts[b]--; counts[cc]--; melds++; }
    }
  }
  // pair
  for (const k in counts) { if (counts[k] >= 2 && !pair) { counts[k] -= 2; pair = true; break; } }
  const total = melds + exposed;
  const need = Math.max(0, 4 - total);
  return { melds: total, pair, need };
}

const HUD = createHUD({
  client: C, Sound: T.Sound, title: 'MAHJONG',
  lowerWins: false, scoreLabel: 'First to win a hand',
  onResetCam: () => T.resetCamera(),
  statusLine(v, c) {
    const led = lastDiscardCode(v);
    const ledNote = led ? ` · <span style="color:var(--gold)">last: ${led}</span>` : '';
    if (v.phase === 'claim' && v.claim && v.claim.waitingOn === c.mySeat) return '<b>CLAIM?</b> ' + v.claim.tile + ' discarded — pung/chow/win or pass';
    if (v.phase === 'claim') return 'claim window · ' + (v.claim ? v.claim.tile : '');
    if (v.turn === c.mySeat) {
      const drew = c.priv && c.priv.drew;
      return HUD.turnText(v.turn) + (drew ? ' · tap a tile to discard' : ' · draw a tile') + ledNote;
    }
    return HUD.turnText(v.turn) + ` · wall ${v.wall}` + ledNote;
  },
  // Persistent badge strip: surface the live claimable tile during a claim window,
  // otherwise the most recent discard, so "what's on the table right now" is glanceable.
  followSuitHint(v, priv) {
    if (priv && priv.claiming && priv.claiming.tile) return { text: 'Claimable: ' + priv.claiming.tile, color: '#ffd9a8' };
    const led = lastDiscardCode(v);
    return led ? { text: 'Last discard: ' + led, color: '#bfe0cd' } : null;
  },
  renderActions(box, { priv, myTurn }) {
    if (!priv || !myTurn) return;
    const legal = priv.legal || [];
    const mkBtn = (label, cls, action) => { const b = document.createElement('button'); b.className = 'act ' + cls; b.textContent = label; b.onclick = () => C.emitAction(action); box.appendChild(b); };

    // CLAIM phase: someone discarded a tile we can claim (or we pass).
    // Buttons are ordered + weighted by claim value: Win > Kong > Pung > Chow > Pass.
    if (priv.phase === 'claim' && priv.claiming) {
      const t = priv.claiming.tile;
      const cw = legal.find((a) => a.type === 'claimWin');
      const kong = legal.find((a) => a.type === 'kong');
      const pung = legal.find((a) => a.type === 'pung');
      const chows = legal.filter((x) => x.type === 'chow');
      // hint at the strongest available claim so players don't tap a weaker one
      const best = cw ? 'Win' : kong ? 'Kong' : pung ? 'Pung' : chows.length ? 'Chow' : null;
      if (best && best !== 'Pass') {
        const lbl = document.createElement('div');
        lbl.style.cssText = 'color:var(--gold);font-size:12px;font-weight:800;align-self:center;letter-spacing:.04em';
        lbl.textContent = '✨ Best: ' + best;
        box.appendChild(lbl);
      }
      if (cw) mkBtn('🀄 Win (Ron)!', 'gold', cw);
      if (kong) mkBtn('Kong ' + t, 'act', kong);
      if (pung) mkBtn('Pung ' + t, 'act', pung);
      for (const a of chows) mkBtn('Chow ' + a.with.join('+') + '·' + t, 'ghost', a);
      const pass = legal.find((a) => a.type === 'pass'); if (pass) mkBtn('Pass', 'ghost', pass);
      return;
    }

    const win = legal.find((a) => a.type === 'win');
    if (win) mkBtn('🀄 Declare Mahjong!', 'gold', win);
    const draw = legal.find((a) => a.type === 'draw');
    if (draw) { mkBtn('Draw tile', '', draw); }
    else if (legal.some((a) => a.type === 'discard')) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#bfe0cd;font-size:13px;align-self:center';
      hint.textContent = 'Tap a tile to discard';
      box.appendChild(hint);
    }

    // completeness gauge — how close the concealed + exposed hand is to a win
    if (!win) {
      const comp = handCompleteness(priv, (C.state && C.state.view) || {});
      if (comp) {
        const g = document.createElement('div');
        g.style.cssText = 'color:#bfe0cd;font-size:12px;align-self:center;background:rgba(10,24,18,.7);border:1px solid rgba(227,197,103,.3);border-radius:9px;padding:7px 11px';
        const dots = '🀄'.repeat(comp.melds) + (comp.pair ? ' +pair' : '');
        g.innerHTML = comp.need === 0 && comp.pair
          ? '<b style="color:var(--gold)">ready — waiting to win</b>'
          : `${comp.melds}/4 melds${comp.pair ? ' + pair' : ''} · <span style="color:var(--gold)">${comp.need} to go</span>`;
        box.appendChild(g);
      }
    }
  },
  scoreFor(v, seat) {
    return { score: (v.points && v.points[seat] != null) ? v.points[seat] : 0,
             sub: (v.handCounts && v.handCounts[seat] != null) ? v.handCounts[seat] + ' tiles' : '' };
  },
  scoreFootText: (v) => `Wall: ${v.wall ?? '—'} tiles left · first win takes it`,
  infoHTML() {
    return `
      <div class="k"><span>Goal</span><b>Four melds + a pair</b></div>
      <ul>
        <li>A <b>meld</b> is a pung (three identical) or a chow (three in a row, same suit).</li>
        <li>On your turn: <b>Draw</b> a tile, then tap one to <b>discard</b>.</li>
        <li>When your tiles + exposed melds form 4 melds + a pair, win (tap <b>Mahjong!</b> on your draw, or <b>Win/Ron</b> on a discard).</li>
        <li><b>Claim discards:</b> Pung (3 of a kind) or Kong (4) from anyone; Chow (a run) only from the player on your left.</li>
        <li>Honors (winds/dragons) form pungs only, never runs.</li>
        <li><b>Reorder:</b> press and hold a tile, then slide it to rearrange your hand (cosmetic).</li>
        <li>The <b>X/4 melds</b> gauge under the controls shows how close your hand is to a win.</li>
      </ul>`;
  },
});
document.title = 'Mahjong · tiles.madladslab';

// ------------------------------------------------------------------ picking + drag
// TAP a tile to discard (priv-gated). HOLD (~230ms) then slide to reorder the rack
// (cosmetic only — never touches the socket).
const HOLD_MS = 230, MOVE_CANCEL = 14;
let _g = null;

function tileAt(x, y) {
  if (!rackMeshes.length) return null;
  const hits = T.raycast(x, y, rackMeshes.map((h) => h.mesh));
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && obj.userData && obj.userData.kind !== 'rack' && obj.parent) obj = obj.parent;
  return (obj && obj.userData && obj.userData.code != null) ? obj.userData : null;
}

function slotAtScreenX(clientX) {
  const rect = T.renderer.domElement.getBoundingClientRect();
  let best = 0, bestDx = Infinity;
  for (const h of rackMeshes) {
    const v = h.mesh.position.clone().project(T.camera);
    const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    const dx = Math.abs(sx - clientX);
    if (dx < bestDx) { bestDx = dx; best = h.slot; }
  }
  return best;
}
function liftHeld(code, on) {
  const h = rackMeshes.find((m) => m.code === code && m.mesh); if (!h) return;
  h.mesh.position.y += on ? 2.2 : 0;
}
function clearGesture() {
  if (_g && _g.holdTimer) clearTimeout(_g.holdTimer);
  if (_g && _g.armed) T.controls.enabled = true;
  _g = null;
}

T.renderer.domElement.addEventListener('pointerdown', (e) => {
  const ud = tileAt(e.clientX, e.clientY);
  if (!ud) { _g = null; return; }
  _g = { code: ud.code, startX: e.clientX, startY: e.clientY, armed: false, holdTimer: null };
  _g.holdTimer = setTimeout(() => {
    if (!_g) return;
    _g.armed = true; T.controls.enabled = false; liftHeld(_g.code, true);
    if (T.Sound) T.Sound.tick && T.Sound.tick();
  }, HOLD_MS);
}, false);

T.renderer.domElement.addEventListener('pointermove', (e) => {
  if (!_g) return;
  const moved = Math.hypot(e.clientX - _g.startX, e.clientY - _g.startY);
  if (!_g.armed) { if (moved > MOVE_CANCEL) { clearTimeout(_g.holdTimer); _g.holdTimer = null; } return; }
  const from = rackOrder.indexOf(_g.code);
  const to = slotAtScreenX(e.clientX);
  if (from !== -1 && to !== -1 && from !== to) {
    rackOrder.splice(from, 1); rackOrder.splice(to, 0, _g.code);
    renderRack(); liftHeld(_g.code, true);
  }
  e.stopPropagation();
}, false);

function endGesture(e) {
  if (!_g) return;
  const armed = _g.armed, code = _g.code, hadTimer = !!_g.holdTimer;
  clearGesture();
  if (armed) { if (e) e.stopPropagation(); renderRack(); return; }
  if (!hadTimer) return;

  // TAP -> discard (priv-gated): the tile must be in the legal discard set + my turn.
  const priv = C.priv; if (!priv || !C.myTurn()) return;
  const act = (priv.legal || []).find((a) => a.type === 'discard' && a.tile === code);
  if (act) {
    // brief visual + audio confirmation so a touch tap clearly "registers"
    const h = rackMeshes.find((m) => m.code === code && m.mesh);
    if (h) { h.mesh.scale.multiplyScalar(1.15); h.mesh.position.y += 1.2; }
    if (T.Sound && T.Sound.tick) T.Sound.tick();
    setTimeout(() => C.emitAction(act), 110);
  }
}
T.renderer.domElement.addEventListener('pointerup', endGesture, false);
T.renderer.domElement.addEventListener('pointercancel', () => clearGesture(), false);
