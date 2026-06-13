import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/enemy.js';
let s = fs.readFileSync(F, 'utf8');

// Remap models: ground units walk (robot, animated). Only the flyer uses a bird.
// The fallback (used for any unmapped type) is the robot walker — NOT the stork —
// so we never default to the old flamingo/bird again.
const oldMap = `const ENEMY_MODELS = {
  tank:  { url: '/assets/gltf/enemies/robot.glb',  clip: 'Running',     death: 'Death', skinned: true,  yawOffset: Math.PI, yLift: 0,        sizeMul: 1.25 },
  basic: { url: '/assets/gltf/enemies/stork.glb',  clip: 'storkFly_B_', death: null,    skinned: false, yawOffset: 0,       yLift: 0.35 * S, sizeMul: 1.0, flying: true },
  fast:  { url: '/assets/gltf/enemies/parrot.glb', clip: 'parrot_A_',   death: null,    skinned: false, yawOffset: 0,       yLift: 0.4 * S,  sizeMul: 0.8, flying: true },
};`;
const newMap = `const ROBOT = (sizeMul) => ({ url: '/assets/gltf/enemies/robot.glb', clip: 'Running', death: 'Death', skinned: true, yawOffset: Math.PI, yLift: 0, sizeMul });
const ENEMY_MODELS = {
  // ground walkers — animated robot (the proper grunt/machine on-the-ground unit)
  basic:       ROBOT(1.0),
  fast:        ROBOT(0.85),
  tank:        ROBOT(1.35),
  grunt:       ROBOT(1.0),
  runner:      ROBOT(0.8),
  machine:     ROBOT(1.6),
  infiltrator: ROBOT(1.0),
  // the only flier keeps a winged model
  flyer: { url: '/assets/gltf/enemies/parrot.glb', clip: 'parrot_A_', death: null, skinned: false, yawOffset: 0, yLift: 0.4 * S, sizeMul: 0.9, flying: true },
};`;
if (!s.includes(oldMap)) { console.log('model map anchor not found'); process.exit(1); }
s = s.replace(oldMap, newMap);

// fallback when a type is missing must be the robot walker, not the bird
s = s.replace(
  `const cfg = ENEMY_MODELS[type] || ENEMY_MODELS.basic;`,
  `const cfg = ENEMY_MODELS[type] || ENEMY_MODELS.grunt || ENEMY_MODELS.basic;`
);

fs.writeFileSync(F, s);
console.log('enemy.js: ground units now use the robot walker; flamingo/stork removed');
