/**
 * Slab — Agent Engine seam (BYO Claude)
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE chokepoint that decides which LLM backend a generation runs on:
 *
 *   house      → Ollama (the shared default; see callLLM in agentMcp.js)
 *   anthropic  → Claude, via a key the TENANT brought to the custom-key vault
 *                (/admin/settings/keys → "anthropic_api_key"), or the optional
 *                platform-level config.ANTHROPIC_API_KEY for unscoped paths.
 *
 * Resolution is key-driven and lightweight: bring a key → your MCP/dash agents
 * run on Claude; no key → they stay on the house model. An agent can still be
 * pinned to the house engine explicitly (engine === 'house') even when a key
 * exists, and an engine === 'anthropic' with no key degrades to house rather
 * than erroring — so a missing key never breaks a surface.
 *
 * Tenant scope reaches deep, un-plumbed callLLM call sites (the MCP tool
 * handlers, which receive ctx but not per-call opts) via AsyncLocalStorage:
 * the interactive entry points (runTool, chat dispatch, dashboard) wrap their
 * work in withEngine({ tenant, engine }), and callLLM reads that scope when no
 * explicit opts.tenant is passed. This is concurrency-safe — unlike a module
 * global, each async chain sees only its own tenant.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/config.js';
import { getSlabDb } from './mongo.js';

// ── Ambient engine scope ─────────────────────────────────────────────────────
export const engineALS = new AsyncLocalStorage();

/** Run `fn` with an ambient engine scope (tenant + optional forced engine). */
export function withEngine(scope, fn) {
  return engineALS.run(scope || {}, fn);
}

/** The engine scope for the current async chain, or {}. */
export function currentEngineScope() {
  return engineALS.getStore() || {};
}

// ── Key resolution ───────────────────────────────────────────────────────────
// The tenant's Anthropic key is surfaced decrypted on tenant.customKeys by
// middleware/tenant.js (same vault as every other tenant credential). We read it
// directly here rather than importing routes/admin/settings.js — the LLM layer
// must not depend on a route module. These are the names a tenant might use.
const KEY_NAMES = ['anthropic_api_key', 'anthropic', 'claude_api_key', 'claude'];

export function tenantAnthropicKey(tenant) {
  const keys = tenant?.customKeys;
  if (!Array.isArray(keys)) return '';
  for (const want of KEY_NAMES) {
    const hit = keys.find((k) => k?.name === want);
    if (hit && hit.value) return String(hit.value);
  }
  return '';
}

/**
 * Decide the engine for a generation.
 * @returns {{ engine:'house'|'anthropic', apiKey?:string, model?:string }}
 */
// Claude models an agent can be pinned to. Single source for the /admin/chat
// panel selector, its save-validation, and resolveEngine. Add a row here to
// offer a new model everywhere at once. The platform default (config.ANTHROPIC_MODEL,
// Opus 4.8) is used when an agent leaves the model unset.
export const ANTHROPIC_MODELS = [
  { key: 'claude-opus-4-8',  label: 'Opus 4.8 · most capable' },
  { key: 'claude-sonnet-5',  label: 'Sonnet 5 · balanced' },
  { key: 'claude-haiku-4-5', label: 'Haiku 4.5 · fast / cheap' },
];
const MODEL_KEYS = new Set(ANTHROPIC_MODELS.map((m) => m.key));
function pickModel(model) {
  return MODEL_KEYS.has(model) ? model : config.ANTHROPIC_MODEL;
}

export function resolveEngine({ tenant, engine, model } = {}) {
  // Explicit opt-out: an agent pinned to the house model stays house.
  if (engine === 'house') return { engine: 'house' };

  // claude-code (BYO Pro/Max via the Agent SDK) is a different surface than the
  // raw Messages API and isn't built yet — the /admin/chat panel marks it "soon"
  // and promises a House fallback, so honor that rather than mis-routing a
  // subscription flow onto the API-key path.
  if (engine === 'claude-code') return { engine: 'house' };

  const apiKey = tenantAnthropicKey(tenant) || config.ANTHROPIC_API_KEY || '';
  if (apiKey) return { engine: 'anthropic', apiKey, model: pickModel(model) };

  // engine === 'anthropic' requested but no key available → degrade to house.
  return { engine: 'house' };
}

// ── Anthropic client cache ───────────────────────────────────────────────────
// One client per distinct key (keys are long-lived); avoids re-instantiating on
// every turn. Keyed by the raw key string.
const clients = new Map();
function clientFor(apiKey) {
  let c = clients.get(apiKey);
  if (!c) { c = new Anthropic({ apiKey }); clients.set(apiKey, c); }
  return c;
}

// Anthropic requires the first message to be role 'user'. Slab histories can
// legitimately start with an assistant greeting — drop any leading assistant
// turns and coerce every content to a non-empty string.
function normalizeMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m?.content ?? '').trim();
    if (!content) continue;
    if (out.length === 0 && role !== 'user') continue; // no leading assistant
    out.push({ role, content });
  }
  if (out.length === 0) out.push({ role: 'user', content: '.' });
  return out;
}

/**
 * Call Claude with the same (messages, systemPrompt) contract as callLLM and
 * return a plain text string. Throws on API error so callLLM can fall back to
 * the house engine. `onUsage({ model, usage })` fires with the raw usage block
 * so the caller (which holds tenant identity) can record token analytics.
 */
export async function callAnthropic(messages, systemPrompt, { apiKey, model, timeoutMs = 90000, maxTokens = 4096, temperature, onUsage } = {}) {
  const client = clientFor(apiKey);
  const resp = await client.messages.create(
    {
      model: model || config.ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      ...(typeof temperature === 'number' ? { temperature } : {}),
      system: systemPrompt || undefined,
      messages: normalizeMessages(messages),
    },
    { timeout: timeoutMs },
  );
  if (typeof onUsage === 'function' && resp.usage) {
    try { onUsage({ model: resp.model || model, usage: resp.usage }); } catch { /* analytics never breaks a call */ }
  }
  return (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// ── Multi-tool agentic loop (Claude) ─────────────────────────────────────────
// The "fuller agentics": one Claude agent holds a NARROW set of scoped tools and
// calls them (possibly several, in sequence) to complete a task, then replies.
// `tools` are Anthropic tool defs ({name, description, input_schema}); `execTool`
// runs one and returns its result object (which may carry a `fill`). Returns the
// final text plus every tool call made (so the caller can surface fills for
// Apply). Short memory: `messages` is the client-held recent turns; nothing is
// persisted. Throws on API error so the caller can fall back to house.
function safeJson(o) { try { return JSON.stringify(o).slice(0, 8000); } catch { return String(o).slice(0, 2000); } }

// What the ORCHESTRATOR sees back from a tool. Deliberately lean: the heavy
// generated content (the `fill`) is captured separately for Apply and the model
// never needs to re-read it — feeding the full 800-word blog back into the
// orchestrator's context is pure wasted input cost. Give it just a receipt.
function toolResultForModel(result) {
  if (!result || typeof result !== 'object') return safeJson(result);
  const lean = { ok: !result.error };
  if (result.error) lean.error = String(result.error).slice(0, 300);
  if (result.message) lean.message = String(result.message).slice(0, 300);
  if (result.fill && typeof result.fill === 'object') lean.produced = Object.keys(result.fill).slice(0, 20);
  if (result.navigate) lean.navigate = result.navigate;
  if (result.suggestedBlocks) lean.blocks = result.suggestedBlocks.length;
  return safeJson(lean);
}

export async function callAnthropicAgentic(messages, systemPrompt, tools, execTool, { apiKey, model, timeoutMs = 120000, maxTokens = 4096, maxRounds = 4, onUsage } = {}) {
  const client = clientFor(apiKey);
  const conv = normalizeMessages(messages); // seed turns; assistant/tool_result blocks appended below
  const collected = [];
  for (let round = 0; round < maxRounds; round++) {
    const resp = await client.messages.create(
      { model: model || config.ANTHROPIC_MODEL, max_tokens: maxTokens,
        // Cache the tools+system prefix (brand context is the bulk of it) so the
        // loop's later rounds — and repeat turns within the TTL — read the prefix
        // instead of re-paying full input. No-op below the model's cache minimum.
        system: systemPrompt ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] : undefined,
        messages: conv, tools },
      { timeout: timeoutMs },
    );
    if (typeof onUsage === 'function' && resp.usage) { try { onUsage({ model: resp.model || model, usage: resp.usage }); } catch { /* analytics never breaks */ } }
    conv.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason !== 'tool_use') {
      const reply = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return { reply, toolResults: collected, rounds: round + 1 };
    }
    const results = [];
    for (const tu of (resp.content || []).filter((b) => b.type === 'tool_use')) {
      let result;
      try { result = await execTool(tu.name, tu.input || {}); }
      catch (e) { result = { error: e.message || String(e) }; }
      collected.push({ name: tu.name, input: tu.input || {}, result });
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: toolResultForModel(result) });
    }
    conv.push({ role: 'user', content: results });
  }
  return { reply: 'Reached the step limit for this turn — tell me to continue if there’s more to do.', toolResults: collected, rounds: maxRounds };
}

// ── Token analytics ──────────────────────────────────────────────────────────
// One row per LLM call into slab.token_usage. Normalizes both the Anthropic
// shape (input_tokens + cache_read/creation, output_tokens) and the OpenAI /
// Ollama shape (prompt_tokens, completion_tokens) so house calls are captured
// too when the backend reports usage. Fire-and-forget — recording must never
// block or break a generation.
function normUsage(u = {}) {
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  const baseInput = u.input_tokens ?? u.prompt_tokens ?? 0;
  const input = baseInput + cacheRead + cacheWrite;
  const output = u.output_tokens ?? u.completion_tokens ?? 0;
  return { input, output, cacheRead, cacheWrite };
}

export async function recordTokenUsage({ tenant, model, engine = 'anthropic', usage } = {}) {
  try {
    if (!usage) return;
    const { input, output, cacheRead, cacheWrite } = normUsage(usage);
    if (!input && !output) return; // nothing worth recording
    await getSlabDb().collection('token_usage').insertOne({
      at: new Date(),
      engine,
      model: model || null,
      tenantDb: tenant?.db || null,
      tenantDomain: tenant?.domain || null,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: input + output,
    });
  } catch { /* analytics is best-effort */ }
}
