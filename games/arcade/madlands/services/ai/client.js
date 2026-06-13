/**
 * AI gateway client for Madlands.
 * Talks to the shared madLadsLab GPU tunnel (ollama.madladslab.com), an
 * OpenAI-compatible surface:
 *   POST /v1/chat/completions    (qwen2.5:7b) -> builder agents (structured JSON)
 *   POST /v1/images/generations  (SD v1.5)    -> environment / object textures
 * Defensive: short timeouts, never throws into a request path, returns null on
 * failure so callers can degrade gracefully.
 */
import config from '../../config/index.js';

const AI = config.ai;

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI.key}` };
}

async function postJSON(path, body, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI.baseUrl}${path}`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[ai] ${path} -> ${res.status} ${text.slice(0, 160)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[ai] ${path} ${err.name === 'AbortError' ? 'timed out' : 'error: ' + err.message}`);
    return null;
  } finally { clearTimeout(t); }
}

/** Chat completion -> assistant text (or null). */
export async function chat(messages, opts = {}) {
  if (!AI.key) return null;
  const data = await postJSON('/v1/chat/completions', {
    model: opts.model || AI.model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 700,
    stream: false,
  }, opts.timeoutMs ?? 30000);
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text.trim() : null;
}

/** SD image -> base64 PNG (no data: prefix), or null. Slow; never inline in a tick loop. */
export async function generateImage(prompt, opts = {}) {
  if (!AI.key) return null;
  const data = await postJSON('/v1/images/generations', {
    prompt, n: 1, size: opts.size || '512x512', steps: opts.steps ?? 20,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
  }, opts.timeoutMs ?? 120000);
  return data?.data?.[0]?.b64_json || null;
}

export async function aiHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${AI.baseUrl}/health`, { headers: authHeaders(), signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? { ok: true } : { ok: false, status: res.status };
  } catch (err) { return { ok: false, error: err.message }; }
}

export default { chat, generateImage, aiHealth };
