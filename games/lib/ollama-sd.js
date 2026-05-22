// Stable Diffusion image generation via the madLadsLab Ollama gateway.
// Sibling to ollama-agent.js (which handles LLM chat). Returns the raw
// base64 PNG so callers can decide whether to persist via lib/assets.js
// or stream straight to the browser.
const URL = process.env.OLLAMA_SD_URL || 'https://ollama.madladslab.com/v1/images/generations';
const KEY = process.env.OLLAMA_KEY || '';

async function generate({ prompt, negativePrompt = 'blurry, low quality, watermark, text artifacts', size = '512x512', steps = 22, guidance = 7.5, seed = null } = {}) {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt required');
  if (!KEY) throw new Error('OLLAMA_KEY not configured');

  const body = {
    prompt: String(prompt).slice(0, 1000),
    negative_prompt: negativePrompt,
    size,
    n: 1,
    num_inference_steps: Math.min(Math.max(parseInt(steps) || 22, 8), 40),
    guidance_scale: Number(guidance) || 7.5,
  };
  if (seed != null) body.seed = parseInt(seed) || null;

  // SD inference on the lab GPU is 15-45s per image, so we allow a long
  // timeout — the route layer streams a "generating..." status while waiting.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('SD HTTP ' + r.status + (txt ? ': ' + txt.slice(0, 200) : ''));
    }
    const data = await r.json();
    const item = data && data.data && data.data[0];
    if (!item || !item.b64_json) throw new Error('Empty SD response');
    return { base64: item.b64_json, revisedPrompt: item.revised_prompt || null, size };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('SD timeout (90s) — GPU likely busy, retry');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate };
