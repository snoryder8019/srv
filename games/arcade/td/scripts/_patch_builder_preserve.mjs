import fs from 'fs';
const F = '/srv/td/public/javascripts/builder/map-builder.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('preserve painted roles')) { console.log('already'); process.exit(0); }

// Make growing/shrinking the board (adding edge tiles) preserve already-painted
// roles instead of wiping them. Capture roles by hexKey, rebuild, then re-apply.
s = s.replace(
  `function rebuild() {
  for (const mesh of tiles.values()) scene.remove(mesh);
  ({ tiles } = buildHexBoard(scene, { radius }));
}`,
  `function rebuild() {
  // preserve painted roles across a radius change (so you can add edge tiles
  // without losing your map). key -> role.
  const prevRoles = new Map();
  for (const [k, mesh] of tiles.entries()) {
    if (mesh.userData.role && mesh.userData.role !== 'default') prevRoles.set(k, mesh.userData.role);
  }
  for (const mesh of tiles.values()) scene.remove(mesh);
  ({ tiles } = buildHexBoard(scene, { radius }));
  for (const [k, role] of prevRoles.entries()) {
    const mesh = tiles.get(k);
    if (mesh) setTileRole(mesh, role);   // tiles still on the (possibly larger) board keep their role
  }
}`
);

fs.writeFileSync(F, s);
console.log('map-builder.js: rebuild now preserves painted roles when adding edge tiles');
