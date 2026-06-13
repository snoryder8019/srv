/**
 * tile3d.js — mahjong tile meshes for the 3D table.
 *
 * A tile is a thick rounded box: an ivory face (canvas-drawn glyph) on top (+Y),
 * a green bakelite back/underside, and ivory edges — like a real mahjong tile.
 * Faces are cached by code so the 34 distinct faces cost ≤34 textures even with
 * four copies of each in the wall.
 *
 * Codes are the engine's (engine/tile.js): suits B/C/K + rank 1..9 ("B3","K9"),
 * winds "WE"/"WS"/"WW"/"WN", dragons "DR"/"DG"/"DW".
 */
import * as THREE from 'three';

// Mahjong tiles are tall, thick, and a bit narrow. World units sized to sit on
// the same table as cards (CARD_W 3.3) but read as chunky tiles.
export const TILE_W = 2.6, TILE_H = 3.6, TILE_T = 1.5;

const SUIT_NAME = { B: 'Bamboo', C: 'Circle', K: 'Character' };
const WIND_GLYPH = { E: '東', S: '南', W: '西', N: '北' };
const DRAGON = { R: { ch: '中', color: '#b5482f' }, G: { ch: '發', color: '#2f8f5b' }, W: { ch: '🀆', color: '#2a3b46' } };
// Chinese numerals for the character (wan/man) suit.
const HANZI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function parseTileCode(code) {
  if (!code) return { kind: 'back' };
  const c = code[0];
  if (c === 'B' || c === 'C' || c === 'K') return { kind: 'suit', suit: c, rank: parseInt(code.slice(1), 10) };
  if (c === 'W') return { kind: 'wind', wind: code[1] };
  if (c === 'D') return { kind: 'dragon', dragon: code[1] };
  return { kind: 'back' };
}

const _faceCache = new Map();
let _backTex = null, _edgeMat = null;

function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// draw `n` red/green/blue circles in a tidy grid (the "circle/dot" suit)
function drawCircles(c, n, W, H) {
  const cols = n <= 3 ? 1 : (n <= 6 ? 2 : 3);
  const per = Math.ceil(n / cols);
  const r = 22, gapX = 64, gapY = 50;
  const totalW = (cols - 1) * gapX, startX = W / 2 - totalW / 2;
  let drawn = 0;
  for (let col = 0; col < cols; col++) {
    const inThis = Math.min(per, n - drawn);
    const totalH = (inThis - 1) * gapY, startY = H / 2 - totalH / 2;
    for (let k = 0; k < inThis; k++) {
      const x = startX + col * gapX, y = startY + k * gapY;
      const grad = c.createRadialGradient(x - 5, y - 5, 3, x, y, r);
      grad.addColorStop(0, k % 2 ? '#3b7fb0' : '#2f8f5b'); grad.addColorStop(1, k % 2 ? '#15517d' : '#15633b');
      c.fillStyle = grad; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#b5482f'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r * 0.4, 0, Math.PI * 2); c.fill();
    }
    drawn += inThis;
  }
}

// draw `n` vertical bamboo sticks (the "bamboo/bam" suit); 1-bam is the bird.
function drawBamboo(c, n, W, H) {
  if (n === 1) {                       // the bird
    c.font = '120px serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('🐦', W / 2, H / 2); return;
  }
  const cols = n <= 2 ? n : (n <= 6 ? 3 : 3);
  const rows = Math.ceil(n / cols);
  const gapX = 54, gapY = 70, stickW = 14, stickH = 50;
  const totalW = (cols - 1) * gapX, startX = W / 2 - totalW / 2;
  const totalH = (rows - 1) * gapY, startY = H / 2 - totalH / 2;
  let drawn = 0;
  for (let row = 0; row < rows; row++) {
    const inRow = Math.min(cols, n - drawn);
    const rowW = (inRow - 1) * gapX, rsx = W / 2 - rowW / 2;
    for (let k = 0; k < inRow; k++) {
      const x = rsx + k * gapX, y = startY + row * gapY;
      c.fillStyle = '#2f8f5b'; rr(c, x - stickW / 2, y - stickH / 2, stickW, stickH, 6); c.fill();
      c.fillStyle = '#15633b'; c.fillRect(x - stickW / 2, y - 3, stickW, 6);
    }
    drawn += inRow;
  }
}

// lod: 'close' (default) draws the normal face; 'far' draws an oversized, higher
// contrast glyph (darker ink, a contrast wash behind suit pips) so opponent tiles
// stay legible across the table at zoomed-out distances. Cached separately per LOD.
function makeFaceTexture(code, lod = 'close') {
  const key = lod === 'far' ? code + '@far' : code;
  if (_faceCache.has(key)) return _faceCache.get(key);
  const p = parseTileCode(code);
  const far = lod === 'far';
  const W = 200, H = 280;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const c = cvs.getContext('2d');
  // ivory face (far LOD uses a slightly brighter, higher-contrast ground)
  c.fillStyle = far ? '#fffdf4' : '#f7f3e7'; rr(c, 6, 6, W - 12, H - 12, 22); c.fill();
  c.strokeStyle = far ? '#b9b292' : '#d8d2bd'; c.lineWidth = far ? 3 : 2; c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const big = (n) => far ? Math.round(n * 1.22) : n;     // enlarge glyphs at distance
  const ink = far ? '#0d0e10' : '#15171a';               // darker ink at distance

  if (p.kind === 'suit' && p.suit === 'C') {
    drawCircles(c, p.rank, W, H);
  } else if (p.kind === 'suit' && p.suit === 'B') {
    drawBamboo(c, p.rank, W, H);
  } else if (p.kind === 'suit' && p.suit === 'K') {
    c.fillStyle = '#b5482f'; c.font = `bold ${big(120)}px serif`; c.fillText(HANZI[p.rank] || p.rank, W / 2, H / 2 - 28);
    c.fillStyle = ink; c.font = `bold ${big(64)}px serif`; c.fillText('萬', W / 2, H / 2 + 70);
  } else if (p.kind === 'wind') {
    c.fillStyle = ink; c.font = `bold ${big(130)}px serif`; c.fillText(WIND_GLYPH[p.wind] || '?', W / 2, H / 2);
  } else if (p.kind === 'dragon') {
    const d = DRAGON[p.dragon] || DRAGON.W;
    if (p.dragon === 'W') { c.strokeStyle = '#2a3b46'; c.lineWidth = far ? 11 : 8; rr(c, 44, 70, W - 88, H - 140, 12); c.stroke(); }
    else { c.fillStyle = d.color; c.font = `bold ${big(140)}px serif`; c.fillText(d.ch, W / 2, H / 2); }
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  _faceCache.set(key, tex);
  return tex;
}

function makeBackTexture() {
  if (_backTex) return _backTex;
  const W = 200, H = 280;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const c = cvs.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#2f8f5b'); g.addColorStop(1, '#1c6b41');
  c.fillStyle = g; rr(c, 6, 6, W - 12, H - 12, 22); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 4; rr(c, 22, 22, W - 44, H - 44, 14); c.stroke();
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace; _backTex = tex; return tex;
}

/**
 * Build a tile mesh. code null => face-down (ivory edge up, green back showing on
 * top is wrong for a standing wall, so a face-down tile shows the green back as
 * its +Y). Top (+Y) is the face when code is given.
 *
 * opts.lod ('close'|'far', default 'close'): 'far' renders a larger, higher-contrast
 * face for tiles read at distance (e.g. opponent concealed racks across the table).
 * The mesh's own face material is given its own instance so setTileLod() can swap
 * the LOD texture later without disturbing other tiles.
 */
export function buildTile(code, opts = {}) {
  if (!_edgeMat) _edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2ecdc, roughness: 0.55 });
  const lod = opts.lod === 'far' ? 'far' : 'close';
  const backMat = new THREE.MeshStandardMaterial({ map: makeBackTexture(), roughness: 0.5 });
  const geo = new THREE.BoxGeometry(TILE_W, TILE_T, TILE_H);
  const faceMat = new THREE.MeshStandardMaterial({
    map: code ? makeFaceTexture(code, lod) : makeBackTexture(), roughness: 0.45,
  });
  // material order +X,-X,+Y,-Y,+Z,-Z; +Y top = face.
  const mats = [_edgeMat, _edgeMat, faceMat, backMat, _edgeMat, _edgeMat];
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { code, lod };
  return mesh;
}

/**
 * setTileLod(mesh, lod) — swap a built tile's face texture between 'close'/'far'.
 * No-op for face-down tiles or when the LOD is unchanged. Lets a per-frame distance
 * check (see table3d.adjustMaterialForDistance) bump opponent tiles to 'far' glyphs.
 */
export function setTileLod(mesh, lod) {
  if (!mesh || !mesh.userData || !mesh.userData.code) return;
  const want = lod === 'far' ? 'far' : 'close';
  if (mesh.userData.lod === want) return;
  const face = Array.isArray(mesh.material) ? mesh.material[2] : mesh.material;
  if (face && face.map !== undefined) { face.map = makeFaceTexture(mesh.userData.code, want); face.needsUpdate = true; }
  mesh.userData.lod = want;
}

export function preloadTiles() { makeBackTexture(); }
