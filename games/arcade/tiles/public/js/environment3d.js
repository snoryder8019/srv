/**
 * environment3d.js — THIN SHIM. The parlor is now the SHARED module at
 * games.madladslab.com/shared/js/parlor3d.js, used by BOTH tiles and reels so the
 * room (dome · floor · bar · board · satellites · avatars · betting) stays
 * consistent and changes land in both at once.
 *
 * tiles consumes it SAME-ORIGIN (apiBase '') with full betting; the exported
 * createEnvironment() keeps the old API so table3d.js / dominoes3d.js are unchanged.
 */
// LOCAL same-origin copy (synced from /srv/games/_shared/js via sync.sh). Same-origin
// avoids the cross-origin + import-map resolution of `three` inside avatar3d, which
// silently broke the parlor when imported cross-origin.
import { createParlor } from './parlor3d.js?v=1781441125092';

export function createEnvironment(opts = {}) {
  return createParlor({ ...opts, apiBase: '', features: { betting: true } });
}

export default { createEnvironment };
