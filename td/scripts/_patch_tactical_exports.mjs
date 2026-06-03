import fs from 'fs';
const F = '/srv/td/public/javascripts/game/tactical.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('export function isHunting')) { console.log('already'); process.exit(0); }

// Expose hunt/pause state + a board-tap expose entry so play.js can route taps
// on units (raycast) into the Where's-Waldo expose, not just list rows.
s = s.replace(
  `export default { initTactical };`,
  `// ---- board-tap integration (play.js calls these) ----
// True when a tactical pause is active AND the player is in hunt mode.
export function isHunting() {
  return huntMode && overlay && overlay.classList.contains('show');
}
// True when the tactical pause overlay is currently shown (paused).
export function isPaused() {
  return !!(overlay && overlay.classList.contains('show'));
}
// Expose an enemy by id (from a board tap). Mirrors the list-row tap.
export function exposeEnemy(enemyId) {
  if (!enemyId || !state.runId) return;
  socket.emit('run:expose', { runId: state.runId, enemyId });
}

export default { initTactical, isHunting, isPaused, exposeEnemy };`
);

fs.writeFileSync(F, s);
console.log('tactical.js: exports isHunting/isPaused/exposeEnemy for board taps');
