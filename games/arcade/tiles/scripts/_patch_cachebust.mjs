import fs from 'fs';
const VER = 'v=' + Date.now();   // unique per deploy
// Append ?v=... to relative module imports in the casino clients so browsers
// re-fetch changed sub-modules instead of serving stale cached copies.
for (const f of ['/srv/games/arcade/tiles/public/js/roulette3d.js', '/srv/games/arcade/tiles/public/js/craps3d.js', '/srv/games/arcade/tiles/public/js/table3d.js']) {
  let s = fs.readFileSync(f, 'utf8');
  // strip any prior ?v=... then re-add
  s = s.replace(/from '(\.\/[a-zA-Z0-9_-]+\.js)(\?v=\d+)?'/g, (m, p1) => `from '${p1}?${VER}'`);
  fs.writeFileSync(f, s);
  console.log(f.split('/').pop(), 'imports cache-busted ->', VER);
}
