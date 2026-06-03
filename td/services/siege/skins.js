/**
 * siege-kit/skins.js
 * ------------------
 * One defender, many skins. The siege MECHANICS never change between instance
 * kinds — a "tower" has the same stats, targeting and firing in a cave, a
 * building, a field or in orbit. Only its appearance (and the scenery + palette
 * around it) is reskinned per kind. This module is the single source of truth
 * for that mapping. Pure + browser-safe.
 *
 * The engine's renderer asks: skinFor(descriptor.kind, tower) -> a visual spec.
 * It NEVER asks for new stats here — those come from the tower definition.
 */

// Per-kind theme: scenery biome, background pair, palette, and a label the
// reskinned defender carries (so the same Tower reads "Turret" in a dungeon and
// "Platform" in space). gltfUrl is a *fallback* model used only when a tower
// definition has no model of its own.
export const KIND_THEME = {
  dungeon: {
    label: 'Emplacement',
    scenery: 'cave',
    palette: ['#1b1226', '#3a2150', '#b06cff', '#ffd24a'],
    bg: { skyUrl: '/assets/img/scene/cave-env.png', groundUrl: '/assets/img/scene/cave-ground.png' },
    defenderColor: 0xb06cff,
    defenderGltf: '/assets/models/skins/dungeon-turret.glb',
    muzzle: 0xffd24a,
  },
  building: {
    label: 'Sentry',
    scenery: 'interior',
    palette: ['#10141c', '#243044', '#6cc8ff', '#ff6c6c'],
    bg: { skyUrl: '/assets/img/scene/interior-env.png', groundUrl: '/assets/img/scene/interior-floor.png' },
    defenderColor: 0x6cc8ff,
    defenderGltf: '/assets/models/skins/building-sentry.glb',
    muzzle: 0xff6c6c,
  },
  ground: {
    label: 'Turret',
    scenery: 'desert',
    palette: ['#1a1408', '#4a3a18', '#e0a83a', '#7cffb2'],
    bg: { skyUrl: '/assets/img/scene/sky-env.png', groundUrl: '/assets/img/scene/ground-terrain.png' },
    defenderColor: 0xe0a83a,
    defenderGltf: '/assets/models/skins/ground-turret.glb',
    muzzle: 0xffe08a,
  },
  space: {
    label: 'Platform',
    scenery: 'orbital',
    palette: ['#05060f', '#0e1430', '#6c8cff', '#ff2d9b'],
    bg: { skyUrl: '/assets/img/scene/space-env.png', groundUrl: null },   // no ground in orbit
    defenderColor: 0x6c8cff,
    defenderGltf: '/assets/models/skins/space-platform.glb',
    muzzle: 0xff2d9b,
  },
};

export function themeFor(kind) {
  return KIND_THEME[kind] || KIND_THEME.ground;
}

/**
 * Resolve the visual skin for a placed defender in a given instance kind.
 * Prefers the tower's own uploaded model; falls back to the kind's default
 * defender model + tint so a community tower still "fits" the theme.
 *
 * @returns {{ gltfUrl:string|null, color:number, scale:number, label:string, muzzle:number }}
 */
export function skinFor(kind, tower = {}) {
  const theme = themeFor(kind);
  const ownModel = tower.gltfUrl || (tower.towerDef && tower.towerDef.gltfUrl) || null;
  const ownScale = tower.scale || (tower.towerDef && tower.towerDef.scale) || 1;
  return {
    gltfUrl: ownModel || theme.defenderGltf,
    color: theme.defenderColor,
    scale: ownScale,
    label: theme.label,
    muzzle: theme.muzzle,
    themed: !ownModel,   // true => we substituted the kind's default model
  };
}

/** Scene background/scenery hints for the engine's scene setup. */
export function sceneEnvFor(kind) {
  const theme = themeFor(kind);
  return { scenery: theme.scenery, palette: theme.palette, ...theme.bg };
}
