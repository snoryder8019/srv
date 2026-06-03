/**
 * Director — the master agent. Two jobs:
 *   nextSteps(builds) -> prioritized suggestions + a one-line focus (LLM flavor)
 *   taskBoard(builds) -> per-hex COMPLETION matrix + a flat, actionable task list
 *
 * "Done" for a hex = it has all six kinds. Tasks link straight to the right
 * builder with the hex/tier prefilled, so you can drive a hex to 6/6.
 */
import { chat } from '../ai/client.js';
import { WORLD_BIBLE } from './index.js';

const ASSET_KINDS = ['environment', 'object', 'npc', 'level', 'storyline', 'music'];
// what a hex needs to be "playable-complete" (npc/object optional but recommended)
const REQUIRED_FOR_DONE = ['environment', 'level'];

export function summarize(builds) {
  const byKind = Object.fromEntries(ASSET_KINDS.map((k) => [k, 0]));
  const byHex = {};
  for (const b of builds) {
    byKind[b.kind] = (byKind[b.kind] || 0) + 1;
    const h = b.hexKey || 'unplaced';
    (byHex[h] ||= new Set()).add(b.kind);
  }
  const missingKinds = ASSET_KINDS.filter((k) => !byKind[k]);
  const hexGaps = Object.entries(byHex).map(([hex, kinds]) => ({ hex, has: [...kinds], missing: ASSET_KINDS.filter((k) => !kinds.has(k)) }));
  return { total: builds.length, byKind, missingKinds, hexGaps };
}

const action = (kind, hex) => `/admin/${kind}` + (hex && hex !== 'unplaced' ? `?hex=${encodeURIComponent(hex)}&tier=zone` : '');

/** Per-hex completion + a flat task list. */
export function taskBoard(builds) {
  const placed = builds.filter((b) => b.hexKey);
  const byHex = {};
  for (const b of placed) (byHex[b.hexKey] ||= new Set()).add(b.kind);

  const hexes = Object.entries(byHex).map(([hexKey, set]) => {
    const done = ASSET_KINDS.filter((k) => set.has(k));
    const todo = ASSET_KINDS.filter((k) => !set.has(k));
    const pct = Math.round((done.length / ASSET_KINDS.length) * 100);
    const playable = REQUIRED_FOR_DONE.every((k) => set.has(k));
    return { hexKey, done, todo, pct, playable };
  }).sort((a, b) => b.pct - a.pct);

  const tasks = [];
  // finish started hexes first: required kinds, then the rest
  for (const h of hexes) {
    for (const k of REQUIRED_FOR_DONE) if (h.todo.includes(k)) tasks.push({ title: `${k} for hex ${h.hexKey}`, kind: k, hexKey: h.hexKey, priority: 'required', action: action(k, h.hexKey) });
    for (const k of h.todo) if (!REQUIRED_FOR_DONE.includes(k)) tasks.push({ title: `${k} for hex ${h.hexKey}`, kind: k, hexKey: h.hexKey, priority: 'enrich', action: action(k, h.hexKey) });
  }
  // bootstrap if nothing placed
  if (!hexes.length) tasks.push({ title: 'Place a first environment on a hex', kind: 'environment', hexKey: null, priority: 'required', action: '/admin/environment' });

  const totals = {
    hexes: hexes.length,
    playable: hexes.filter((h) => h.playable).length,
    complete: hexes.filter((h) => h.pct === 100).length,
    openTasks: tasks.length,
  };
  return { ok: true, totals, hexes, tasks: tasks.slice(0, 24) };
}

function heuristicNext(state) {
  if (state.total === 0) return [{ title: 'Lay down a first environment', why: 'The world store is empty — define one hex to anchor everything.', kind: 'environment', hexKey: null, action: '/admin/environment' }];
  const out = [];
  for (const g of state.hexGaps) {
    if (g.hex === 'unplaced' || !g.has.includes('environment')) continue;
    for (const need of ['level', 'npc', 'object', 'storyline', 'music']) {
      if (g.missing.includes(need)) { out.push({ title: `Add a ${need} to hex ${g.hex}`, why: `Hex ${g.hex} has an environment but no ${need} yet.`, kind: need, hexKey: g.hex, action: action(need, g.hex) }); break; }
    }
  }
  for (const k of state.missingKinds) if (!out.some((o) => o.kind === k)) out.push({ title: `Create your first ${k}`, why: `No ${k} builds exist yet.`, kind: k, hexKey: null, action: action(k, null) });
  return out.slice(0, 6);
}

export async function nextSteps(builds) {
  const state = summarize(builds);
  const suggestions = heuristicNext(state);
  let focus = null;
  try {
    const raw = await chat([
      { role: 'system', content: `${WORLD_BIBLE}\n\nROLE: DIRECTOR. In ONE punchy sentence in the Madlands voice, say what to focus on this session. No quotes, no preamble, no list.` },
      { role: 'user', content: JSON.stringify({ state, planned: suggestions.map((s) => s.title) }) },
    ], { temperature: 0.8, maxTokens: 90 });
    if (raw) focus = raw.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].slice(0, 220);
  } catch { /* ignore */ }
  return { ok: true, source: focus ? 'director' : 'heuristic', state, focus, suggestions };
}

export default { summarize, taskBoard, nextSteps };
