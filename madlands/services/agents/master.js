/**
 * Master composer — assembles a hex's builds into ONE coherent scene plan the
 * map renders in a single pass (instead of applying pieces piecemeal).
 *
 * Deterministic placement (reliable; the LLM can refine arrangement later):
 *   - center tile = base
 *   - objects   -> inner rings
 *   - npcs      -> a mid ring (kept off the object slots)
 *   - spawns    -> outer ring, one per level.spawnPlan entry
 *   - portals   -> outer ring, from level.connections
 * Returns { environment, music, level, tiles:[{q,r,role,label}], objects:[{...,q,r}],
 *           npcs:[{...,q,r}] }.
 */
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
function ring(rad) {
  if (rad <= 0) return [[0, 0]];
  const out = [];
  let q = DIRS[4][0] * rad, r = DIRS[4][1] * rad;
  for (let i = 0; i < 6; i++) for (let j = 0; j < rad; j++) { out.push([q, r]); q += DIRS[i][0]; r += DIRS[i][1]; }
  return out;
}

export function composeHex(hexKey, builds) {
  const latest = {}; const objects = []; const npcs = [];
  for (const b of builds) {
    const o = b.output || {};
    if (b.kind === 'object') objects.push(o);
    else if (b.kind === 'npc') npcs.push(o);
    else if (!latest[b.kind]) latest[b.kind] = o;
  }
  const level = latest.level || null;
  const r1 = ring(1), r2 = ring(2), r3 = ring(3);

  const objPlaced = objects.map((o, i) => { const s = r1[i] || r2[i - 6] || [0, 0]; return { ...o, q: s[0], r: s[1] }; });
  const npcPlaced = npcs.map((n, i) => { const s = r2[r2.length - 1 - i] || r3[i] || [0, 0]; return { ...n, q: s[0], r: s[1] }; });

  const tiles = [{ q: 0, r: 0, role: 'base' }];
  const spawnList = (level && Array.isArray(level.spawnPlan)) ? level.spawnPlan : (level ? ['spawn', 'spawn'] : []);
  const n = Math.min(spawnList.length, 6);
  for (let i = 0; i < n; i++) {
    const s = r3[Math.floor((i * r3.length) / Math.max(1, n))];
    if (s) tiles.push({ q: s[0], r: s[1], role: 'spawn', label: String(spawnList[i]).slice(0, 60) });
  }
  const conns = (level && Array.isArray(level.connections)) ? level.connections : [];
  conns.slice(0, 4).forEach((c, i) => { const s = r3[(i * 3 + 1) % r3.length]; if (s) tiles.push({ q: s[0], r: s[1], role: 'path', label: String(c).slice(0, 60) }); });

  return {
    ok: true, hexKey,
    environment: latest.environment || null,
    music: latest.music || null,
    level,
    tiles, objects: objPlaced, npcs: npcPlaced,
    counts: { objects: objPlaced.length, npcs: npcPlaced.length, spawns: n, portals: Math.min(conns.length, 4) },
  };
}

export default { composeHex };
