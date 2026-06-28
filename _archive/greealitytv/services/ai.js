// AI service — Ollama chat + Stable Diffusion images via ollama.madladslab.com tunnel.
// All prompts here are tuned for greeality tv: civic-voice Greeley, CO blog.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = (process.env.OLLAMA_URL || 'https://ollama.madladslab.com').replace(/\/+$/, '');
const KEY = process.env.OLLAMA_KEY || '';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

const SITE_VOICE = `You are an editorial assistant for GreealityTV — a civic-voice blog for Greeley, Colorado. The audience cares about local politics, neighborhood news, development, schools, public safety, and lifting up community voices over big-money influence. Write in a clear, grounded, conversational tone that respects the reader's intelligence. Avoid corporate jargon and partisan rhetoric. Be specific to Greeley when relevant.`;

async function chat(messages, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 90000;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      signal: ctl.signal,
      body: JSON.stringify({
        model: opts.model || MODEL,
        messages,
        stream: false,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens ?? 1500
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`LLM timed out after ${timeoutMs / 1000}s (model may be cold — retry)`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function stripThink(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function safeJson(text, fallback) {
  const cleaned = stripThink(text);
  const match = cleaned.match(/```json\s*([\s\S]*?)```/) || cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  const raw = match ? match[1] || match[0] : cleaned;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ── Tools ──────────────────────────────────────────────────────────────────

async function writeDraft({ topic, angle, length = 'medium', tags = [] }) {
  const lengthHint = { short: '400-500', medium: '700-900', long: '1100-1400' }[length] || '700-900';
  const out = await chat([
    { role: 'system', content: SITE_VOICE },
    { role: 'user', content:
`Draft a blog article for GreealityTV.

Topic: ${topic}
${angle ? `Editorial angle: ${angle}` : ''}
${tags.length ? `Suggested tags: ${tags.join(', ')}` : ''}
Target length: ${lengthHint} words.

Return JSON with keys: title (string), excerpt (string, <=180 chars), body (string, HTML — use <p>, <h2>, <ul>, <strong>), tags (array of 3-6 strings).` }
  ], { max_tokens: 2500 });
  return safeJson(out, { title: '', excerpt: '', body: stripThink(out), tags });
}

async function suggestHeadlines({ topic, body, n = 6 }) {
  const out = await chat([
    { role: 'system', content: SITE_VOICE },
    { role: 'user', content:
`Generate ${n} sharp, scannable headlines for this article. Mix tones: factual, provocative, human-interest, civic-call.
Return JSON: { "headlines": ["...", ...] }

Topic: ${topic || '(infer from body)'}
Body excerpt:
${(body || '').slice(0, 1500)}` }
  ], { max_tokens: 600 });
  const parsed = safeJson(out, { headlines: [] });
  return parsed.headlines || [];
}

async function generateExcerpt({ body }) {
  const out = await chat([
    { role: 'system', content: SITE_VOICE },
    { role: 'user', content: `Write a 140-180 character excerpt that hooks the reader. Plain text only, no quotes.\n\n${(body || '').slice(0, 3000)}` }
  ], { max_tokens: 250 });
  return stripThink(out).replace(/^["']|["']$/g, '');
}

async function suggestTags({ title, body }) {
  const out = await chat([
    { role: 'system', content: SITE_VOICE },
    { role: 'user', content:
`Suggest 4-8 lowercase tags for this article. Mix broad civic tags (politics, schools, housing) with Greeley-specific (downtown, weld-county, etc.).
Return JSON: { "tags": ["tag1", ...] }

Title: ${title || ''}
Body excerpt: ${(body || '').slice(0, 1500)}` }
  ], { max_tokens: 300 });
  const parsed = safeJson(out, { tags: [] });
  return (parsed.tags || []).map(t => String(t).toLowerCase().trim());
}

async function generateSeo({ title, body }) {
  const out = await chat([
    { role: 'system', content: SITE_VOICE },
    { role: 'user', content:
`Generate SEO and social metadata for this article.
Return JSON:
{
  "seoTitle": "<=60 chars, includes 'Greeley' when natural",
  "metaDescription": "150-160 chars, action-oriented",
  "ogTitle": "social-friendly, <=70 chars",
  "ogDescription": "<=180 chars, conversational",
  "twitterText": "<=240 chars with 1-2 hashtags"
}

Title: ${title || ''}
Body excerpt: ${(body || '').slice(0, 2000)}` }
  ], { max_tokens: 600 });
  return safeJson(out, { seoTitle: title || '', metaDescription: '', ogTitle: title || '', ogDescription: '', twitterText: '' });
}

async function moderate({ type, payload }) {
  const out = await chat([
    { role: 'system', content: `You are a content moderator for a civic-voice community blog in Greeley, CO. Screen for: spam, advertising, harassment, hate speech, threats, doxxing, off-topic. Allow strong opinions and political criticism — they're part of civic discourse. Be conservative about rejection.` },
    { role: 'user', content:
`Screen this ${type} and return JSON:
{
  "verdict": "approve" | "review" | "reject",
  "confidence": 0.0-1.0,
  "reasons": ["short bullet", ...],
  "summary": "one-sentence rationale"
}

Content:
${JSON.stringify(payload).slice(0, 4000)}` }
  ], { max_tokens: 500, temperature: 0.2 });
  return safeJson(out, { verdict: 'review', confidence: 0, reasons: ['LLM parse failed'], summary: '' });
}

async function bloggerReport({ stats, topPosts, recentTitles, pendingCount }) {
  const out = await chat([
    { role: 'system', content: SITE_VOICE },
    { role: 'user', content:
`Write a weekly editorial briefing for the GreealityTV admin team. Use the data below.

Stats: ${JSON.stringify(stats)}
Top posts (by views): ${JSON.stringify(topPosts)}
Recent article titles: ${JSON.stringify(recentTitles)}
Pending items in queue: ${pendingCount}

Return JSON:
{
  "headline": "punchy one-liner about the week",
  "wins": ["...", "..."],
  "watch": ["concerns or quiet areas", "..."],
  "ideaPitches": [
    { "title": "next-article idea", "angle": "why it matters for Greeley readers", "tags": ["tag", "tag"] },
    ...4-6 total
  ],
  "civicHooks": ["upcoming local angles to chase", "..."]
}` }
  ], { max_tokens: 1800 });
  return safeJson(out, { headline: '', wins: [], watch: [], ideaPitches: [], civicHooks: [] });
}

async function freeChat({ history, message }) {
  const messages = [
    { role: 'system', content: `${SITE_VOICE}\n\nYou are also helping an admin run the site — answer questions about editorial direction, brainstorm, and rewrite snippets on request.` },
    ...((history || []).slice(-12)),
    { role: 'user', content: message }
  ];
  const out = await chat(messages, { max_tokens: 1200 });
  return stripThink(out);
}

// ── Image generation ───────────────────────────────────────────────────────

async function generateImage({ prompt, negative_prompt, size = '768x512', steps = 28, guidance = 7.5, seed = null }) {
  const body = { prompt, size, n: 1, num_inference_steps: steps, guidance_scale: guidance };
  if (negative_prompt) body.negative_prompt = negative_prompt;
  if (seed !== null && seed !== '') body.seed = Number(seed);

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 120000);
  let res, data;
  try {
    res = await fetch(`${BASE}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      signal: ctl.signal,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SD ${res.status}: ${text.slice(0, 200)}`);
    }
    data = await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('SD timed out after 120s (GPU may be cold — retry)');
    throw e;
  } finally {
    clearTimeout(t);
  }
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('SD returned no image data');

  const filename = `ai-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  const outDir = path.join(__dirname, '..', 'public', 'uploads', 'ai');
  fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, Buffer.from(b64, 'base64'));

  return {
    url: `/uploads/ai/${filename}`,
    revised_prompt: data.data?.[0]?.revised_prompt || prompt
  };
}

async function imagePromptFromArticle({ title, body }) {
  const out = await chat([
    { role: 'system', content: `You craft Stable Diffusion v1.5 prompts. Output a single line, comma-separated descriptors, photographic and editorial. No people likenesses of real public figures. No text in the image.` },
    { role: 'user', content: `Write an SD prompt for a hero image illustrating this article. Aim for photojournalistic, Greeley-Colorado-flavored when relevant.\n\nTitle: ${title || ''}\nExcerpt: ${(body || '').slice(0, 800)}\n\nReply with just the prompt, no preamble.` }
  ], { max_tokens: 200, temperature: 0.6 });
  return stripThink(out).replace(/^["']|["']$/g, '');
}

module.exports = {
  chat,
  freeChat,
  writeDraft,
  suggestHeadlines,
  generateExcerpt,
  suggestTags,
  generateSeo,
  moderate,
  bloggerReport,
  generateImage,
  imagePromptFromArticle,
  _config: { BASE, MODEL, hasKey: !!KEY }
};
