/**
 * baccarat3d.js — Baccarat (punto banco) on the shared 3D table.
 *
 * Everyone bets the same hand. Pick a chip, tap a felt zone. The layout MIXES
 * shapes: PLAYER / BANKER / TIE are the big rounded BOXES; the side action rides
 * on CIRCLES — pairs (P/B/EITHER/PERFECT), the P/B dragon BONUS, BIG/SMALL, and
 * the DEALER toke / TIP. Hit Ready and the dealer tosses each card in — a
 * tumbling, physics-style throw that lands face-down on a natural askew stack —
 * then flips it; the last card holds a beat, the winning zone pulses, the winning
 * hand celebrates, the result lands, and a bead drops on the road. Table SFX are
 * routed through the shared mixer's Effects level (volume sliders, not just mute).
 */
import { createTable3D } from './table3d.js?v=1781440400000';
import { createTableClient } from './tableclient3d.js?v=1781440400000';
import { createHUD } from './hud3d.js?v=1781440400000';
import { buildCard, CARD_W } from './card3d.js?v=1781440400000';
import { dropStack } from './chip3d.js?v=1781440400000';
import { showResult, renderHistory, makeDeltaTracker, setWallet } from './casino-fx.js?v=1781440400000';
import { createBetBar } from './betbar.js?v=1781440400000';
import { createAudioBus } from 'https://games.madladslab.com/shared/js/audiobus.js?v=1781440400000';
import { createDealerFx } from './dealerfx.js?v=1781440400000';
import { createChipBurst } from './chipburst.js?v=1781440400000';

const T = createTable3D({
  tableRadius: 32, feltColor: 0x0b4a6a, bgScene: 'baccarat',
  cameraStart: { x: 0, y: 50, z: 64 }, cameraTarget: { x: 0, y: 1, z: 3 },
});
T.setCamera({ maxDistance: 260 });
const THREE = T.THREE;
const _delta = makeDeltaTracker();
const _hist = [];

const ZONE_COLOR = {
  player: 0x5ab0ff, banker: 0xff8f6b, tie: 0x6be08a,
  ppair: 0x9fd9ff, bpair: 0xffc59e, epair: 0x8affc8, perfpair: 0xffd34d,
  pbonus: 0x7ec8ff, bbonus: 0xffb38a, big: 0xc7a0ff, small: 0xa0ffe0,
  dealer: 0xe3c567, tip: 0xd8b6ff,
};
// felt layout (z<0 = dealer side / north, z>0 = toward you / south).
// Main bets are rounded-rect BOXES; side bets are CIRCLES — a real casino layout
// reads as a mix of the two, and the shape tells you "main wager" vs "side action".
const PLAYER_CARDS = { x: -7.5, z: -3.5 }, BANKER_CARDS = { x: 7.5, z: -3.5 };
const SHOE_ORIGIN = { x: 0, y: 0.5, z: -12.5 };
const ZONES = [
  // ── side-bet CIRCLES: pairs up by the cards ──
  { spot: 'ppair',    label: 'P PAIR',  sub: '11:1', shape: 'circle', x: -15,   z: 2.5,  r: 2.4 },
  { spot: 'perfpair', label: 'PERFECT', sub: '25:1', shape: 'circle', x: 0,     z: 1.0,  r: 2.7 },
  { spot: 'bpair',    label: 'B PAIR',  sub: '11:1', shape: 'circle', x: 15,    z: 2.5,  r: 2.4 },
  // ── dragon BONUS circles, flanking the main boxes ──
  { spot: 'pbonus',   label: 'P BONUS', sub: 'dragon', shape: 'circle', x: -19, z: 9,    r: 2.5 },
  { spot: 'bbonus',   label: 'B BONUS', sub: 'dragon', shape: 'circle', x: 19,  z: 9,    r: 2.5 },
  // ── main bet BOXES ──
  { spot: 'player',   label: 'PLAYER',  sub: '1 : 1',  shape: 'box', x: -10.5, z: 8.5, w: 9.5, h: 5.4, big: true },
  { spot: 'tie',      label: 'TIE',     sub: '8 : 1',  shape: 'box', x: 0,     z: 8.5, w: 6.6, h: 4.4 },
  { spot: 'banker',   label: 'BANKER',  sub: '0.95:1', shape: 'box', x: 10.5,  z: 8.5, w: 9.5, h: 5.4, big: true },
  // ── bottom row CIRCLES: big/small, either-pair, dealer/tip ──
  { spot: 'dealer',   label: 'DEALER',  sub: 'toke',   shape: 'circle', x: -13, z: 14.6, r: 1.95 },
  { spot: 'small',    label: 'SMALL',   sub: '1.5:1',  shape: 'circle', x: -6.5,z: 14.9, r: 2.1 },
  { spot: 'epair',    label: 'EITHER',  sub: '5:1',    shape: 'circle', x: 0,   z: 15.1, r: 2.4 },
  { spot: 'big',      label: 'BIG',     sub: '0.54:1', shape: 'circle', x: 6.5, z: 14.9, r: 2.1 },
  { spot: 'tip',      label: 'TIP',     sub: 'gift',   shape: 'circle', x: 13,  z: 14.6, r: 1.95 },
];
// half-extent toward the player (used to drop "you N" labels just below a zone)
function zoneHalfH(z) { return z.shape === 'circle' ? z.r : z.h / 2; }

const CARDS = new THREE.Group(); T.scene.add(CARDS);
const CHIPS = new THREE.Group(); T.scene.add(CHIPS);
const ZGROUP = new THREE.Group(); T.scene.add(ZGROUP);
const PRINT = new THREE.Group(); T.scene.add(PRINT);  // permanent felt printing (title + legends)
const SHUF = new THREE.Group(); T.scene.add(SHUF);
const ROAD = new THREE.Group(); T.scene.add(ROAD);   // bead-plate of recent results (dealer's left)
const BURST = createChipBurst(T);   // shared gold chip-burst (SD gold skin)

const _anims = [];
function tween(dur, apply, onDone) { _anims.push({ t0: performance.now(), dur, apply, onDone }); apply(0); }
function clearGroup(g) { for (const m of g.children.slice()) g.remove(m); }

// ── printed betting zones ───────────────────────────────────────────────────
// plain centred text on a flat plane — used for the floating "you N" chip tags
function zoneLabel(text, cx, cz, colorHex, px, w) {
  const S = 256, cvs = document.createElement('canvas'); cvs.width = S; cvs.height = 128;
  const c = cvs.getContext('2d'); c.clearRect(0, 0, S, 128);
  c.fillStyle = '#' + colorHex.toString(16).padStart(6, '0'); c.globalAlpha = 0.95;
  c.font = `bold ${px}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, S / 2, 64);
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
  // depthTest:true (default) + depthWrite:false → prints over the felt but is
  // OCCLUDED by chip stacks sitting on top (they're physically taller).
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.06, cz); m.renderOrder = 845; return m;
}
// a zone's engraved nameplate: bold title + a gold payout subtitle beneath it.
function zonePlate(title, sub, colorHex, worldW, big) {
  const S = 256, cvs = document.createElement('canvas'); cvs.width = S; cvs.height = 192;
  const c = cvs.getContext('2d'); c.clearRect(0, 0, S, 192);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 6;
  c.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
  c.font = `800 ${big ? 60 : 44}px system-ui`;
  c.fillText(title, S / 2, sub ? 78 : 96);
  if (sub) { c.shadowBlur = 3; c.fillStyle = '#ffe9a8'; c.font = `700 ${big ? 36 : 30}px system-ui`; c.fillText(sub, S / 2, big ? 136 : 130); }
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
  // depth-tested (not depthTest:false) so chip stacks on the spot occlude the print
  const m = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldW * 0.75), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 845; return m;
}
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function circleShape(r) { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2, false); return s; }
function ringPoints(r, seg = 64) { const p = []; for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; p.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); } return p; }
let _zoneTargets = [], _zoneFx = {};
function buildZones() {
  clearGroup(ZGROUP); _zoneTargets = []; _zoneFx = {};
  for (const z of ZONES) {
    const col = ZONE_COLOR[z.spot];
    const circle = z.shape === 'circle';
    const shape = circle ? circleShape(z.r) : roundedRectShape(z.w, z.h, 0.8);
    // soft tinted fill
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: circle ? 0.12 : 0.1, side: THREE.DoubleSide, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2; fill.position.set(z.x, 0.04, z.z); fill.renderOrder = 818; ZGROUP.add(fill);
    // bright coloured outline (this is what pulseZone animates)
    const pts = circle ? ringPoints(z.r) : shape.getPoints(48).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.78 }));
    line.position.set(z.x, 0.05, z.z); line.renderOrder = 820; ZGROUP.add(line);
    // faint gold trim ring just outside the outline (casino inlay feel)
    const trimPts = circle ? ringPoints(z.r + 0.45) : roundedRectShape(z.w + 0.9, z.h + 0.9, 1.1).getPoints(48).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const trim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(trimPts), new THREE.LineBasicMaterial({ color: 0xe3c567, transparent: true, opacity: 0.32 }));
    trim.position.set(z.x, 0.045, z.z); trim.renderOrder = 819; ZGROUP.add(trim);
    // nameplate
    const plate = zonePlate(z.label, z.sub, col, circle ? z.r * 2.1 : z.w, z.big);
    plate.position.set(z.x, 0.06, z.z); ZGROUP.add(plate);
    // invisible hit target
    const hit = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ visible: false }));
    hit.rotation.x = -Math.PI / 2; hit.position.set(z.x, 0.03, z.z); hit.userData.spot = z.spot; ZGROUP.add(hit); _zoneTargets.push(hit);
    _zoneFx[z.spot] = { fill, line };
  }
}
// ── permanent felt printing: arched title + standard casino legends ─────────
// One flat plane whose canvas draws the word along an upward arc (the classic
// "rainbow" wordmark at the dealer end). Returns a mesh lying flat on the felt.
function arcText(text, colorHex, opts = {}) {
  const W = 1024, H = 512, cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const c = cvs.getContext('2d'); c.clearRect(0, 0, W, H);
  const px = opts.px || 104, radius = opts.radius || 360, gap = opts.gap ?? 1.28;
  c.translate(W / 2, H * 0.95);                       // pivot near the bottom-centre
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `900 ${px}px Georgia, "Times New Roman", serif`;
  c.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
  c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 10;
  // each letter advances by its OWN glyph width × gap (converted to an arc angle),
  // so wide letters get more room and nothing overlaps no matter the font size.
  const chars = [...text];
  const step = chars.map((ch) => (c.measureText(ch).width * gap) / radius);
  const totalA = step.reduce((a, b) => a + b, 0);
  let ang = -totalA / 2;
  for (let i = 0; i < chars.length; i++) {
    const mid = ang + step[i] / 2;
    c.save(); c.rotate(mid); c.translate(0, -radius); c.fillText(chars[i], 0, 0); c.restore();
    ang += step[i];
  }
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(opts.w || 38, (opts.w || 38) * H / W),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: opts.opacity ?? 0.9 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 812; return m;
}
// a straight felt legend line on a WIDE canvas so long text never clips/stretches
function feltLine(text, cx, cz, colorHex, worldW, px = 44, weight = '700') {
  const W = 1024, H = 128, cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const c = cvs.getContext('2d'); c.clearRect(0, 0, W, H);
  c.font = `${weight} ${px}px Georgia, "Times New Roman", serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
  c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 5;
  c.fillText(text, W / 2, H / 2 + 2);
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldW * H / W),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.055, cz); m.renderOrder = 812; return m;
}
let _printed = false;
function buildFeltPrint() {
  if (_printed) return; _printed = true;
  // arched BACCARAT wordmark at the dealer end (north, behind the cards)
  const title = arcText('BACCARAT', 0xe3c567, { px: 104, radius: 365, gap: 1.32, w: 44 });
  title.position.set(0, 0.055, -9.5); PRINT.add(title);   // up at the dealer end, not mid-table
  // small "punto banco" tucked inside the arch, above the dealt cards
  PRINT.add(zoneLabel('PUNTO  BANCO', 0, -6.5, 0xbfae6e, 22, 13));
  // house wordmark + commission notice run along the bottom rail (player's edge)
  PRINT.add(feltLine('MADLADS LAB CASINO', 0, 18.5, 0x6fa3bb, 22, 46, '800'));
  PRINT.add(feltLine('5% COMMISSION ON WINNING BANKER BETS', 0, 21.3, 0xc9b06a, 30, 38, '700'));
}
// ── bead road: last results as coloured beads, read top→bottom, left→right ───
const ROAD_BEAD = { green: 0x43e08a, red: 0xff6f52, gold: 0xe3c567 };
let _roadLabelled = false;
function buildRoad(hist) {
  clearGroup(ROAD);
  const ROWS = 6, cell = 1.5, ox = -29, oz = -9;
  if (!_roadLabelled) { /* label rebuilt each time with the group */ }
  ROAD.add(zoneLabel('ROAD', ox + 2.2, oz - 1.7, 0x7e9388, 30, 6));
  const last = hist.slice(-24);
  last.forEach((h, i) => {
    const colN = Math.floor(i / ROWS), row = i % ROWS;
    const x = ox + colN * cell, z = oz + row * cell;
    const c3 = ROAD_BEAD[h.color] || 0x9fb0a6;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(cell * 0.4, 20), new THREE.MeshBasicMaterial({ color: c3, transparent: true, opacity: 0.94, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.05, z); disc.renderOrder = 830; ROAD.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(cell * 0.4, cell * 0.49, 20), new THREE.MeshBasicMaterial({ color: 0x06140e, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.051, z); ring.renderOrder = 831; ROAD.add(ring);
  });
}
function pulseZone(spot) {
  const fx = _zoneFx[spot]; if (!fx) return;
  let cyc = 0;
  const one = () => tween(520, (e) => { const k = Math.sin(Math.PI * e); fx.line.material.opacity = 0.7 + 0.3 * k; fx.fill.material.opacity = 0.1 + 0.42 * k; },
    () => { fx.line.material.opacity = 0.7; fx.fill.material.opacity = 0.1; if (++cyc < 2) one(); });
  one();
}
// 3D celebration on the winning hand: staggered expanding rings, a soft glow
// disc, the winning cards lift + tumble (win) or dip (loss), and on a win a
// ballistic chip burst rains over the felt.
function winnerFx(side, kind) {
  const color = kind === 'win' ? 0x43e08a : (kind === 'loss' ? 0xff6f52 : 0xe3c567);
  const base = side === 'player' ? PLAYER_CARDS : (side === 'banker' ? BANKER_CARDS : { x: 0, z: -4 });
  const rings = kind === 'win' ? 3 : 1;
  for (let r = 0; r < rings; r++) RT(() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.5, 56), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(base.x, 0.08, base.z); ring.renderOrder = 860; T.scene.add(ring);
    tween(900, (e) => { const sc = 1 + e * 5; ring.scale.set(sc, sc, sc); ring.material.opacity = 0.85 * (1 - e); }, () => T.scene.remove(ring));
  }, r * 150);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(4.6, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(base.x, 0.07, base.z); glow.renderOrder = 855; T.scene.add(glow);
  tween(820, (e) => { glow.material.opacity = 0.42 * Math.sin(Math.PI * e); }, () => T.scene.remove(glow));
  const sides = side === 'tie' ? ['player', 'banker'] : [side];
  for (const m of CARDS.children) if (m.userData && sides.includes(m.userData.side)) {
    const y0 = m.position.y, rz0 = m.rotation.z;
    if (kind === 'win') tween(780, (e) => { m.position.y = y0 + Math.sin(Math.PI * e) * 2.4; m.rotation.z = rz0 + Math.sin(Math.PI * e * 2) * 0.25; }, () => { m.position.y = y0; m.rotation.z = rz0; });
    else tween(420, (e) => { m.position.y = y0 + Math.sin(Math.PI * e) * 0.5; }, () => { m.position.y = y0; });
  }
  if (kind === 'win') BURST.spawn(base.x, base.z, { n: 18 });
  else if (kind === 'tie') BURST.spawn(base.x, base.z, { n: 8 });
}

// ── paced reveal: tumbling toss face-down, flip; last card holds a beat ─────
const REVEAL_STEP = 520;
let _revealRound = -1, _pending = null, _fallback = null, _revTimers = [];
let _lastResultAt = 0; const RESULT_HOLD = 1300;   // keep the dealt hand on the felt a beat before the next deal wipes it
let _revealing = false;   // while a hand is revealing, DON'T touch the wallet (it would spoil the result)
function RT(fn, ms) { const id = setTimeout(fn, ms); _revTimers.push(id); return id; }
function cancelReveal() { _revTimers.forEach(clearTimeout); _revTimers = []; }
// physics-style toss: a ballistic arc with a tumble (forward axis flip + a little
// flat spin), landing face-down on a slightly askew stack for a natural feel.
function dealCard(side, code, idx, onLand) {
  const base = side === 'player' ? PLAYER_CARDS : BANKER_CARDS;
  const jx = (Math.random() - 0.5) * 0.5, jz = (Math.random() - 0.5) * 0.5, jrot = (Math.random() - 0.5) * 0.22;
  const tx = base.x + idx * (CARD_W * 0.64) + jx, tz = base.z + jz, ty = 0.18 + idx * 0.06;
  const m = buildCard(code); m.userData.side = side; m.userData.rest = { y: jrot };
  const sx = SHOE_ORIGIN.x, sy = SHOE_ORIGIN.y + 0.4, sz = SHOE_ORIGIN.z;
  m.position.set(sx, sy, sz);
  const x0 = Math.PI * 2 * 2 + Math.PI;              // 2 forward tumbles (axis flip), ends face-down
  const y0 = (Math.random() - 0.5) * Math.PI * 1.2;  // a little flat-spin
  const z0 = (Math.random() - 0.5) * 0.7;
  m.rotation.set(x0, y0, z0);
  CARDS.add(m);
  if (T.Sound && T.Sound.deal) T.Sound.deal();
  const peak = 4.2 + idx * 0.2;
  tween(520, (e) => {
    m.position.x = sx + (tx - sx) * e; m.position.z = sz + (tz - sz) * e;
    m.position.y = (sy + (ty - sy) * e) + Math.sin(Math.PI * e) * peak;
    m.rotation.x = Math.PI + (x0 - Math.PI) * (1 - e);   // tumble down to face-down
    m.rotation.y = jrot + (y0 - jrot) * (1 - e);
    m.rotation.z = z0 * (1 - e);
  }, () => {
    m.position.set(tx, ty, tz); m.rotation.set(Math.PI, jrot, 0);
    tween(170, (e2) => { m.position.y = ty + Math.sin(Math.PI * e2) * 0.5; }, () => { m.position.y = ty; });
    if (onLand) onLand(m);
  });
}
function flipCard(m, onDone) {
  if (T.Sound && T.Sound.click) T.Sound.click();
  const y0 = m.position.y, ry = (m.userData.rest && m.userData.rest.y) || 0;
  tween(380, (e) => { m.rotation.x = Math.PI * (1 - e); m.position.y = y0 + Math.sin(Math.PI * e) * 0.9; },
    () => { m.rotation.x = 0; m.rotation.y = ry; m.position.y = y0; if (onDone) onDone(); });
}
function startReveal(ev) {
  const go = () => {
    _revealRound = ev.round; clearGroup(CARDS); clearGroup(CHIPS);
    const p = ev.playerCards || [], b = ev.bankerCards || [], n = Math.max(p.length, b.length), steps = [];
    for (let i = 0; i < n; i++) { if (p[i]) steps.push({ side: 'player', code: p[i], idx: i }); if (b[i]) steps.push({ side: 'banker', code: b[i], idx: i }); }
    steps.forEach((s, k) => { s.last = (k === steps.length - 1); });
    runReveal(steps, 0);
  };
  cancelReveal();
  const wait = Math.max(0, RESULT_HOLD - (performance.now() - _lastResultAt));
  if (wait > 0) RT(go, wait); else go();
}
function runReveal(steps, k) {
  if (k >= steps.length) return;
  const s = steps[k], last = s.last;
  dealCard(s.side, s.code, s.idx, (mesh) => {
    if (last) RT(() => flipCard(mesh, () => RT(finishReveal, 560)), 680);   // land · beat · flip · beat · result
    else flipCard(mesh);
  });
  if (!last) RT(() => runReveal(steps, k + 1), REVEAL_STEP);
}
function finishReveal() {
  if (!_pending) return;
  const R = _pending; _pending = null;
  if (_fallback) { clearTimeout(_fallback); _fallback = null; }
  if (R.outcomeSpot) { pulseZone(R.outcomeSpot); winnerFx(R.outcomeSpot, R.d > 0 ? 'win' : (R.d < 0 ? 'loss' : 'push')); }
  if (R.d > 0) { try { T.Sound.coin && T.Sound.coin(); if (R.d >= 100) AUDIO.applause(); } catch (e) {} }
  RT(() => fireResult(R), 280);
}
function fireResult(R) {
  _lastResultAt = performance.now();
  _revealing = false;
  if (T.Sound && T.Sound.trick) T.Sound.trick();
  showResult(R.payload);
  if (R.d > 0) DEALER.bigWin(R.call); else DEALER.onRoll(R.call);
  _hist.push(R.hist); renderHistory(_hist); buildRoad(_hist);
}
function playShuffle() {
  clearGroup(SHUF);
  const N = 10, cx = 0, cz = SHOE_ORIGIN.z, backs = [];
  for (let k = 0; k < N; k++) { const m = buildCard(null); m.position.set(cx, 0.2 + k * 0.05, cz); SHUF.add(m); backs.push(m); }
  tween(1100, (e) => { backs.forEach((m, k) => { const half = (k % 2 === 0) ? -1 : 1; m.position.x = cx + half * 3 * Math.sin(e * Math.PI); m.position.y = 0.2 + k * 0.05 + Math.sin(e * Math.PI) * 2; }); }, () => clearGroup(SHUF));
}

const C = createTableClient({
  onState(s) { onState(s); },
  onPriv() { HUD.render(); syncBetBar(); },
  onEvent(ev) { onEvent(ev); },
  onOver(o) { HUD.showOver(o); },
  onReconnect(on, msg, rejoin) { HUD.showReconnect(on, msg, rejoin); },
  onError(msg) { HUD.setStatus('⚠ ' + msg); },
});

function myChips() {
  const s = C.state; if (!s) return null; const v = s.view || {};
  if (v.bankrolls && typeof v.bankrolls[C.mySeat] === 'number') return v.bankrolls[C.mySeat];
  const me = (s.seats || [])[C.mySeat]; return me && typeof me.chips === 'number' ? me.chips : null;
}
let _builtZones = false;
function onState(s) {
  const v = s.view || {};
  if (!_builtZones && (v.pool || v.phase)) { buildZones(); buildFeltPrint(); _builtZones = true; }
  if (s.phase !== 'lobby' && v.phase === 'bets') renderChips(v);
  if (s.phase === 'lobby') { clearGroup(CARDS); clearGroup(CHIPS); clearGroup(ROAD); _revealRound = -1; }
  const _wb = myChips(); if (_wb != null && !_revealing) setWallet(_wb);
  if (_delta.last == null) { const b = myChips(); if (b != null) _delta.prime(b); }
  syncBetBar(); HUD.render(); HUD.renderVote(s.vote);
  if (s.phase === 'lobby') HUD.hideOver();
}
function renderChips(v) {
  clearGroup(CHIPS);
  const pool = v.pool || {}, mine = (C.priv && C.priv.bets) || {};
  for (const z of ZONES) {
    const amt = pool[z.spot] || 0;
    if (amt > 0) dropStack(CHIPS, z.x, z.z, amt, { dur: 1, seatColor: ZONE_COLOR[z.spot] });
    if ((mine[z.spot] || 0) > 0) CHIPS.add(zoneLabel('you ' + mine[z.spot], z.x, z.z + zoneHalfH(z) + 0.7, 0xffffff, 24, (z.shape === 'circle' ? z.r * 2 : z.w) * 0.8));
  }
}

const SAY = { player: 'Player wins!', banker: 'Banker wins!', tie: 'Tie!' };
function onEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'shuffle') playShuffle();
  if (ev.type === 'persona' && ev.text) toast('💬 ' + ev.name + ': ' + ev.text);
  if (ev.type === 'settle') {
    _revealing = true;
    const newBal = (Array.isArray(ev.bankrolls) && C.mySeat != null && typeof ev.bankrolls[C.mySeat] === 'number') ? ev.bankrolls[C.mySeat] : myChips();
    let d = (Array.isArray(ev.deltas) && C.mySeat != null && typeof ev.deltas[C.mySeat] === 'number') ? ev.deltas[C.mySeat] : _delta.delta(newBal);
    if (newBal != null) _delta.prime(newBal);
    const oc = ev.outcome;
    const title = oc === 'player' ? 'PLAYER' : (oc === 'banker' ? 'BANKER' : 'TIE');
    const sub = `Player ${ev.playerTotal} · Banker ${ev.bankerTotal}` + (ev.pPair ? ' · P pair' : '') + (ev.bPair ? ' · B pair' : '') + (ev.perfectPair ? ' · perfect!' : '');
    const mine = (Array.isArray(ev.breakdown) ? ev.breakdown : []).filter((b) => b.seat === C.mySeat).map((b) => ({ label: b.spot, delta: b.delta, note: b.note }));
    _pending = {
      payload: { title, titleColor: (oc === 'banker' ? 'red' : (oc === 'player' ? 'green' : null)), sub, delta: d, balance: newBal, breakdown: mine },
      call: SAY[oc] || 'Result', d, outcomeSpot: oc,
      hist: { label: oc === 'player' ? 'P' : (oc === 'banker' ? 'B' : 'T'), color: (oc === 'tie' ? 'gold' : (oc === 'banker' ? 'red' : 'green')), tip: `${ev.recap || sub} · you ${d > 0 ? '+' + d : d}` },
    };
    startReveal(ev);
    if (_fallback) clearTimeout(_fallback);
    _fallback = setTimeout(() => { if (_pending) { const R = _pending; _pending = null; fireResult(R); } }, 9000);
  }
  if (ev.type === 'vote:open' || ev.type === 'vote:update') HUD.renderVote(ev);
  if (ev.type === 'vote:result') HUD.renderVote(null);
}

let _tEl = null, _tT = null;
function toast(text) {
  if (!_tEl) { _tEl = document.createElement('div'); _tEl.style.cssText = 'position:fixed;left:50%;top:120px;transform:translateX(-50%);z-index:7;pointer-events:none;font:800 16px system-ui;padding:8px 15px;border-radius:11px;opacity:0;transition:opacity .25s;background:rgba(10,30,44,.92);color:#bfe0ff;border:1px solid #2a5a72'; document.body.appendChild(_tEl); }
  _tEl.textContent = text; _tEl.style.opacity = '1'; if (_tT) clearTimeout(_tT); _tT = setTimeout(() => { if (_tEl) _tEl.style.opacity = '0'; }, 2200);
}

// ── bet bar + audio ─────────────────────────────────────────────────────────
const BAR = createBetBar({ Sound: T.Sound, action: { label: 'Ready ▸', onClick: () => { const p = C.priv || {}; if (p.phase !== 'bets' || p.locked) return; C.emitAction({ type: 'done' }); } } });
const AUDIO = createAudioBus({
  ttsBase: '/tts', voice: 'ryan',
  onMuteChange: (m) => { try { T.Sound.setMuted(m); } catch (e) {} },
  // the table's deal/chip/coin SFX live on table3d's own audio graph; feed the
  // mixer's effective Effects level into it so the sliders actually control them.
  onFxLevel: (lvl) => { try { T.Sound.setVolume(lvl); } catch (e) {} },
});
try { AUDIO.setMuted(T.Sound.isMuted()); } catch (e) {}
AUDIO.buildMixer(document.getElementById('mutebtn')); AUDIO.startBeds();
const DEALER = createDealerFx({ audio: AUDIO, callFor: () => null });
const _camhint = document.getElementById('camhint'); if (_camhint) _camhint.style.display = 'none';

function syncBetBar() {
  const p = C.priv || {};
  const betting = p.phase === 'bets' && !p.locked && p.bankroll > 0;
  const hasBet = (p.reserved || 0) > 0;
  BAR.setVisible(!!betting); BAR.setActionVisible(!!betting);
  BAR.armMeter && BAR.armMeter(betting && hasBet);
}
function placeBet(spot) {
  const p = C.priv || {};
  if (p.phase !== 'bets' || p.locked) return;
  const amount = BAR.getStake(); if (!amount) return;
  C.emitAction({ type: 'bet', spot, amount });
  BAR.kick && BAR.kick();
  if (T.Sound) (T.Sound.chip ? T.Sound.chip() : (T.Sound.click && T.Sound.click()));
}

const HUD = createHUD({
  client: C, Sound: T.Sound, title: 'BACCARAT', lowerWins: false, scoreLabel: 'Most chips wins',
  onResetCam: () => T.resetCamera(),
  statusLine(v) {
    if (v.phase === 'bets') return (C.priv && C.priv.locked) ? 'Waiting for the deal…' : '<b>Place your bets</b>';
    return 'Dealing…';
  },
  renderActions() { /* intentionally empty — the bottom bar carries the controls */ },
  scoreFor(v, seat) { return { score: (v.bankrolls && v.bankrolls[seat] != null) ? v.bankrolls[seat] : 0, sub: 'chips' }; },
  scoreFootText: (v) => `Hand ${v.round ?? '—'} · dealer pool ${v.dealerPool ?? 0} · table runs until you leave`,
  infoHTML() {
    return `
      <div class="k"><span>Goal</span><b>Bet which hand hits closest to 9</b></div>
      <ul>
        <li><b>Main</b> (boxes): <b>PLAYER</b> 1:1 · <b>BANKER</b> 0.95:1 (5% commission) · <b>TIE</b> 8:1 (P/B push on a tie).</li>
        <li><b>Pairs</b> (circles): <b>P/B PAIR</b> 11:1 (that side's first two cards match rank) · <b>EITHER</b> 5:1 (either side pairs) · <b>PERFECT</b> 25:1 (a pair of the same rank AND suit).</li>
        <li><b>P/B BONUS</b> (dragon): that side wins on a natural (1:1) or by margin — 4pts 1:1 up to 9pts 30:1. Natural tie pushes.</li>
        <li><b>BIG</b> 0.54:1 (5–6 cards dealt) · <b>SMALL</b> 1.5:1 (exactly 4 cards).</li>
        <li>Cards: A=1, 2–9 face value, 10/J/Q/K=0. Hand total is the ones digit; third cards follow fixed rules (no decisions).</li>
        <li><b>DEALER</b> is a toke bet for the dealer on Banker; <b>TIP</b> is a flat gift — both feed the dealer pool.</li>
        <li>Everyone bets the same hand. The table runs until you leave.</li>
      </ul>`;
  },
});
document.title = 'Baccarat · tiles.madladslab';

// ── tap-to-place (tap-vs-drag) ──────────────────────────────────────────────
let _tap = null; const TAP_MOVE_PX = 10, TAP_MS = 500;
T.renderer.domElement.addEventListener('pointerdown', (e) => { _tap = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; }, false);
T.renderer.domElement.addEventListener('pointermove', (e) => { if (_tap && e.pointerId === _tap.id && Math.hypot(e.clientX - _tap.x, e.clientY - _tap.y) > TAP_MOVE_PX) _tap = null; }, false);
T.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!_tap || e.pointerId !== _tap.id) { _tap = null; return; }
  const moved = Math.hypot(e.clientX - _tap.x, e.clientY - _tap.y), dt = performance.now() - _tap.t, wasTap = moved <= TAP_MOVE_PX && dt <= TAP_MS;
  _tap = null; if (!wasTap) return;
  const p = C.priv || {}; if (p.phase !== 'bets' || p.locked || !_zoneTargets.length) return;
  const hits = T.raycast(e.clientX, e.clientY, _zoneTargets);
  if (hits.length && hits[0].object && hits[0].object.userData.spot) placeBet(hits[0].object.userData.spot);
}, false);
T.renderer.domElement.addEventListener('pointercancel', () => { _tap = null; }, false);

T.onFrame(() => {
  const now = performance.now();
  for (let i = _anims.length - 1; i >= 0; i--) {
    const a = _anims[i]; let pr = (now - a.t0) / a.dur; if (pr < 0) pr = 0; const done = pr >= 1; if (done) pr = 1;
    a.apply(1 - Math.pow(1 - pr, 3)); if (done) { _anims.splice(i, 1); if (a.onDone) a.onDone(); }
  }
});
