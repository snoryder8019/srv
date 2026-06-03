/**
 * card3d.js — playing-card meshes for the 3D table (shared by hearts, euchre, …).
 *
 * A card is a thin rounded box with a canvas-drawn face texture (rank + suit pips)
 * on top and a patterned back underneath. Faces are cached by code so a 52-card
 * deck costs 52 textures at most. Card codes are the engine's: rank + suit initial
 * e.g. "QS" (Q♠), "2C" (2♣), "10H" / "TH" (10♥), "AD" (A♦).
 *
 * Real-world-ish proportions: 2.5 x 3.5 ratio. World size set by CARD_W/CARD_H.
 */
import * as THREE from 'three';

export const CARD_W = 3.3, CARD_H = 4.6, CARD_T = 0.06;

const SUIT_BY_INITIAL = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };
const SUIT_GLYPH = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_RED = { hearts: true, diamonds: true, clubs: false, spades: false };

export function parseCardCode(code) {
  const init = code.slice(-1);
  let rank = code.slice(0, -1);
  if (rank === 'T') rank = '10';
  return { rank, suit: SUIT_BY_INITIAL[init] || 'spades' };
}

// --- face texture cache ---
const _faceCache = new Map();
let _backTex = null;

function drawRoundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function makeFaceTexture(code) {
  if (_faceCache.has(code)) return _faceCache.get(code);
  const { rank, suit } = parseCardCode(code);
  const red = SUIT_RED[suit];
  const W = 256, H = 356;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const c = cvs.getContext('2d');
  // card body
  c.fillStyle = '#fbfaf6'; drawRoundRect(c, 4, 4, W - 8, H - 8, 26); c.fill();
  c.strokeStyle = '#d9d4c6'; c.lineWidth = 2; c.stroke();
  const ink = red ? '#c0392b' : '#1a1d22';
  c.fillStyle = ink;
  const glyph = SUIT_GLYPH[suit];
  // corner index (top-left + bottom-right rotated)
  c.textAlign = 'center';
  c.font = 'bold 52px Georgia, "Times New Roman", serif';
  c.fillText(rank, 36, 56);
  c.font = '40px serif';
  c.fillText(glyph, 36, 98);
  c.save(); c.translate(W - 36, H - 56); c.rotate(Math.PI);
  c.font = 'bold 52px Georgia, serif'; c.fillText(rank, 0, 0);
  c.font = '40px serif'; c.fillText(glyph, 0, 42); c.restore();
  // center: big suit glyph (face cards get a letter block, number cards a large pip)
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (['J', 'Q', 'K', 'A'].includes(rank)) {
    c.font = 'bold 150px Georgia, serif'; c.fillText(rank, W / 2, H / 2 - 6);
    c.font = '60px serif'; c.fillText(glyph, W / 2, H / 2 + 96);
  } else {
    c.font = '150px serif'; c.fillText(glyph, W / 2, H / 2);
  }
  c.textBaseline = 'alphabetic';
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  _faceCache.set(code, tex);
  return tex;
}

function makeBackTexture() {
  if (_backTex) return _backTex;
  const W = 256, H = 356;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const c = cvs.getContext('2d');
  c.fillStyle = '#7a1f2b'; drawRoundRect(c, 4, 4, W - 8, H - 8, 26); c.fill();
  c.strokeStyle = '#e9c46a'; c.lineWidth = 3; drawRoundRect(c, 16, 16, W - 32, H - 32, 18); c.stroke();
  // diamond lattice
  c.strokeStyle = 'rgba(233,196,106,0.5)'; c.lineWidth = 1.5;
  for (let i = -H; i < W; i += 22) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i + H, H); c.stroke();
    c.beginPath(); c.moveTo(i + H, 0); c.lineTo(i, H); c.stroke();
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  _backTex = tex; return tex;
}

const _edgeMat = new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 0.6 });

// Build a card mesh. code null => face-down (back showing). Top (+Y) is the face.
// userData contract (game clients may extend these for state-driven visual hints):
//   { code, seatAngle, seatLabel }  — seatAngle/seatLabel describe which seat played
//   this card into the trick (yaw mirrors the seat); set them before adding to scene
//   so onTrickRender hooks / annotations can read them. applyLegalHighlight() and
//   setFollowViolation() also stash flags here (_legal, _followViolation).
export function buildCard(code) {
  const geo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
  const faceMat = new THREE.MeshStandardMaterial({
    map: code ? makeFaceTexture(code) : makeBackTexture(), roughness: 0.5, metalness: 0.0,
  });
  const backMat = new THREE.MeshStandardMaterial({ map: makeBackTexture(), roughness: 0.5 });
  // BoxGeometry material order: +X,-X,+Y,-Y,+Z,-Z. +Y is the top (face up).
  const mats = [_edgeMat, _edgeMat, faceMat, backMat, _edgeMat, _edgeMat];
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { code, seatAngle: null, seatLabel: null };
  return mesh;
}

function _hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
}

// Give the +Y (face) material its own instance so per-card emissive glow doesn't
// leak across cards sharing a cached material. Returns the face material.
function _ownFaceMat(mesh) {
  if (mesh.userData._ownFace) return mesh.material[2];
  // material index 2 is +Y (face). Clone it so emissive edits are local.
  mesh.material = mesh.material.slice();
  mesh.material[2] = mesh.material[2].clone();
  mesh.userData._ownFace = true;
  return mesh.material[2];
}

/**
 * applyLegalHighlight(mesh, isLegal, color='#2fbf71')
 * Visual hierarchy for playable cards. When isLegal, the face gets a soft emissive
 * glow (the playable colour); when not, the glow clears and the whole card dims to
 * the long-standing 0.55 opacity. Call once per hand-render after buildCard().
 * Idempotent — safe to call every render.
 */
export function applyLegalHighlight(mesh, isLegal, color = '#2fbf71') {
  if (!mesh) return mesh;
  const face = _ownFaceMat(mesh);
  if (isLegal) {
    const c = _hexToRgb(color);
    face.emissive && face.emissive.setRGB(c.r / 255 * 0.5, c.g / 255 * 0.5, c.b / 255 * 0.5);
    face.emissiveIntensity = 0.85;
    mesh.traverse((o) => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => { mm.transparent = false; mm.opacity = 1; }); });
  } else {
    face.emissive && face.emissive.setRGB(0, 0, 0);
    face.emissiveIntensity = 0;
    mesh.traverse((o) => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => { mm.transparent = true; mm.opacity = 0.55; }); });
  }
  mesh.userData._legal = !!isLegal;
  return mesh;
}

/**
 * setFollowViolation(mesh, on, color='#c0392b')
 * Tints a card red to signal it would violate a follow-suit constraint (a card the
 * player holds in the led suit but is the wrong play, or a card flagged illegal for
 * follow reasons). Game clients set this from priv.legal constraints. Clears when off.
 */
export function setFollowViolation(mesh, on, color = '#c0392b') {
  if (!mesh) return mesh;
  const face = _ownFaceMat(mesh);
  if (on) {
    const c = _hexToRgb(color);
    face.color && face.color.setRGB(0.6 + c.r / 255 * 0.4, 0.4 + c.g / 255 * 0.2, 0.4 + c.b / 255 * 0.2);
  } else if (mesh.userData._followViolation) {
    face.color && face.color.setRGB(1, 1, 1); // restore (texture supplies real colour)
  }
  mesh.userData._followViolation = !!on;
  return mesh;
}

export function preloadDeck() { makeBackTexture(); } // faces lazy-cache on first use
