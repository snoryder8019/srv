import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/enemy.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('emissive: tint')) { console.log('already'); process.exit(0); }

// 1) Brighter, higher-contrast unit tints so they don't blend with the board.
s = s.replace(
  `const SPEC = {
  basic:       { tint: 0x9fd06a, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  fast:        { tint: 0xffe24a, sizeMul: 0.9, kind: 'runner', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  tank:        { tint: 0xff6644, sizeMul: 1.5, kind: 'hull',   model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  grunt:       { tint: 0x9fd06a, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  runner:      { tint: 0xffd24a, sizeMul: 0.9, kind: 'runner', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  machine:     { tint: 0xc0563a, sizeMul: 1.7, kind: 'hull',   model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  flyer:       { tint: 0x66ccff, sizeMul: 1.0, kind: 'flyer', flying: true },
  infiltrator: { tint: 0x9fd06a, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
};`,
  `const SPEC = {
  basic:       { tint: 0xff5a3c, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  fast:        { tint: 0xffd23c, sizeMul: 0.9, kind: 'runner', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  tank:        { tint: 0xff3b6e, sizeMul: 1.5, kind: 'hull',   model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  grunt:       { tint: 0xff7a2c, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  runner:      { tint: 0xffd23c, sizeMul: 0.9, kind: 'runner', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  machine:     { tint: 0xff4530, sizeMul: 1.7, kind: 'hull',   model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
  flyer:       { tint: 0x3cf0ff, sizeMul: 1.0, kind: 'flyer', flying: true },
  infiltrator: { tint: 0xff7a2c, sizeMul: 1.0, kind: 'walker', model: '/assets/gltf/enemies/robot.glb', clip: 'Running' },
};`
);

// 2) Make the body material self-lit (emissive = tint) so units glow against the
//    transparent board instead of relying on scene lighting.
s = s.replace(
  `  const body = mat(tint, { rough: 0.5, metal: 0.45 });`,
  `  const body = mat(tint, { rough: 0.45, metal: 0.4, emissive: tint, emissiveIntensity: 0.4 });`
);

fs.writeFileSync(F, s);
console.log('enemy.js: brighter high-contrast tints + emissive glow (units pop against board)');
