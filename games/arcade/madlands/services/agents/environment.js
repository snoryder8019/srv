/**
 * Environment builder agent.
 * Scope: turn an operator's manual environment notes into a structured
 * environment artifact for a given scale tier + hex — palette, mood, biome,
 * and the SD prompts that scene.js already consumes (sky-env / ground-terrain).
 * Narrow on purpose; the master level-agent composes it with objects/npc/etc.
 */
import { runAgent } from './runner.js';

const WORLD_BIBLE =
  'Madlands is a recursive hex adventure. Aesthetic: VIKING · SPACE · FUNK · ' +
  'METAL · POP — runic and metal-heavy, set against deep-space neon, with funk/' +
  'pop color pops (hot magenta, acid gold, plasma cyan) over indigo/violet base. ' +
  'The world nests by scale: space -> body (planet/moon/station/ship) -> zone -> ' +
  'interior (dungeon/building/ship). Environments should read clearly at their ' +
  'scale tier and feel like part of one coherent universe.';

export const ENVIRONMENT_AGENT = {
  name: 'environment',
  temperature: 0.8,
  maxTokens: 850,
  system:
    WORLD_BIBLE + '\n\nROLE: You are the ENVIRONMENT agent. Given manual notes ' +
    'and a scale tier, produce the environment definition for one hex/board.',
  required: ['name', 'palette', 'skyPrompt', 'groundPrompt'],
  schemaHint: JSON.stringify({
    name: 'string — short evocative name',
    tierFit: 'space|body|zone|interior',
    mood: 'string — one line',
    biome: 'string — e.g. ash-fjord, neon-tundra, ringworld-bazaar',
    palette: ['#hex', '#hex', '#hex', '#hex'],
    skyPrompt: 'string — SD prompt for the sky/background dome',
    groundPrompt: 'string — SD prompt for a tileable ground texture',
    ambientMusic: 'string — mood tag for the music agent (e.g. doom-funk dirge)',
    hazards: ['string'],
    notes: 'string',
  }, null, 0),
};

export async function runEnvironmentAgent(input, ctx = {}) {
  return runAgent(ENVIRONMENT_AGENT, input, ctx);
}

export default { ENVIRONMENT_AGENT, runEnvironmentAgent };
