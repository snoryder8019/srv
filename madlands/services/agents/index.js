/**
 * Agent registry — every builder's focused agent in one place.
 *
 * Each spec declares the FORM FIELDS it needs once; the admin renders a generic
 * form from that, the generic client runs the agent and FILLS the fields with
 * the result (editable), then saves a Build. Adding a new builder = adding a
 * spec here. The schema the agent must emit is derived from the fields, so the
 * form and the agent contract never drift apart.
 *
 * Field types: text | textarea | select | list (comma/newline -> array) |
 *              colorlist (hex array, shown as swatches)
 * Fields flagged { agent:true } are the ones the agent is expected to fill in.
 */
import { runAgent } from './runner.js';

export const WORLD_BIBLE =
  'Madlands is a recursive hex adventure. Aesthetic: VIKING · SPACE · FUNK · ' +
  'METAL · POP — runic and metal-heavy against deep-space neon, with funk/pop ' +
  'color pops (hot magenta, acid gold, plasma cyan) over an indigo/violet base. ' +
  'The world nests by scale: space -> body (planet/moon/station/ship) -> zone -> ' +
  'interior (dungeon/building/ship). Everything should read at its scale tier and ' +
  'feel like one coherent universe.';

const tierField = { key: 'tier', label: 'Scale tier', type: 'select', options: ['space', 'body', 'zone', 'interior'], value: 'zone' };
const idFields = [
  { key: 'name', label: 'Name', type: 'text', placeholder: 'short evocative name' },
  tierField,
  { key: 'hexKey', label: 'Hex key (optional)', type: 'text', placeholder: 'e.g. 2,-1' },
];

// derive the JSON schema the agent must emit, straight from the fields
function fieldsToSchema(fields) {
  const s = {};
  for (const f of fields) {
    if (f.key === 'tier') { s.tierFit = 'space|body|zone|interior'; continue; }
    if (f.type === 'list') s[f.key] = ['string'];
    else if (f.type === 'colorlist') s[f.key] = ['#hex'];
    else s[f.key] = 'string';
  }
  return s;
}

function makeSpec({ kind, name, blurb, role, required, temperature = 0.8, fields }) {
  const spec = {
    kind, name, blurb,
    temperature, maxTokens: 900,
    required,
    fields,
    system: `${WORLD_BIBLE}\n\nROLE: You are the ${kind.toUpperCase()} agent. ${role}`,
    schemaHint: JSON.stringify(fieldsToSchema(fields)),
  };
  return spec;
}

export const SPECS = {
  environment: makeSpec({
    kind: 'environment', name: 'Environment',
    blurb: 'palette · biome · sky & ground (SD) · music mood',
    role: 'Define the look and feel of one hex/board: palette, biome, the SD prompts scene.js consumes, and a music mood tag.',
    required: ['name', 'palette', 'skyPrompt', 'groundPrompt'],
    fields: [
      ...idFields,
      { key: 'mood', label: 'Mood', type: 'text', placeholder: 'frozen, reverent, low funk-dirge' },
      { key: 'biome', label: 'Biome', type: 'text', placeholder: 'ash-fjord under a ringed gas giant' },
      { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'runed longship wrecks, neon aurora' },
      { key: 'palette', label: 'Palette', type: 'colorlist', agent: true },
      { key: 'skyPrompt', label: 'Sky prompt (SD)', type: 'textarea', agent: true },
      { key: 'groundPrompt', label: 'Ground prompt (SD)', type: 'textarea', agent: true },
      { key: 'ambientMusic', label: 'Ambient music mood', type: 'text', agent: true },
      { key: 'hazards', label: 'Hazards', type: 'list', agent: true },
    ],
  }),

  object: makeSpec({
    kind: 'object', name: 'Object',
    blurb: '3D / GLTF prop · materials · movable rig',
    role: 'Define a placeable object and the brief a 3D/GLTF generator needs: a build prompt, materials, scale, whether it moves, and animations.',
    required: ['name', 'category', 'gltfPrompt'],
    fields: [
      ...idFields,
      { key: 'category', label: 'Category', type: 'select', options: ['prop', 'structure', 'vehicle', 'item', 'hazard', 'creature'] },
      { key: 'description', label: 'Description', type: 'textarea', placeholder: 'rune-etched longship prow, frost-bitten iron' },
      { key: 'scale', label: 'Scale (hex units)', type: 'text', placeholder: '1' },
      { key: 'gltfPrompt', label: 'GLTF build prompt', type: 'textarea', agent: true },
      { key: 'materials', label: 'Materials', type: 'list', agent: true },
      { key: 'movable', label: 'Movable', type: 'select', options: ['no', 'yes'], agent: true },
      { key: 'animations', label: 'Animations', type: 'list', agent: true },
    ],
  }),

  npc: makeSpec({
    kind: 'npc', name: 'NPC',
    blurb: 'character · dialogue · goals',
    role: 'Define a non-player character: their role, temperament, look, and a dialogue brief (style, greeting, barks, goals) for the dialogue runtime.',
    required: ['name', 'role', 'greeting'],
    temperature: 0.9,
    fields: [
      ...idFields,
      { key: 'role', label: 'Role', type: 'text', placeholder: 'skald, scrap-priest, dock boss' },
      { key: 'faction', label: 'Faction', type: 'text', placeholder: 'the Rusted Choir' },
      { key: 'temperament', label: 'Temperament', type: 'text', placeholder: 'gruff, funky, doom-cheerful' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'appearancePrompt', label: 'Appearance prompt (SD)', type: 'textarea', agent: true },
      { key: 'dialogueStyle', label: 'Dialogue style', type: 'text', agent: true },
      { key: 'greeting', label: 'Greeting', type: 'textarea', agent: true },
      { key: 'goals', label: 'Goals', type: 'list', agent: true },
      { key: 'barks', label: 'Barks', type: 'list', agent: true },
    ],
  }),

  level: makeSpec({
    kind: 'level', name: 'Level',
    blurb: 'layout · objectives · spawns · connections',
    role: 'Define a playable level for a hex/board: layout notes, objective, difficulty, spawn plan, win/fail conditions, and spawn-portal connections to other hexes.',
    required: ['name', 'objective', 'winCondition'],
    fields: [
      ...idFields,
      { key: 'theme', label: 'Theme', type: 'text' },
      { key: 'objective', label: 'Objective', type: 'textarea' },
      { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['intro', 'normal', 'hard', 'brutal'] },
      { key: 'layout', label: 'Layout notes', type: 'textarea', agent: true },
      { key: 'spawnPlan', label: 'Spawn plan', type: 'list', agent: true },
      { key: 'winCondition', label: 'Win condition', type: 'text', agent: true },
      { key: 'failCondition', label: 'Fail condition', type: 'text', agent: true },
      { key: 'connections', label: 'Portal connections', type: 'list', agent: true },
    ],
  }),

  storyline: makeSpec({
    kind: 'storyline', name: 'Storyline',
    blurb: 'arc · beats · hooks',
    role: 'Define a story arc threaded through hexes/tiers: premise, tone, ordered beats, hooks, factions, and resolution.',
    required: ['name', 'premise', 'beats'],
    temperature: 0.9,
    fields: [
      ...idFields,
      { key: 'premise', label: 'Premise', type: 'textarea' },
      { key: 'tone', label: 'Tone', type: 'text' },
      { key: 'beats', label: 'Beats (ordered)', type: 'list', agent: true },
      { key: 'hooks', label: 'Hooks', type: 'list', agent: true },
      { key: 'factions', label: 'Factions involved', type: 'list', agent: true },
      { key: 'resolution', label: 'Resolution', type: 'textarea', agent: true },
    ],
  }),

  music: makeSpec({
    kind: 'music', name: 'Music',
    blurb: 'playable score · progression · groove (Tone.js)',
    role: 'Compose a PLAYABLE cue. Give a key (e.g. "A minor"), a tempo in BPM, a chord ' +
      'progression as 4 chord names using letters A-G with optional m/7/maj7/dim/sus ' +
      '(e.g. ["Am","F","C","G"]), a groove word, a lead timbre, instrumentation, a ' +
      'structure, and a generation prompt — all viking-space-funk-metal-pop. The ' +
      'progression and key drive a real-time synth, so keep them valid and musical.',
    required: ['key', 'tempoBpm', 'progression'],
    fields: [
      ...idFields,
      { key: 'scene', label: 'Scene / when it plays', type: 'text' },
      { key: 'mood', label: 'Mood', type: 'text' },
      { key: 'key', label: 'Key', type: 'text', placeholder: 'A minor', agent: true },
      { key: 'tempoBpm', label: 'Tempo (BPM)', type: 'text', placeholder: '88', agent: true },
      { key: 'progression', label: 'Chord progression', type: 'list', placeholder: 'Am, F, C, G', agent: true },
      { key: 'groove', label: 'Groove', type: 'text', placeholder: 'half-time doom funk', agent: true },
      { key: 'leadTimbre', label: 'Lead timbre', type: 'text', placeholder: 'synth-lyre', agent: true },
      { key: 'genreTags', label: 'Genre tags', type: 'list', agent: true },
      { key: 'instrumentation', label: 'Instrumentation', type: 'list', agent: true },
      { key: 'structure', label: 'Structure', type: 'text', agent: true },
      { key: 'referencePrompt', label: 'Generation prompt', type: 'textarea', agent: true },
    ],
  }),
};

export const KINDS = Object.keys(SPECS);
export function getSpec(kind) { return SPECS[kind] || null; }
export function listSpecs() { return KINDS.map((k) => ({ kind: k, name: SPECS[k].name, blurb: SPECS[k].blurb, fieldCount: SPECS[k].fields.length })); }

/** Run the focused agent for a kind over the manual form input. */
export async function runKind(kind, input, ctx = {}) {
  const spec = getSpec(kind);
  if (!spec) return { ok: false, error: 'unknown_kind' };
  return runAgent(spec, input, ctx);
}

export default { SPECS, KINDS, getSpec, listSpecs, runKind, WORLD_BIBLE };
