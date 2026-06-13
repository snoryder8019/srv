/**
 * Focused-agent runner — the core "one agent per form post" pattern.
 *
 * Each builder input (environment, object, npc, level, story, music, ...) defines
 * a small AGENT SPEC: a scoped system prompt + the JSON schema it must emit +
 * a few field hints. The runner wraps the manual form input, forces strict
 * JSON-only output from the model on the shared Ollama tunnel, parses it
 * defensively, and checks the required keys. Agents stay narrow on purpose — a
 * later master level-agent composes their outputs into a coherent map.
 *
 * An agent spec looks like:
 *   {
 *     name: 'environment',
 *     system: '...world bible + role...',
 *     required: ['name','palette','skyPrompt','groundPrompt'],
 *     schemaHint: '{ "name": string, "palette": [hex,...], ... }'
 *   }
 */
import { chat } from '../ai/client.js';

function extractJson(text) {
  if (!text) return null;
  // strip ```json fences and any prose around the object
  let s = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Run a focused agent over a manual form submission.
 * @param {object} spec   agent spec (see above)
 * @param {object} input  the manual form fields the admin typed
 * @param {object} ctx    optional context (tier, hexKey, worldBible, ...)
 * @returns {Promise<{ok, data?, error?, raw?}>}
 */
export async function runAgent(spec, input, ctx = {}) {
  const system = [
    spec.system,
    '',
    'You are a single-purpose builder agent. Expand and normalize the operator\'s',
    'manual input into ONE JSON object that exactly matches this shape:',
    spec.schemaHint || '(infer a sensible flat JSON object)',
    '',
    'Rules: respond with ONLY the JSON object — no prose, no markdown, no code',
    'fences. Keep all operator-provided values unless clearly invalid; fill gaps',
    'in keeping with the Madlands world (viking · space · funk · metal · pop).',
  ].join('\n');

  const user = JSON.stringify({
    context: { tier: ctx.tier || null, hexKey: ctx.hexKey || null },
    manualInput: input,
  });

  const raw = await chat(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: spec.temperature ?? 0.7, maxTokens: spec.maxTokens ?? 800 }
  );

  if (raw == null) return { ok: false, error: 'ai_gateway_unavailable' };

  const data = extractJson(raw);
  if (!data) return { ok: false, error: 'agent_returned_non_json', raw };

  const missing = (spec.required || []).filter((k) => data[k] == null || data[k] === '');
  if (missing.length) return { ok: false, error: 'missing_fields:' + missing.join(','), raw, data };

  return { ok: true, data };
}

export default { runAgent };
