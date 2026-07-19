/**
 * Slab — Agent MCP Module
 * Shared tools registry for all copy agents.
 * Also exposes a JSON-RPC handler for the MCP HTTP endpoint.
 */

import { config } from '../config/config.js';
import { getSlabDb } from './mongo.js';
import { callAnthropic, resolveEngine, engineALS, currentEngineScope, recordTokenUsage } from './agentEngine.js';

const OLLAMA_URL = config.OLLAMA_URL;
const OLLAMA_BASE = OLLAMA_URL.replace(/\/v1\/chat\/completions$/, '');
const SD_URL = `${OLLAMA_BASE}/v1/images/generations`;
const OLLAMA_KEY = config.OLLAMA_KEY;
export const MODEL = config.OLLAMA_MODEL;

// ── Shared utilities ──────────────────────────────────────────────────────────

export async function webSearch(query) {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&text_decorations=false`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': config.SEARCH_API_KEY,
      },
    });
    if (!res.ok) return 'Search unavailable.';
    const data = await res.json();
    const results = (data.web?.results || []).map(r => `${r.title}\n${r.description || ''}\n${r.url}`);
    return results.length ? results.join('\n\n') : 'No results found.';
  } catch (e) {
    return 'Search failed: ' + e.message;
  }
}

export async function fetchUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    return text || 'Page fetched but no readable content found.';
  } catch (e) {
    return 'Fetch failed: ' + e.message;
  }
}

// deepseek-r1 wraps its answer after a <think>…</think> reasoning block and
// occasionally slips into Chinese. These helpers clean completions.
export function stripThink(s) {
  return String(s || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')   // paired reasoning block
    .replace(/^[\s\S]*?<\/think>/i, '')          // stray closing tag (open stripped upstream)
    .replace(/<think>[\s\S]*$/i, '')             // unclosed opening tag → drop to end
    .trim();
}
// CJK = Chinese/Japanese/Korean + fullwidth punctuation. Used to catch the model
// leaving English.
const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
export function hasCJK(s) { return CJK_RE.test(String(s || '')); }
export function stripCJK(s) {
  return String(s || '')
    .replace(new RegExp(CJK_RE.source + '+', 'g'), '')
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}

// ── Transient-failure retry (2026-07-02) ─────────────────────────────────────
// The Ollama/SD cluster fronts requests through a load balancer that can briefly
// 502/503/504 (a backend cold-load, an instance restart) or drop the socket
// mid-flight ("wsarecv: connection forcibly closed"). Those are transient and
// clear within a second or two, so we retry them ONCE with a short backoff.
// We do NOT retry genuine slow-inference timeouts (AbortSignal.timeout) — the
// backend was simply too slow, and a retry would just burn the caller's budget
// again. We also never retry 4xx (401 bad key, 400 bad request) — those are ours.
const RETRYABLE_STATUS = new Set([502, 503, 504]);

function isTransientNetErr(e) {
  const m = String(e?.message || e || '');
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|fetch failed|forcibly closed|wsarecv/i.test(m);
}

// makeInit() must return a FRESH fetch init each call — an AbortSignal.timeout()
// signal is single-use and can't be shared across attempts. Returns the ok Response.
async function fetchOkWithRetry(url, makeInit, { tries = 2, backoffMs = 800, label = 'backend' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, makeInit());
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      const err = new Error(`${label} request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
      err.status = res.status;
      err.retryable = RETRYABLE_STATUS.has(res.status);
      throw err;
    } catch (e) {
      lastErr = e;
      // HTTP errors carry an explicit .retryable; network errors decide by message.
      const retryable = (typeof e?.retryable === 'boolean') ? e.retryable : isTransientNetErr(e);
      if (!retryable || attempt === tries) throw e;
      await new Promise(r => setTimeout(r, backoffMs * attempt));
    }
  }
  throw lastErr;
}

export async function callLLM(messages, systemPrompt, timeoutMs = 90000, opts = {}) {
  // ── Engine seam (BYO Claude) ──
  // A tenant that brought an Anthropic key (or the platform key) runs on Claude;
  // everyone else stays on the house model below. The tenant is taken from an
  // explicit opts.tenant or the ambient engine scope set by the interactive entry
  // points (runTool / chat dispatch / dashboard). A failed Claude call degrades
  // to house rather than surfacing an error — a flaky key never breaks a surface.
  const scope = currentEngineScope();
  const tenant = opts.tenant ?? scope.tenant;
  const chosen = resolveEngine({ tenant, engine: opts.engine ?? scope.engine, model: opts.model ?? scope.model });
  // Optional sampling knobs, honored by both engines. Callers that want a warmer,
  // more creative voice (e.g. the support concierge) pass temperature/maxTokens;
  // omitted → each backend's own default.
  const temperature = (typeof opts.temperature === 'number') ? opts.temperature : undefined;
  const maxTokens = (typeof opts.maxTokens === 'number') ? opts.maxTokens : undefined;
  if (chosen.engine === 'anthropic') {
    try {
      return await callAnthropic(messages, systemPrompt, {
        apiKey: chosen.apiKey, model: chosen.model, timeoutMs, temperature, maxTokens,
        onUsage: (u) => { recordTokenUsage({ tenant, model: u.model, engine: 'anthropic', usage: u.usage }); },
      });
    } catch (e) {
      console.error('[engine] Anthropic call failed — falling back to house:', e?.message || e);
    }
  }

  // ── House engine (Ollama) ──
  const res = await fetchOkWithRetry(OLLAMA_URL, () => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: false,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  }), { label: 'LLM' });
  const data = await res.json();
  // Capture house token usage when the OpenAI-compatible backend reports it
  // (Ollama includes a `usage` block on many builds); silently skipped if absent.
  if (data.usage) recordTokenUsage({ tenant, model: MODEL, engine: 'house', usage: data.usage });
  // Always strip the model's <think> reasoning block — no caller wants it.
  return stripThink(data.choices?.[0]?.message?.content || '');
}

// ── Vision (multimodal) LLM ───────────────────────────────────────────────────
// Ollama exposes small vision models on the same OpenAI-compatible endpoint.
// minicpm-v gives the cleanest captions; moondream (1B) is the lightweight
// fallback when the bigger model OOMs. llava:7b is intentionally NOT used — it
// crashes the runner on this host's memory budget.
export const VISION_MODEL = config.OLLAMA_VISION_MODEL || 'minicpm-v:latest';
const VISION_FALLBACK = 'moondream:latest';

// imageInput may be a Buffer, a data: URL, or an http(s) URL (fetched + inlined).
// Instructions go in the user text (small vision models handle system prompts
// inconsistently). Tries the primary model, then the fallback, before throwing.
export async function callVisionLLM(imageInput, prompt, timeoutMs = 120000) {
  let dataUrl;
  if (Buffer.isBuffer(imageInput)) {
    dataUrl = `data:image/png;base64,${imageInput.toString('base64')}`;
  } else if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
    dataUrl = imageInput;
  } else if (typeof imageInput === 'string') {
    const r = await fetch(imageInput, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`image fetch ${r.status}`);
    const ct = r.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await r.arrayBuffer());
    dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
  } else {
    throw new Error('callVisionLLM: unsupported image input');
  }

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  }];

  let lastErr;
  for (const model of [VISION_MODEL, VISION_FALLBACK]) {
    try {
      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_KEY}` },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) { lastErr = new Error(`vision ${model}: ${(await res.text()).slice(0, 160)}`); continue; }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) return content;
      lastErr = new Error(`vision ${model}: empty response`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('vision call failed');
}

// ── Stable Diffusion image generation (matches madladslab pattern) ────────────

const SD_SIZE_MAP = {
  'ig-post':     '512x512',
  'ig-story':    '384x640',
  'ig-portrait': '384x512',
  'fb-post':     '640x384',
  'fb-cover':    '640x256',
  'twitter':     '640x384',
  'pinterest':   '384x576',
  'yt-thumb':    '640x384',
  'linkedin':    '640x384',
};

export async function generateSdImage(prompt, negativePrompt, sizePreset) {
  const size = SD_SIZE_MAP[sizePreset] || sizePreset || '512x512';
  const payload = {
    prompt,
    size,
    n: 1,
    num_inference_steps: 25,
    guidance_scale: 7.5,
  };
  if (negativePrompt) payload.negative_prompt = negativePrompt;

  // Retry a transient LB 502/503/504 or dropped socket once (see fetchOkWithRetry).
  // A genuine 90s timeout is NOT retried — one SD generation already ate the budget.
  const res = await fetchOkWithRetry(SD_URL, () => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_KEY}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
  }), { label: 'Stable Diffusion' });

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('Stable Diffusion returned no image data');

  return Buffer.from(b64, 'base64');
}

// ── Shared brand-aware SD prompt builder ──────────────────────────────────────
// Single source of truth used by both the direct /generate-bg button and the
// asset agent's social-image flow. Takes an optional user seed phrase + the
// tenant's full brand context and produces a Stable Diffusion prompt flavored
// by palette, voice, and industry. Falls back to raw seed on LLM failure.
export async function buildBrandedSdPrompt(seed, brandContext, opts = {}) {
  const seedClean = (seed || '').trim();
  const sizePreset = opts.sizePreset || 'ig-post';

  // Quality/safety negatives we ALWAYS enforce regardless of seed.
  const safetyNeg = 'text, words, letters, numbers, watermark, signature, logo, blurry, low quality, deformed, ugly, jpeg artifacts';
  // Extra abstraction guards — ONLY when there's no seed. With no user input SD
  // v1.5 loves turning vague "cozy / studio / modern" into furnished rooms, so
  // we bar furniture/interiors/people to keep a clean abstract backdrop. When
  // the user DID type a seed we must NOT bar their subject — that was the bug
  // that made every prompt collapse into a generic gradient.
  const abstractNeg = ', furniture, bed, couch, sofa, chair, table, lamp, pillow, cushion, rug, '
    + 'room, interior, bedroom, living room, indoor scene, house, building, '
    + 'people, person, human, face, hands, body, product, object, photograph';
  const baseNeg = seedClean ? safetyNeg : (safetyNeg + abstractNeg);

  // No seed → force a pure abstract backdrop. Seed present → honour the subject
  // as a tasteful, background-friendly scene (room for text), not a gradient.
  const ABSTRACT_PREFIX = seedClean
    ? 'professional marketing background'
    : 'abstract non-representational background, texture and gradient only, no objects, no furniture, no people';

  // Merge in safety negatives, but NEVER let the user's own seed words (or whole
  // phrase) leak into the negative — that would tell SD to avoid what they asked for.
  const seedWords = new Set(seedClean.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
  const seedLower = seedClean.toLowerCase();
  const mergeNeg = (n) => {
    const extra = String(n || '').split(',').map(s => s.trim()).filter(Boolean);
    const have = new Set(baseNeg.split(',').map(s => s.trim().toLowerCase()));
    const merged = baseNeg + extra
      .filter(e => !have.has(e.toLowerCase()))
      .filter(e => {
        const el = e.toLowerCase();
        if (seedLower && el === seedLower) return false;
        for (const w of seedWords) { if (el.includes(w)) return false; }
        return true;
      })
      .map(e => ', ' + e).join('');
    return merged;
  };

  const seedLine = seedClean
    ? `User seed phrase: "${seedClean}"`
    : 'No user seed — generate a background purely from the brand identity above.';

  const sys = `You translate a brand profile (and optional user seed) into ONE Stable Diffusion v1.5 prompt for a marketing-image BACKGROUND layer.
${brandContext ? '\n' + brandContext + '\n' : ''}
Output ONLY raw JSON, no prose, no fences:
{"fill": {"prompt": "...", "negative": "..."}}

Rules:
- The image is a BACKDROP behind marketing copy: keep the composition open and uncluttered with calm focal areas, but you MAY depict scenery, atmosphere, landscapes, skies, abstract forms and textures.
- If a USER SEED is given, HONOR IT: the seed's subject/scene MUST be the central idea of the prompt. Render it as a tasteful, slightly soft background interpretation (depth of field, room for overlaid text) — never erase it into a plain gradient, and never render it as a busy foreground product shot.
- If NO seed is given, produce a purely abstract non-representational backdrop: texture, gradient, light and mood only — no objects, people, or rooms.
- Pull palette HEX values from the brand context above into the prompt as named hues (e.g. "navy and gold palette", "warm ivory tones").
- Match the brand voice (luxurious / playful / industrial / minimalist / etc.) in atmosphere words.
- The "negative" field is ONLY for quality defects (blur, watermark, text, lowres) and unwanted faces. NEVER put the user's seed, its subject, or its synonyms in the negative.
- Size preset: ${sizePreset} — pick imagery that crops well at that aspect.
- Keep "prompt" under 60 words and start it with: "${ABSTRACT_PREFIX}".
- "negative" must include at least: ${safetyNeg}.`;

  try {
    const raw = await callLLM([{ role: 'user', content: seedLine }], sys, 30000);
    const parsed = tryParseAgentResponse(raw);
    const out = parsed?.fill || {};
    if (typeof out.prompt === 'string' && out.prompt.trim()) {
      let prompt = out.prompt.trim();
      if (!new RegExp('^' + ABSTRACT_PREFIX.split(',')[0], 'i').test(prompt)) prompt = ABSTRACT_PREFIX + ', ' + prompt;
      return {
        prompt,
        negative: mergeNeg(out.negative),
        source: 'enriched',
      };
    }
  } catch (e) {
    console.warn('[buildBrandedSdPrompt] enrich failed:', e.message);
  }

  return {
    prompt: seedClean
      ? `${ABSTRACT_PREFIX}, ${seedClean}, soft depth of field, room for text, on-brand palette`
      : `${ABSTRACT_PREFIX}, elegant flowing texture, professional brand mood`,
    negative: baseNeg,
    source: seedClean ? 'raw' : 'fallback',
  };
}

// ── Training-candidate capture ────────────────────────────────────────────────
// Records every SD generation that survives upload, so we can build a curated
// fine-tune dataset later. Writes to the slab master DB (platform-wide pool).
// Never throws — failure here must not break the user-facing image flow.
export async function recordTrainingCandidate(meta) {
  try {
    const slab = getSlabDb();
    await slab.collection('training_candidates').insertOne({
      prompt: meta.prompt,
      negativePrompt: meta.negativePrompt || null,
      sizePreset: meta.sizePreset || null,
      size: meta.size || null,
      bucketKey: meta.bucketKey,
      publicUrl: meta.publicUrl,
      byteSize: meta.byteSize || null,
      source: meta.source || 'unknown',
      tenant: meta.tenant || null,
      userEmail: meta.userEmail || null,
      model: 'runwayml/stable-diffusion-v1-5',
      createdAt: new Date(),
      curated: false,
      caption: null,
      rating: null,
      notes: null,
    });
  } catch (e) {
    console.warn('[training-candidate] insert failed:', e.message);
  }
}

// Some LLMs (qwen2.5 in particular) return HTML with entity-escaped tags (&lt;p&gt;...).
// Detect that pattern and decode so the editor renders real HTML, not literal angle brackets.
function decodeIfEntityEscapedHtml(s) {
  if (typeof s !== 'string' || !s) return s;
  if (!/&lt;[a-zA-Z\/]/.test(s)) return s; // looks like normal text/HTML, leave alone
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // last to avoid double-decoding
}

function postProcessFill(fill) {
  if (!fill || typeof fill !== 'object') return fill;
  for (const key of ['content', 'body', 'html']) {
    if (typeof fill[key] === 'string') fill[key] = decodeIfEntityEscapedHtml(fill[key]);
  }
  return fill;
}

// Extract a sentinel-tagged block (e.g. <CONTENT>...</CONTENT>) so long-form
// HTML can travel OUTSIDE the JSON envelope and skip escape hell entirely.
// Returns { value, stripped } where `stripped` is the input with the block removed.
function extractSentinelBlock(raw, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = raw.match(re);
  if (!m) return { value: null, stripped: raw };
  return { value: m[1].trim(), stripped: raw.replace(re, '').trim() };
}

export function tryParseAgentResponse(raw) {
  // Pull long-form fields out of sentinel tags first — qwen2.5 can't reliably
  // JSON-escape 400+ words of HTML, but sentinel blocks just need a closing tag.
  let working = raw;
  const sentinels = {};
  for (const [tag, key] of [['CONTENT', 'content'], ['BODY', 'body'], ['HTML', 'html']]) {
    const { value, stripped } = extractSentinelBlock(working, tag);
    if (value !== null) {
      sentinels[key] = value;
      working = stripped;
    }
  }

  const cleaned = working.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  const merge = (parsed) => {
    if (!parsed.fill || typeof parsed.fill !== 'object') parsed.fill = {};
    // Sentinel always wins — a sentinel-delivered field is by definition more
    // reliable than the JSON copy, which may be truncated or broken.
    for (const [key, val] of Object.entries(sentinels)) parsed.fill[key] = val;
    parsed.fill = postProcessFill(parsed.fill);
    return parsed;
  };

  try {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (p.fill && typeof p.fill === 'object') return merge(p);
    }
  } catch { /* fall through */ }

  try {
    const fixed = cleaned.replace(/("(?:[^"\\]|\\.)*")/g, s => s.replace(/\n/g, '\\n').replace(/\r/g, ''));
    const m = fixed.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (p.fill && typeof p.fill === 'object') return merge(p);
    }
  } catch { /* fall through */ }

  const fill = {};
  // Each field has a double-quote variant AND a single-quote variant — qwen2.5
  // sometimes wraps long HTML values in single quotes, which is not valid JSON.
  const fieldRe = {
    title:    [/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/,           /"title"\s*:\s*'((?:[^'\\]|\\.)*)'/],
    excerpt:  [/"excerpt"\s*:\s*"((?:[^"\\]|\\.)*)"/,         /"excerpt"\s*:\s*'((?:[^'\\]|\\.)*)'/],
    category: [/"category"\s*:\s*"((?:[^"\\]|\\.)*)"/,        /"category"\s*:\s*'((?:[^'\\]|\\.)*)'/],
    tags:     [/"tags"\s*:\s*"((?:[^"\\]|\\.)*)"/,            /"tags"\s*:\s*'((?:[^'\\]|\\.)*)'/],
    content:  [/"content"\s*:\s*"([\s\S]*?)(?<!\\)"\s*[,}]/,  /"content"\s*:\s*'([\s\S]*?)(?<!\\)'\s*[,}]/],
  };
  for (const [key, regexes] of Object.entries(fieldRe)) {
    // Skip content if we already pulled it from a sentinel block
    if (sentinels[key]) continue;
    for (const re of regexes) {
      const m = cleaned.match(re);
      if (m) {
        fill[key] = m[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '\\');
        break;
      }
    }
  }

  const msgMatch = cleaned.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/) ||
                   cleaned.match(/"message"\s*:\s*'((?:[^'\\]|\\.)*)'/);
  const haveAny = Object.keys(fill).length || Object.keys(sentinels).length;
  const message = msgMatch ? msgMatch[1] : (haveAny ? 'Fields filled.' : cleaned.slice(0, 200));
  return merge({ message, fill });
}

// ── MCP Tool Definitions (follows MCP spec schema) ───────────────────────────

export const MCP_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web for current information about a topic.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  // fetch_url removed — agents should not probe arbitrary URLs
  {
    name: 'fill_site_copy',
    description: 'Generate marketing copy for the business website sections (hero, services, about, contact).',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What copy to write or update' },
        section: { type: 'string', description: 'Target: hero, services, about, contact, or all' },
        context: { type: 'string', description: 'Extra context or research notes' },
      },
      required: ['task'],
    },
  },
  {
    name: 'write_blog_post',
    description: 'Write a complete blog post for the business with title, excerpt, HTML content, category, and tags.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Blog post topic or title idea' },
        context: { type: 'string', description: 'Research, notes, or guidance' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'fill_section',
    description: 'Generate content for a custom website section (text, split, cta, cards, or faq template).',
    inputSchema: {
      type: 'object',
      properties: {
        section_type: { type: 'string', description: 'Template: text, split, cta, cards, or faq' },
        task: { type: 'string', description: 'What content to create' },
        context: { type: 'string', description: 'Extra context or research' },
      },
      required: ['section_type', 'task'],
    },
  },
  {
    name: 'write_page',
    description: 'Create or write content for a custom website page. Supports content pages (HTML), landing pages (block layout), and data-list pages.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title' },
        page_type: { type: 'string', description: 'content, landing, or data-list' },
        task: { type: 'string', description: 'What the page should contain or accomplish' },
        context: { type: 'string', description: 'Extra context or research notes' },
      },
      required: ['title', 'task'],
    },
  },
  {
    name: 'generate_social_image',
    description: 'Design and generate a social media image (Instagram, Facebook, Twitter, etc.) with text, shapes, and brand colors. Renders server-side and saves to asset library.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the image should convey — message, purpose, style' },
        size: { type: 'string', description: 'Size preset: ig-post, ig-story, fb-post, fb-cover, twitter, pinterest, yt-thumb, linkedin, ig-portrait' },
        folder: { type: 'string', description: 'Asset folder to save into' },
        clientId: { type: 'string', description: 'Optional client ID to attach the asset to' },
        context: { type: 'string', description: 'Extra context or research' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'update_theme',
    description: 'Update the website color palette — primary shades, accent, and background colors.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What color/palette change to make' },
        context: { type: 'string', description: 'Extra context, current settings, or research notes' },
      },
      required: ['task'],
    },
  },
  {
    name: 'update_typography',
    description: 'Set the website heading and body fonts from the approved font list.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What font/typography change to make' },
        context: { type: 'string', description: 'Extra context or research notes' },
      },
      required: ['task'],
    },
  },
  {
    name: 'set_section_visibility',
    description: 'Show or hide individual homepage sections (hero, services, portfolio, about, process, reviews, contact, blog).',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Which sections to show or hide' },
        context: { type: 'string', description: 'Extra context' },
      },
      required: ['task'],
    },
  },
  {
    name: 'update_design',
    description: 'Set website layout options — portfolio/blog layout style and logo display (text/image/both).',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What layout or logo-display change to make' },
        context: { type: 'string', description: 'Extra context, current settings, or research notes' },
      },
      required: ['task'],
    },
  },
  {
    name: 'manage_assets',
    description: 'Browse and search digital assets (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: list or search' },
        query: { type: 'string', description: 'Search query or folder name' },
        context: { type: 'string', description: 'Extra context' },
      },
      required: ['action'],
    },
  },
  {
    name: 'write_campaign',
    description: 'Draft an email marketing campaign with subject line, preheader, and HTML body for the business subscribers.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Campaign goal — topic, audience segment, or promotion to announce' },
        context: { type: 'string', description: 'Extra context or research notes' },
      },
      required: ['task'],
    },
  },
  {
    name: 'draft_invoice',
    description: 'Draft an invoice with title, line items, and notes for a client.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What the invoice is for — service, project, or deliverables' },
        context: { type: 'string', description: 'Extra context like client name, pricing, scope' },
      },
      required: ['task'],
    },
  },
  {
    name: 'draft_client_email',
    description: 'Draft a professional email to send to a client — project updates, follow-ups, onboarding, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Purpose of the email — update, follow-up, proposal, kickoff, etc.' },
        context: { type: 'string', description: 'Extra context like client name, project details' },
      },
      required: ['task'],
    },
  },
  {
    name: 'research_client',
    description: 'Research a prospective or existing client — web-search their business, fetch their website, produce an onboarding knowledge base (business type, strengths, opportunities, competitors, suggested services).',
    inputSchema: {
      type: 'object',
      properties: {
        clientName: { type: 'string', description: 'Person or contact name' },
        company:    { type: 'string', description: 'Company name' },
        website:    { type: 'string', description: 'Company website URL (optional)' },
        email:      { type: 'string', description: 'Client email (optional)' },
        notes:      { type: 'string', description: 'Any pre-existing notes' },
        prompt:     { type: 'string', description: 'Specific research focus' },
      },
      required: [],
    },
  },
  {
    name: 'analyze_metrics',
    description: 'Read a JSON metrics payload (counts, alerts, email/invoice/content stats) and produce a short business analyst report — top wins, concerns, and recommended next actions.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'User question or focus area' },
        metrics:  { type: 'object', description: 'Pre-aggregated metrics payload from /admin/analytics/metrics' },
        range:    { type: 'string', description: 'day | week | month' },
      },
      required: ['metrics'],
    },
  },
  {
    name: 'suggest_onboarding_fields',
    description: 'Suggest fields for a client/lead onboarding form. Returns form name, description, and a list of fields with key, label, type, options, section.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt:    { type: 'string', description: 'What kind of onboarding form to build' },
        existing:  { type: 'string', description: 'Comma-separated list of existing field labels to avoid duplicating' },
        formName:  { type: 'string', description: 'Current form title, if any' },
        formDesc:  { type: 'string', description: 'Current form description, if any' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'write_social_post',
    description: 'Draft an on-brand social media post (body under 280 chars, optional link, hashtags) for one or more platforms. Returns a draft for review — never publishes.',
    inputSchema: {
      type: 'object',
      properties: {
        task:      { type: 'string', description: 'What the post should say or promote' },
        platforms: { type: 'string', description: 'Comma-separated target platforms (facebook, instagram, threads, x, linkedin) — optional' },
        context:   { type: 'string', description: 'Extra context or research notes' },
      },
      required: ['task'],
    },
  },
  {
    name: 'write_print_copy',
    description: 'Draft print-marketing copy (headline, subhead, body, offer, CTA, tagline) for a print campaign — cards, flyers, posters, stickers. Returns a draft material for review.',
    inputSchema: {
      type: 'object',
      properties: {
        task:    { type: 'string', description: 'What the print piece is for — promotion, event, announcement' },
        context: { type: 'string', description: 'Extra context or research notes' },
      },
      required: ['task'],
    },
  },
  // ── Social package (stateful — tenant-scoped) ──────────────────────────────
  {
    name: 'generate_social_batch',
    description: 'Generate a batch of on-brand social posts (copy + platform-sized image) for the connected accounts. Review-first by default; set mode=publish to post live. Creates review drafts in Agent Studio.',
    inputSchema: { type: 'object', properties: {
      topic: { type: 'string', description: 'What the batch should be about (optional — steers the copy)' },
      count: { type: 'number', description: 'How many posts (1-10, default 3)' },
      mode: { type: 'string', description: "'suggest' (review-first, default) or 'publish' (live)" },
      platforms: { type: 'string', description: 'Comma-separated platform keys — optional, blank = all connected' },
    }, required: [] },
  },
  {
    name: 'build_seamless_carousel',
    description: 'Build a seamless (panorama) Instagram/Threads carousel about a topic — a wide background sliced into N tiles, each with an AI headline. Creates a review draft.',
    inputSchema: { type: 'object', properties: {
      topic: { type: 'string', description: 'What the carousel is about' },
      count: { type: 'number', description: 'Slides (2-10, default 4)' },
    }, required: ['topic'] },
  },
  {
    name: 'build_story_sequence',
    description: 'Build a vertical Instagram story sequence (hook → body → CTA) about a topic. Creates a review draft.',
    inputSchema: { type: 'object', properties: {
      topic: { type: 'string', description: 'What the story is about' },
      count: { type: 'number', description: 'Frames (2-8, default 4)' },
    }, required: ['topic'] },
  },
  {
    name: 'generate_spotlight_post',
    description: 'Draft a spotlight/quote social post (owner, mission, or customer quote). Creates a review draft.',
    inputSchema: { type: 'object', properties: {
      subject: { type: 'string', description: 'Who/what is spotlighted' },
      kind: { type: 'string', description: 'owner | mission | customer (optional)' },
      role: { type: 'string', description: "The subject's role (optional)" },
      quote: { type: 'string', description: 'A quote to feature (optional)' },
    }, required: ['subject'] },
  },
  {
    name: 'score_live_posts',
    description: 'Fetch real engagement for recently-published posts and score them, building the decision-reliability dataset. Returns how many were scored and the current reliability %.',
    inputSchema: { type: 'object', properties: {
      minAgeDays: { type: 'number', description: 'Only score posts older than this many days (default 2)' },
    }, required: [] },
  },
  {
    name: 'get_social_reliability',
    description: 'Get the current statistical reliability % (from scored live posts) and which design signals are winning (font/align/aspect/style with lift vs. average).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_social_insights',
    description: 'Get live social analytics from connected accounts (followers, reach, impressions, engagements) for the given window.',
    inputSchema: { type: 'object', properties: {
      days: { type: 'number', description: 'Window in days (default 30)' },
    }, required: [] },
  },
  {
    name: 'get_autopilot_config',
    description: "Read the tenant's Autopilot configuration (enabled, cadence, mode, channels, standing direction, asset tags).",
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'set_autopilot_config',
    description: 'Update Autopilot settings. Only the fields you pass change. Review-first unless autoPublish is set.',
    inputSchema: { type: 'object', properties: {
      enabled: { type: 'boolean' }, cadence: { type: 'string', description: 'off | daily | 3x_week | weekly' },
      count: { type: 'number' }, autoPublish: { type: 'boolean' }, autoSlot: { type: 'boolean' },
      standingPrompt: { type: 'string' }, channels: { type: 'string', description: 'comma-separated platform keys' },
      assetTags: { type: 'string', description: 'comma-separated asset tags for backgrounds' },
    }, required: [] },
  },
];

// ── Tool Handlers ─────────────────────────────────────────────────────────────

async function handleFillSiteCopy({ task, section, context, brandContext }) {
  const searchResults = await webSearch(task.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are a marketing copywriter for the business.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing what you wrote",
  "fill": {
    "hero_eyebrow": "...",
    "hero_heading": "...",
    "hero_heading_em": "...",
    "hero_sub": "...",
    "hero_badge": "...",
    "services_label": "...",
    "services_heading": "...",
    "services_heading_em": "...",
    "services_sub": "...",
    "service1_title": "...", "service1_desc": "...", "service1_link": "/page-slug or URL",
    "service2_title": "...", "service2_desc": "...", "service2_link": "/page-slug or URL",
    "service3_title": "...", "service3_desc": "...", "service3_link": "/page-slug or URL",
    "about_quote": "...",
    "about_desc": "...",
    "about_sig": "",
    "contact_sub": "...",
    "contact_location": "the business location from brand context",
    "contact_serving": "the service area from brand context"
  }
}

Only include fields that are relevant to the task — omit unchanged ones.
Target section: ${section || 'relevant sections for the task'}
Tailor tone and content to the business and audience described above.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleWriteBlogPost({ topic, context, brandContext }) {
  const searchResults = await webSearch(topic.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are a blog writing assistant for the business.
${brand}
Your output MUST follow this two-part shape — a JSON line first, then the HTML content inside <CONTENT>…</CONTENT> sentinel tags. Nothing else.

EXAMPLE OUTPUT (follow exactly):
{"message":"Wrote a post on social media tips","fill":{"title":"Five Social Media Tips","excerpt":"Practical tactics.","category":"Marketing","tags":"social media, small business"}}
<CONTENT>
<h2>Heading</h2>
<p>Paragraph with <strong>bold</strong> and a normal " quote — no escaping needed inside this block.</p>
<ul><li>Tip one</li><li>Tip two</li></ul>
<p>Closing call to action mentioning the business by name.</p>
</CONTENT>

RULES:
- JSON object on ONE LINE with title, excerpt, category, tags (do NOT include "content" in the JSON — it lives in the sentinel block).
- Inside <CONTENT>, write 400-800 words of raw HTML — no JSON escaping, real newlines and " quotes are fine.
- Use <h2>, <p>, <strong>, <ul>, <li> tags.
- End the HTML with a soft CTA mentioning the business by name.

Tailor content to the business and audience above. Tone: practical, approachable.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: `Write a blog post about: ${topic}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

const SECTION_FIELDS = {
  text:  ['heading', 'subheading', 'body'],
  split: ['heading', 'body', 'cta_text', 'cta_link'],
  cta:   ['heading', 'subtext', 'btn_text', 'btn_link'],
  cards: ['heading', 'subtext', 'card1_title', 'card1_body', 'card2_title', 'card2_body', 'card3_title', 'card3_body', 'card4_title', 'card4_body'],
  faq:   ['heading', 'q1', 'a1', 'q2', 'a2', 'q3', 'a3', 'q4', 'a4', 'q5', 'a5'],
};

async function handleFillSection({ section_type, task, context, brandContext }) {
  const searchResults = await webSearch(task.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const fields = SECTION_FIELDS[section_type] || SECTION_FIELDS.text;
  const fillShape = fields.map(f => `    "${f}": "..."`).join(',\n');

  const systemPrompt = `You are a web content writer for the business.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing what you created",
  "fill": {
${fillShape}
  }
}

Section type: ${section_type}. Tailor tone and content to the business and audience described above.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleWritePage({ title, page_type, task, context, brandContext }) {
  const searchResults = await webSearch((title + ' ' + task).slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';
  const ptype = page_type || 'content';

  let systemPrompt;
  if (ptype === 'landing') {
    systemPrompt = `You are a landing page builder for the business.
${brand}
Output ONLY raw JSON. Shape:
{
  "message": "one sentence describing the page",
  "fill": { "title": "...", "metaTitle": "...", "metaDescription": "..." },
  "suggestedBlocks": [
    { "type": "hero",  "fields": { "heading": "...", "subheading": "...", "cta_text": "...", "cta_link": "/#contact" } },
    { "type": "cards", "fields": { "heading": "...", "card1_title": "...", "card1_body": "...", "card2_title": "...", "card2_body": "...", "card3_title": "...", "card3_body": "..." } },
    { "type": "cta",   "fields": { "heading": "...", "btn_text": "...", "btn_link": "/#contact" } }
  ]
}
Block types: hero, text, split, cta, cards, faq. Design 3-5 blocks.
Page title: ${title}. Task: ${task}${contextNote}${researchCtx}`;
  } else {
    systemPrompt = `You are a web page content writer for the business.
${brand}
Output ONLY raw JSON. Shape:
{
  "message": "one sentence describing what you wrote",
  "fill": {
    "title": "${title}",
    "metaTitle": "SEO title",
    "metaDescription": "under 160 chars",
    "content": "full HTML as single escaped string"
  }
}
HTML rules: use <h2>, <p>, <strong>, <ul>, <li>. Escape quotes as \\". No literal newlines — use \\n.
Task: ${task}${contextNote}${researchCtx}`;
  }

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  const parsed = tryParseAgentResponse(raw);
  let suggestedBlocks = [];
  try {
    const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      const full = JSON.parse(m[0]);
      if (Array.isArray(full.suggestedBlocks)) suggestedBlocks = full.suggestedBlocks;
    }
  } catch {}
  return { ...parsed, suggestedBlocks };
}

async function handleGenerateSocialImage({ prompt, size, folder, clientId, context, brandContext }) {
  const searchResults = await webSearch(prompt.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';

  // Resolve actual canvas dimensions for the prompt so LLM doesn't have to guess
  const CANVAS_DIMS = {
    'ig-post': [1080, 1080], 'ig-story': [1080, 1920], 'fb-post': [1200, 630],
    'fb-cover': [1640, 624], 'twitter': [1600, 900], 'pinterest': [1000, 1500],
    'yt-thumb': [1280, 720], 'linkedin': [1200, 627], 'ig-portrait': [1080, 1350],
  };
  const chosenSize = size || 'ig-post';
  const [cW, cH] = CANVAS_DIMS[chosenSize] || CANVAS_DIMS['ig-post'];

  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are a social media graphic designer for the business.
${brand}
Output ONLY raw JSON — no prose, no markdown fences.

Canvas: ${cW} x ${cH} pixels (size preset: "${chosenSize}").

Output shape:
{
  "message": "one sentence",
  "fill": {
    "title": "short asset title",
    "size": "${chosenSize}",
    "bgColor": "primary brand color from context above",
    "sd_prompt": "REQUIRED — Stable Diffusion prompt describing the AI background atmosphere (textures, palette, mood)",
    "sd_negative_prompt": "text, words, letters, numbers, watermark, blurry, low quality, deformed",
    "layers": [ ... ]
  }
}

LAYER TYPES:
- rect: { "type":"rect", "x":N, "y":N, "w":N, "h":N, "fill":"#hex or rgba()", "opacity":1, "radius":0 }
- text: { "type":"text", "text":"...", "x":N, "y":N, "w":N, "h":N, "fontSize":N, "fontFamily":"sans-serif", "color":"#hex", "align":"center", "bold":true }
- circle: { "type":"circle", "x":N, "y":N, "w":N, "h":N, "fill":"#hex" }

POSITIONING — use these exact formulas (canvas is ${cW}x${cH}):
- Full-width overlay: x=0, y=0, w=${cW}, h=${cH}
- Center horizontal with padding: x=${Math.round(cW * 0.08)}, w=${Math.round(cW * 0.84)}
- Heading near top third: y=${Math.round(cH * 0.25)}
- Subheading below heading: y=${Math.round(cH * 0.45)}
- Bottom strip: x=0, y=${Math.round(cH * 0.78)}, w=${cW}, h=${Math.round(cH * 0.22)}
- CTA button: x=${Math.round(cW * 0.25)}, y=${Math.round(cH * 0.72)}, w=${Math.round(cW * 0.5)}, h=${Math.round(cH * 0.08)}, radius=8

EXAMPLE for ${cW}x${cH} — centered headline over readability scrim:
{
  "layers": [
    { "type":"rect", "x":0, "y":${Math.round(cH * 0.18)}, "w":${cW}, "h":${Math.round(cH * 0.64)}, "fill":"rgba(0,0,0,0.45)", "radius":0 },
    { "type":"text", "text":"YOUR HEADLINE", "x":${Math.round(cW * 0.08)}, "y":${Math.round(cH * 0.3)}, "w":${Math.round(cW * 0.84)}, "h":${Math.round(cH * 0.18)}, "fontSize":${Math.round(Math.min(cW, cH) * 0.085)}, "fontFamily":"serif", "color":"#FFFFFF", "align":"center", "bold":true },
    { "type":"text", "text":"Subtitle text here", "x":${Math.round(cW * 0.1)}, "y":${Math.round(cH * 0.52)}, "w":${Math.round(cW * 0.8)}, "h":${Math.round(cH * 0.1)}, "fontSize":${Math.round(Math.min(cW, cH) * 0.04)}, "fontFamily":"sans-serif", "color":"#F5F3EF", "align":"center", "bold":false }
  ]
}

CANVAS-FILL RULES (MANDATORY):
- ALWAYS include sd_prompt. It is REQUIRED — never null, never empty. The SD background fills the canvas; text layers sit on top.
- sd_prompt describes textures/atmosphere/palette only — never text, letters, logos, or brand names. Pull palette hex names from the brand context.
- ALWAYS include a semi-transparent scrim rect (rgba 0.35-0.6 alpha) at minimum 50% canvas height so text reads against the SD background.
- ALWAYS include a HEADLINE text layer occupying at least 70% of canvas width.
- Use 3-5 layers total: scrim rect → headline text → subtitle text → optional CTA/accent.
- Use the brand's color palette from the brand context above.
- Headline fontSize: ${Math.round(Math.min(cW, cH) * 0.07)}–${Math.round(Math.min(cW, cH) * 0.1)}. Subtitle: ${Math.round(Math.min(cW, cH) * 0.035)}–${Math.round(Math.min(cW, cH) * 0.05)}.
- All x/y/w/h values must be integers within the ${cW}x${cH} canvas.
${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: `Design a social media graphic: ${prompt}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

// ── Design tools (split from the old catch-all update_design) ────────────────
// The old single tool fanned FOUR unrelated concerns (palette, fonts, layout,
// section visibility) through one prompt, so a small model routinely emitted
// fields the user never asked to change — and the committer blind-upserts every
// non-empty field, silently mutating branding. Splitting into focused tools whose
// prompts ONLY know their own field group makes cross-group leakage impossible.
// All four still write to the same `design` collection (see executeDepartment).

async function handleUpdateTheme({ task, context, brandContext }) {
  const searchResults = await webSearch(`${task} website color palette`.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- DESIGN RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are a brand color specialist for the business.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the palette",
  "fill": {
    "color_primary": "#hex",
    "color_primary_deep": "#hex",
    "color_primary_mid": "#hex",
    "color_accent": "#hex",
    "color_accent_light": "#hex",
    "color_bg": "#hex"
  }
}

Only include color fields relevant to the task — omit unchanged ones.
Keep the palette cohesive: primary/deep/mid are shades of the same hue; accent contrasts; bg is light and neutral.
Do NOT output fonts, layouts, or section visibility — this tool ONLY sets colors.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleUpdateTypography({ task, context, brandContext }) {
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are a typography specialist for the business.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the font choices",
  "fill": {
    "font_heading": "font name",
    "font_body": "font name"
  }
}

Font options for headings: Cormorant Garamond, Playfair Display, Lora, Merriweather, Libre Baskerville.
Font options for body: Jost, Inter, Poppins, Raleway, Nunito, DM Sans.
Pick fonts that match the brand voice. Only include a field you are actually changing.
Do NOT output colors, layouts, or section visibility — this tool ONLY sets fonts.${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleSetSectionVisibility({ task, context, brandContext }) {
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You control which homepage sections are shown or hidden for the business.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing what you toggled",
  "fill": {
    "vis_hero": "true|false",
    "vis_services": "true|false",
    "vis_portfolio": "true|false",
    "vis_about": "true|false",
    "vis_process": "true|false",
    "vis_reviews": "true|false",
    "vis_contact": "true|false",
    "vis_blog": "true|false"
  }
}

Include ONLY the sections the task asks to change — omit every section the user did not mention.
Use the string "true" to show a section and "false" to hide it.
Do NOT output colors, fonts, or layouts — this tool ONLY toggles section visibility.${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleUpdateDesign({ task, context, brandContext }) {
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You set layout and logo-display options for the business website.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the layout changes",
  "fill": {
    "portfolio_layout": "grid|masonry|carousel|list",
    "blog_layout": "grid|list|masonry|featured",
    "nav_logo_display": "text|image|both"
  }
}

Only include fields relevant to the task — omit unchanged ones.
Do NOT output colors, fonts, or section visibility — those each have their own dedicated tool.${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleManageAssets({ action, query, context, brandContext }) {
  // Read-only: agents can only list or search assets
  const contextNote = context ? `\nContext: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';
  const systemPrompt = `You are an asset management assistant for the business.
${brand}
Interpret the user's request and output a structured action plan.

Output ONLY raw JSON — no prose, no fences. Shape:
{
  "message": "one sentence describing what you found",
  "fill": {
    "action": "list | search",
    "query": "search term if searching"
  }
}

Actions (read-only):
- list: list assets in a folder or all
- search: search by title/tags
${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: `Asset management request: ${action || query || 'list all'}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleWriteCampaign({ task, context, brandContext }) {
  const searchResults = await webSearch(task.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are an email marketing specialist for the business.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the campaign",
  "fill": {
    "subject": "compelling email subject line (under 60 chars)",
    "preheader": "preview text that appears after subject (under 100 chars)",
    "body": "full HTML email body with styled content",
    "targetFunnel": "all | lead | prospect | customer | churned"
  }
}

HTML body rules:
- Use inline styles for email compatibility
- Include a clear CTA button styled with the brand's accent color
- Support personalization tokens: {name}, {email}
- Keep copy concise (150-300 words)
- Open with personal greeting using {name}
- End with the brand's signature
- Tone: match the brand voice described above

Tailor content to the business and audience described above.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: `Draft email campaign: ${task}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleDraftInvoice({ task, context, brandContext }) {
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are an invoicing assistant for the business.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the invoice",
  "fill": {
    "title": "invoice title (e.g. Website Redesign - March 2026)",
    "lineItems": [
      { "description": "service or deliverable", "quantity": 1, "unitPrice": 500 }
    ],
    "notes": "optional payment terms or notes",
    "dueInDays": 30
  }
}

Rules:
- Use the pricing guide from the brand context above if available, otherwise use realistic pricing for the business type
- Include 2-5 line items that clearly describe deliverables
- Keep the title descriptive and professional
- Notes should mention payment terms if relevant${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: `Draft an invoice for: ${task}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleDraftClientEmail({ task, context, brandContext }) {
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are a client communications specialist for the business.
${brand}

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the email",
  "fill": {
    "subject": "clear professional subject line",
    "body": "full email body in HTML"
  }
}

HTML body rules:
- Use simple inline styles for clean formatting
- Professional but warm tone — The brand owner's name is in the brand context
- Sign off using the brand name
- Keep concise (100-250 words)
- Include next steps or a clear ask when appropriate${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: `Draft client email: ${task}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleWriteSocialPost({ task, platforms, context, brandContext }) {
  const searchResults = await webSearch(task.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';
  const targets = platforms ? `\n\nTarget platform(s): ${platforms}.` : '';

  const systemPrompt = `You write engaging social media posts for the business.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one short sentence describing the post you wrote",
  "fill": {
    "body": "the post text — punchy, on-brand, with relevant emoji and 2-4 hashtags",
    "link": "a URL to include, or empty string",
    "platforms": "comma-separated platform keys this fits best (facebook, instagram, threads, x, linkedin)"
  }
}

Rules:
- Keep "body" under 280 characters so it fits every platform (including X).
- Match the brand voice above. No markdown. Escape double quotes as \\".${targets}${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleWritePrintCopy({ task, context, brandContext }) {
  const searchResults = await webSearch(task.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are a print-marketing copywriter for the business, writing copy used across a whole print campaign (cards, flyers, posters, stickers).
${brand}
Write concise, punchy, print-ready copy. Headlines short; body tight. Match the brand voice.

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the campaign copy",
  "fill": {
    "name": "short internal name for this print campaign",
    "headline": "big punchy primary line (a few words)",
    "subhead": "short supporting line",
    "body": "one or two short sentences",
    "offer": "deal/promo badge e.g. \\"20% OFF\\", or empty string",
    "cta": "short call-to-action e.g. \\"Book Now\\"",
    "tagline": "brief brand tagline"
  }
}

Only include fields relevant to the task.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: `Write print campaign copy for: ${task}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

// ── Client Research Agent ────────────────────────────────────────────────────
export async function handleResearchClient({ clientName, company, website, notes, email, prompt, brandContext }) {
  // Step 1: Web search for the business
  const searchQuery = company
    ? `${company} ${clientName || ''} business`
    : `${clientName || 'unknown'} business`;
  const searchResults = await webSearch(searchQuery);

  // Step 2: Fetch their website if available
  let siteContent = '';
  if (website) {
    siteContent = await fetchUrl(website);
  }

  // Step 3: Single LLM call with all context injected
  const brand = brandContext ? `\n${brandContext}\n` : '';

  const systemPrompt = `You are a client research analyst for the business.
${brand}
You have been given information about a prospective or existing client. Analyze everything and produce a comprehensive onboarding knowledge base.

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence summary of findings",
  "fill": {
    "businessType": "type of business (e.g. Restaurant, Retail, SaaS, Professional Services)",
    "industry": "broader industry category",
    "summary": "2-3 paragraph overview of the client's business, what they do, their market position",
    "strengths": ["strength 1", "strength 2", "strength 3"],
    "opportunities": ["marketing opportunity 1", "opportunity 2", "opportunity 3"],
    "competitors": ["competitor 1", "competitor 2"],
    "suggestedServices": ["service the business should offer them", "another service"],
    "websiteNotes": "analysis of their current website — design quality, SEO basics, mobile-friendliness, content gaps. Say 'No website found' if none.",
    "socialPresence": "what social platforms they appear to be on based on search results",
    "brandVoice": "suggested brand voice/tone based on their business type",
    "goals": "suggested marketing goals based on their business type and current state",
    "onboardingNotes": "key things the team should know when onboarding this client"
  }
}

Rules:
- Be specific and actionable — generic advice is not useful
- If website content is available, analyze it in detail
- Tailor service suggestions to the business's capabilities as described in the brand context
- Be honest about gaps and opportunities
- Keep each field concise but substantive`;

  const userMessage = `Research this client for onboarding:

Name: ${clientName || 'Unknown'}
Company: ${company || 'Unknown'}
Email: ${email || 'N/A'}
Website: ${website || 'None provided'}
Notes: ${notes || 'None'}
${prompt ? `\nUser focus: ${prompt}\n` : ''}
--- WEB SEARCH RESULTS ---
${searchResults}

${siteContent ? `--- WEBSITE CONTENT ---\n${siteContent}` : ''}`;

  const raw = await callLLM([{ role: 'user', content: userMessage }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleAnalyzeMetrics({ question, metrics, range, brandContext }) {
  const brand = brandContext ? `\n${brandContext}\n` : '';
  const rangeLabel = range || 'recent period';
  const metricsJson = JSON.stringify(metrics || {}, null, 2).slice(0, 4000);

  const systemPrompt = `You are a business analyst for the brand described below.
${brand}
You are given a JSON payload of metrics for the ${rangeLabel}. Read the numbers and report on what the business should know.

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one-line headline summary",
  "fill": {
    "headline":     "single sentence — what's the big story this ${rangeLabel}?",
    "wins":         ["concrete win 1", "win 2", "win 3"],
    "concerns":     ["concrete concern 1", "concern 2"],
    "recommendations": ["next action 1", "next action 2", "next action 3"],
    "kpi_focus":    "name the single metric to push next"
  }
}

Rules:
- Be specific — reference the actual numbers from the metrics payload
- If a category has zero activity, mention it as a gap, not a win
- Recommendations must be doable in the admin panel (write a campaign, follow up overdue invoices, draft a blog post, etc.)
- Keep each list entry under 18 words`;

  const userMessage = `Question: ${question || 'Summarize how the business is doing'}\n\nMetrics payload:\n${metricsJson}`;
  const raw = await callLLM([{ role: 'user', content: userMessage }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleSuggestOnboardingFields({ prompt, existing, formName, formDesc, brandContext }) {
  const brand = brandContext ? `\n${brandContext}\n` : '';
  const existingLine = existing ? `\nExisting fields on this form: ${existing}` : '';
  const titleLine = formName ? `\nForm title: "${formName}"` : '';
  const descLine  = formDesc ? `\nForm description: "${formDesc}"` : '';

  const systemPrompt = `You are a form design assistant for a business onboarding platform.
${brand}
Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the suggested form",
  "fill": {
    "name": "Concise form title — empty string if existing title is fine",
    "description": "One-sentence description — empty string if existing is fine",
    "fields": [
      {
        "key": "field_key_snake_case",
        "label": "Human Readable Label",
        "type": "text|textarea|select|checkbox|radio|number|email|url|date|color|heading",
        "placeholder": "hint text",
        "helpText": "optional guidance",
        "required": true,
        "options": [{"label": "Option A", "value": "a"}],
        "width": "full|half",
        "section": "Section Name"
      }
    ]
  }
}

Rules:
- Field types: text, textarea, select, checkbox, radio, number, email, url, date, color, heading (section divider)
- Only include "options" for select/radio/checkbox types
- Generate 4-8 useful fields, tailored to the business and the user request
- Do NOT duplicate any existing fields${titleLine}${descLine}${existingLine}`;

  const raw = await callLLM([{ role: 'user', content: prompt || 'Suggest onboarding form fields for this business' }], systemPrompt);
  return tryParseAgentResponse(raw);
}

// ── Stateful social-package tools (need tenant + db via ctx) ─────────────────
// Thin wrappers over the existing social engine. Dynamic-imported to avoid the
// autoSocial ↔ agentMcp circular import at load time.
function _needTenant(ctx) {
  if (!ctx || !ctx.db || !ctx.tenant) throw new Error('This tool needs a tenant context — call it from the dashboard agent, not an unscoped MCP client.');
}
async function handleGenerateSocialBatch({ topic, count, mode, platforms }, ctx) {
  _needTenant(ctx);
  const { generateForTenant } = await import('./autoSocial.js');
  const out = await generateForTenant(ctx.tenant, ctx.db, {
    count: Math.max(1, Math.min(10, Number(count) || 3)),
    mode: mode === 'publish' ? 'publish' : 'suggest',
    direction: (topic || '').toString().slice(0, 400),
    platforms: platforms ? String(platforms).split(',').map(s => s.trim()).filter(Boolean) : null,
    createdBy: 'dashboard-agent',
  });
  return { message: `Generated ${out.created} post(s)${out.published ? `, published ${out.published}` : ' (review-first — check Agent Studio)'}.`, fill: { created: out.created, published: out.published || 0, mode: mode === 'publish' ? 'publish' : 'suggest' } };
}
async function handleBuildSeamlessCarousel({ topic, count }, ctx) {
  _needTenant(ctx);
  const auto = await import('./autoSocial.js');
  const sp = await import('./socialPublish.js');
  const capable = (await ctx.db.collection('social_accounts').find({}).toArray())
    .filter(a => a.enabled !== false && sp.isAccountConfigured(a) && sp.platformSupportsFormat(a.platform, 'carousel')).map(a => a.platform);
  if (!capable.length) return { message: 'No Instagram/Threads account connected — carousels need one.', fill: {} };
  const out = await auto.generateSeamlessCarousel(ctx.tenant, ctx.db, { count: Math.max(2, Math.min(10, Number(count) || 4)), direction: topic || '' });
  const slides = out.slides || [];
  const doc = { body: slides[0]?.headline || 'Carousel', link: '', mediaUrls: [out.previewUrl], platforms: capable, format: 'carousel', status: 'draft', suggestion: true, source: 'dashboard-agent', kind: 'carousel', seamless: true, noText: false, slides, bgUrl: out.bgUrl || null, previewUrl: out.previewUrl, dims: `${slides.length} × 1080×1350 pano`, scheduledAt: null, publishedAt: null, results: [], createdBy: 'dashboard-agent', createdAt: new Date(), updatedAt: new Date() };
  const ins = await ctx.db.collection('social_posts').insertOne(doc);
  return { message: `Built a ${slides.length}-slide seamless carousel draft — review it in Agent Studio.`, fill: { postId: String(ins.insertedId), previewUrl: out.previewUrl, slides: slides.length } };
}
async function handleBuildStorySequence({ topic, count }, ctx) {
  _needTenant(ctx);
  const auto = await import('./autoSocial.js');
  const sp = await import('./socialPublish.js');
  const ig = await ctx.db.collection('social_accounts').findOne({ platform: 'instagram' });
  if (!ig || ig.enabled === false || !sp.isAccountConfigured(ig)) return { message: 'Connect an Instagram account — stories are IG-only.', fill: {} };
  const out = await auto.generateStoryFrames(ctx.tenant, ctx.db, { count: Math.max(2, Math.min(8, Number(count) || 4)), direction: topic || '' });
  const frames = out.frames || [];
  if (!frames.length) return { message: 'No frames were generated.', fill: {} };
  const doc = { body: frames[0].headline || 'Story', link: '', mediaUrls: frames.map(f => f.url), platforms: ['instagram'], format: 'story', status: 'draft', suggestion: true, source: 'dashboard-agent', kind: 'story', headline: frames[0].headline || '', subtitle: frames[0].subtitle || '', dims: `${frames.length} frames`, scheduledAt: null, publishedAt: null, results: [], createdBy: 'dashboard-agent', createdAt: new Date(), updatedAt: new Date() };
  const ins = await ctx.db.collection('social_posts').insertOne(doc);
  return { message: `Built a ${frames.length}-frame Instagram story draft — review it in Agent Studio.`, fill: { postId: String(ins.insertedId), frames: frames.length } };
}
async function handleGenerateSpotlightPost({ subject, kind, role, quote }, ctx) {
  _needTenant(ctx);
  const { generateSpotlight } = await import('./autoSocial.js');
  const out = await generateSpotlight(ctx.tenant, ctx.db, { subject, kind, role, quote, createdBy: 'dashboard-agent' });
  if (out.error) return { message: out.error, fill: {} };
  return { message: 'Spotlight draft created — review it in Agent Studio.', fill: out };
}
async function handleScoreLivePosts({ minAgeDays }, ctx) {
  _needTenant(ctx);
  const { scoreLivePosts, getReliability } = await import('./socialScore.js');
  const r = await scoreLivePosts(ctx.db, ctx.tenant, { minAgeDays: Number(minAgeDays) || 2 });
  const rel = await getReliability(ctx.db);
  return { message: `Scored ${r.scored} live post(s). Decision reliability now ${rel.reliability}% (${rel.scored} scored).`, fill: { scored: r.scored, reliability: rel.reliability, signals: rel.signals } };
}
async function handleGetSocialReliability(_args, ctx) {
  _needTenant(ctx);
  const { getReliability } = await import('./socialScore.js');
  const rel = await getReliability(ctx.db);
  const top = (rel.signals || []).slice(0, 5).map(s => `${s.key} ${s.lift >= 0 ? '+' : ''}${s.lift}%`).join(', ');
  return { message: `Reliability ${rel.reliability}% from ${rel.scored} scored posts.${top ? ' Winning: ' + top : ''}`, fill: rel };
}
async function handleGetSocialInsights({ days }, ctx) {
  _needTenant(ctx);
  const { buildSocialInsights } = await import('./socialInsights.js');
  const ins = await buildSocialInsights(ctx.db, { days: Number(days) || 30 });
  const t = ins.totals || {};
  return { message: `Followers ${t.followers || 0}, reach ${t.reach || 0}, impressions ${t.impressions || 0}, engagements ${t.engagements || 0} (last ${ins.days}d).`, fill: { totals: ins.totals, connected: ins.connected } };
}
async function handleGetAutopilotConfig(_args, ctx) {
  _needTenant(ctx);
  const a = ctx.tenant.autoSocial || {};
  return { message: a.enabled ? `Autopilot is ON (${a.cadence || 'off'}, ${a.count || 3}/run, ${a.autoPublish ? 'auto-publish' : a.autoSlot ? 'auto-slot' : 'review'}).` : 'Autopilot is OFF.', fill: { enabled: !!a.enabled, cadence: a.cadence || 'off', count: a.count || 3, channels: a.channels || [], standingPrompt: a.standingPrompt || '', autoPublish: !!a.autoPublish, autoSlot: !!a.autoSlot, assetTags: a.assetTags || [], promote: a.promote || [], leadGen: !!a.leadGen } };
}
async function handleSetAutopilotConfig(args, ctx) {
  _needTenant(ctx);
  const { getSlabDb } = await import('./mongo.js');
  const set = {};
  if (args.enabled !== undefined) set['autoSocial.enabled'] = !!args.enabled;
  if (args.autoPublish !== undefined) set['autoSocial.autoPublish'] = !!args.autoPublish;
  if (args.autoSlot !== undefined) set['autoSocial.autoSlot'] = !!args.autoSlot;
  if (args.count !== undefined) set['autoSocial.count'] = Math.max(1, Math.min(10, Number(args.count) || 3));
  if (args.cadence !== undefined && ['off', 'daily', '3x_week', 'weekly'].includes(args.cadence)) set['autoSocial.cadence'] = args.cadence;
  if (args.standingPrompt !== undefined) set['autoSocial.standingPrompt'] = String(args.standingPrompt).slice(0, 600);
  if (args.channels !== undefined) set['autoSocial.channels'] = Array.isArray(args.channels) ? args.channels.map(String) : String(args.channels || '').split(',').map(s => s.trim()).filter(Boolean);
  if (args.assetTags !== undefined) set['autoSocial.assetTags'] = Array.isArray(args.assetTags) ? args.assetTags : String(args.assetTags || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!Object.keys(set).length) return { message: 'No config changes provided.', fill: {} };
  set['autoSocial.updatedAt'] = new Date();
  await getSlabDb().collection('tenants').updateOne({ _id: ctx.tenant._id }, { $set: set });
  return { message: 'Autopilot config updated.', fill: { updated: Object.keys(set).filter(k => k !== 'autoSocial.updatedAt') } };
}

const TOOL_HANDLERS = {
  web_search:               ({ query }) => webSearch(query).then(r => ({ result: r })),
  generate_social_batch:    handleGenerateSocialBatch,
  build_seamless_carousel:  handleBuildSeamlessCarousel,
  build_story_sequence:     handleBuildStorySequence,
  generate_spotlight_post:  handleGenerateSpotlightPost,
  score_live_posts:         handleScoreLivePosts,
  get_social_reliability:   handleGetSocialReliability,
  get_social_insights:      handleGetSocialInsights,
  get_autopilot_config:     handleGetAutopilotConfig,
  set_autopilot_config:     handleSetAutopilotConfig,
  fill_site_copy:           handleFillSiteCopy,
  write_blog_post:          handleWriteBlogPost,
  fill_section:             handleFillSection,
  write_page:               handleWritePage,
  generate_social_image:    handleGenerateSocialImage,
  update_theme:             handleUpdateTheme,
  update_typography:        handleUpdateTypography,
  set_section_visibility:   handleSetSectionVisibility,
  update_design:            handleUpdateDesign,
  manage_assets:            handleManageAssets,
  write_campaign:           handleWriteCampaign,
  draft_invoice:            handleDraftInvoice,
  draft_client_email:       handleDraftClientEmail,
  write_social_post:        handleWriteSocialPost,
  write_print_copy:         handleWritePrintCopy,
  research_client:          handleResearchClient,
  suggest_onboarding_fields: handleSuggestOnboardingFields,
  analyze_metrics:          handleAnalyzeMetrics,
};

// ── Tool-usage telemetry ──────────────────────────────────────────────────────
// Every tool invocation funnels through runTool(), so ONE recorder here captures
// 100% of agent tool usage across all call paths (the dashboard /run-task + /
// routes, agentRouter.runDepartment, and the MCP JSON-RPC endpoint). Aggregated
// per (tool, tenant) into the slab master DB — the same platform-wide pool as
// training_candidates — so we can see, globally AND per-tenant, which tools users
// actually lean on. This is the substrate for right-sizing decisions and the
// per-agent success-rate scoring that builds on it.
// Telemetry MUST NEVER break a real tool call: every path here swallows errors.
let _usageIndexReady = false;
async function ensureUsageIndex(coll) {
  if (_usageIndexReady) return;
  try {
    await coll.createIndex({ tool: 1, tenantKey: 1 }, { unique: true });
    await coll.createIndex({ tool: 1 });
    _usageIndexReady = true;
  } catch { /* leave unready — retry on the next call */ }
}

// Stable per-tenant key: the tenant's DB name (human-readable, never changes).
// Falls back to s3Prefix / _id, or 'external' for unscoped MCP clients.
function _tenantKeyOf(tenant) {
  return tenant?.db || tenant?.s3Prefix || (tenant?._id ? String(tenant._id) : 'external');
}

// Fire-and-forget: never awaited in the hot path, never throws.
function recordToolUsage(tool, ctx, { ok, ms, errMsg }) {
  (async () => {
    try {
      const coll = getSlabDb().collection('mcp_tool_usage');
      await ensureUsageIndex(coll);
      const tenant = ctx?.tenant || null;
      const now = new Date();
      const set = {
        lastAt: now,
        tenantId: tenant?._id ? String(tenant._id) : null,
        tenantName: tenant?.brand?.name || null,
      };
      if (!ok) { set.lastError = errMsg ? String(errMsg).slice(0, 300) : 'error'; set.lastErrorAt = now; }
      const dur = Math.max(0, ms | 0);
      await coll.updateOne(
        { tool, tenantKey: _tenantKeyOf(tenant) },
        {
          $inc: { calls: 1, ok: ok ? 1 : 0, err: ok ? 0 : 1, totalMs: dur },
          $max: { maxMs: dur },
          $set: set,
          $setOnInsert: { firstAt: now },
        },
        { upsert: true },
      );
    } catch { /* best-effort — a metrics write must never surface to the user */ }
  })();
}

// Read the tool-usage scoreboard. Emits ONE row per tool in MCP_TOOLS (so a
// never-used tool shows as zero calls — that gap is itself a signal), enriched
// with counters. Pass tenantKey to scope to one tenant; omit for the global
// cross-tenant roll-up. Sorted most-used first.
export async function readToolUsage({ tenantKey = null } = {}) {
  const coll = getSlabDb().collection('mcp_tool_usage');
  const match = tenantKey ? { tenantKey } : {};
  let rows = [];
  try {
    rows = await coll.aggregate([
      { $match: match },
      { $group: {
        _id: '$tool',
        calls:   { $sum: '$calls' },
        ok:      { $sum: '$ok' },
        err:     { $sum: '$err' },
        totalMs: { $sum: '$totalMs' },
        maxMs:   { $max: '$maxMs' },
        lastAt:  { $max: '$lastAt' },
        tenants: { $addToSet: '$tenantKey' },
      } },
    ]).toArray();
  } catch { rows = []; }
  const byTool = new Map(rows.map(r => [r._id, r]));
  const out = MCP_TOOLS.map(t => {
    const r = byTool.get(t.name) || {};
    const calls = r.calls || 0;
    return {
      tool: t.name,
      description: t.description,
      calls,
      ok: r.ok || 0,
      err: r.err || 0,
      successPct: calls ? Math.round(((r.ok || 0) / calls) * 100) : null,
      avgMs: calls ? Math.round((r.totalMs || 0) / calls) : null,
      maxMs: r.maxMs || 0,
      tenantCount: tenantKey ? undefined : (r.tenants ? r.tenants.length : 0),
      lastAt: r.lastAt || null,
    };
  });
  out.sort((a, b) => b.calls - a.calls);
  return out;
}

// `ctx` = { db, tenant, brandContext } — carries tenant scope for stateful tools
// and injects brandContext for the stateless drafters when the caller (e.g. an
// external MCP client) didn't pass it, so MCP output is on-brand like the
// in-process path. Stateless handlers ignore the 2nd arg; stateful ones use it.
export async function runTool(name, args = {}, ctx = {}) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) throw new Error(`Unknown MCP tool: ${name}`);
  if (ctx.brandContext && args.brandContext == null) args = { ...args, brandContext: ctx.brandContext };
  const startedAt = Date.now();
  let ok = true, errMsg = null;
  try {
    // Run the handler inside an engine scope so any callLLM it makes routes by
    // this tenant's key (Claude) or the house model — no per-handler plumbing.
    return await engineALS.run({ tenant: ctx.tenant, engine: ctx.engine, model: ctx.model }, () => handler(args, ctx));
  } catch (e) {
    ok = false; errMsg = e?.message || String(e);
    throw e;
  } finally {
    recordToolUsage(name, ctx, { ok, ms: Date.now() - startedAt, errMsg });
  }
}

// ── MCP JSON-RPC Handler (MCP HTTP transport) ─────────────────────────────────

const MCP_SERVER_INFO = {
  name: 'slab-agents',
  version: '1.0.0',
};

const MCP_CAPABILITIES = {
  tools: {},
};

export async function handleMcpRequest(body, ctx = {}) {
  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== '2.0') return mcpError(id, -32600, 'Invalid JSON-RPC version');

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: MCP_CAPABILITIES,
        serverInfo: MCP_SERVER_INFO,
      },
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0', id,
      result: { tools: MCP_TOOLS },
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    if (!name) return mcpError(id, -32602, 'Missing tool name');
    try {
      const result = await runTool(name, args || {}, ctx);
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: false,
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: err.message }],
          isError: true,
        },
      };
    }
  }

  if (method === 'notifications/initialized') {
    return null; // no response for notifications
  }

  return mcpError(id, -32601, `Method not found: ${method}`);
}

function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
