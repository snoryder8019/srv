/**
 * scales.js — the Madlands cosmological ladder + per-tier object taxonomy.
 * Single source of truth for the world's scales and what categorical 3D objects
 * populate each. Browser-importable; the client reads SCALES to build/navigate
 * and reads objectsAt()/hiddenAt() to populate a tier.
 *
 * Drill model (see app.js): DOWN = descend into a selected child node; UP = ascend
 * to the parent; LATERAL = travel to a sibling at the same tier; each transition
 * can play a CINEMATIC camera move. Black holes are authored but HIDDEN until a
 * future release (present in `hidden`, never placed/selectable yet).
 */

// tier order, top → bottom. `kind` drives backdrop + terrain (see KIND_SCENE).
export const SCALES = [
  { key: 'cluster',  label: 'galactic cluster', radius: 8, bg: 0x05050d, kind: 'space',    objects: ['galaxy'] },
  { key: 'galaxy',   label: 'galaxy',           radius: 7, bg: 0x07060f, kind: 'space',    objects: ['star'], hidden: ['blackhole'] },
  { key: 'system',   label: 'star system',      radius: 7, bg: 0x09070f, kind: 'space',    objects: ['planet', 'station', 'blockade'] },
  { key: 'planet',   label: 'planet',           radius: 6, bg: 0x0b0a16, kind: 'ground',   objects: ['sector'] },
  { key: 'sector',   label: 'sector',           radius: 6, bg: 0x10101e, kind: 'ground',   objects: ['ship', 'blockade', 'poi'] },
  { key: 'battle',   label: 'battle zone',      radius: 5, bg: 0x0a0a18, kind: 'space',    objects: ['ship'] },
  { key: 'interior', label: 'interior',         radius: 4, bg: 0x14121f, kind: 'interior', objects: ['room'] },
];

export const INTERIOR_KINDS = ['dungeon', 'building', 'ship'];

export function scaleAt(i) { return SCALES[Math.max(0, Math.min(SCALES.length - 1, i))]; }
export function isBottom(i) { return i >= SCALES.length - 1; }
export function objectsAt(i) { return scaleAt(i).objects || []; }
export function hiddenAt(i) { return scaleAt(i).hidden || []; }

/** Scene/skin kind for a tier (interior splits by the chosen interior kind). */
export function kindForScale(i, interiorKind) {
  const s = scaleAt(i);
  if (s.kind === 'interior') {
    if (interiorKind === 'dungeon') return 'dungeon';
    if (interiorKind === 'building') return 'building';
    return 'space';   // 'ship' interior reads as a space battle theme
  }
  return s.kind;
}

/** Siege theme for launching a fight from a tier (matches kit SIEGE_KINDS). */
export function siegeKindForScale(i, interiorKind) {
  const k = kindForScale(i, interiorKind);
  return ['dungeon', 'building', 'ground', 'space'].includes(k) ? k : 'ground';
}
