/**
 * AI gateway client for the tiles platform.
 *
 * Talks to the madLadsLab GPU tunnel (ollama.madladslab.com), an
 * OpenAI-compatible surface:
 *   - POST /v1/chat/completions   (qwen2.5:7b)  -> text
 *   - POST /v1/images/generations (SD v1.5)     -> scene backgrounds / art
 *
 * Mirrors /srv/td/services/ai/client.js. Everything is defensive: short
 * timeouts, never throws into a request path, returns null on failure so
 * callers fall back gracefully (the table renders a flat color background if
 * no image exists). SD inference is slow — generate OFFLINE (dev endpoint /
 * cron), never inline in a page load.
 */
import { config } from '../../config/index.js';

const AI = config.ai;

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AI.key}`,
  };
}

/** Low-level POST with an abortable timeout. Returns parsed JSON or null. */
async function postJSON(path, body, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI.baseUrl}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[ai] ${path} -> ${res.status} ${text.slice(0, 120)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') console.warn(`[ai] ${path} timed out after ${timeoutMs}ms`);
    else console.warn(`[ai] ${path} error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Chat completion. Returns assistant text, or null on failure.
 * @param {Array<{role,content}>} messages
 * @param {object} opts { temperature, maxTokens, timeoutMs, model }
 */
export async function chat(messages, opts = {}) {
  if (!AI.key) return null;
  const data = await postJSON('/v1/chat/completions', {
    model: opts.model || AI.model,
    messages,
    temperature: opts.temperature ?? 0.85,
    max_tokens: opts.maxTokens ?? 80,
    stream: false,
  }, opts.timeoutMs ?? 15000);

  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text.trim() : null;
}

/**
 * Generate an image. Returns a base64 PNG string (no data: prefix), or null.
 * SD inference is slow — default timeout is generous; run offline, never in a
 * request path.
 * @param {string} prompt
 * @param {object} opts { size, steps, negativePrompt, timeoutMs }
 */
export async function generateImage(prompt, opts = {}) {
  if (!AI.key) return null;
  const data = await postJSON('/v1/images/generations', {
    prompt,
    n: 1,
    size: opts.size || '512x512',
    steps: opts.steps ?? 20,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
  }, opts.timeoutMs ?? 120000);

  return data?.data?.[0]?.b64_json || null;
}

/** Liveness probe for the gateway (used by /health/ai diagnostics). */
export async function aiHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${AI.baseUrl}/health`, { headers: authHeaders(), signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, detail: await res.json().catch(() => ({})) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default { chat, generateImage, aiHealth };
