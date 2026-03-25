/**
 * W2 Marketing — Agent MCP Module
 * Shared tools registry for all copy agents.
 * Also exposes a JSON-RPC handler for the MCP HTTP endpoint.
 */

import { config } from '../config/config.js';

const OLLAMA_KEY = '6255f716c9107e6e90de1cb06389a5fa763d4d6d7a5dd8d7b9063ea4c1db2c64';
const OLLAMA_BASE = 'https://ollama.madladslab.com';
const OLLAMA_URL = `${OLLAMA_BASE}/v1/chat/completions`;
const SD_URL = `${OLLAMA_BASE}/v1/images/generations`;
export const MODEL = 'qwen2.5:7b';

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

export async function callLLM(messages, systemPrompt) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: false,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('LLM request failed: ' + errText.slice(0, 200));
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
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

  const res = await fetch(SD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_KEY}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Stable Diffusion request failed: ' + errText.slice(0, 200));
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('Stable Diffusion returned no image data');

  return Buffer.from(b64, 'base64');
}

export function tryParseAgentResponse(raw) {
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  try {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (p.fill && typeof p.fill === 'object') return p;
    }
  } catch { /* fall through */ }

  try {
    const fixed = cleaned.replace(/("(?:[^"\\]|\\.)*")/g, s => s.replace(/\n/g, '\\n').replace(/\r/g, ''));
    const m = fixed.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (p.fill && typeof p.fill === 'object') return p;
    }
  } catch { /* fall through */ }

  const fill = {};
  const fieldRe = {
    title:    /"title"\s*:\s*"((?:[^"\\]|\\.*)*)"/,
    excerpt:  /"excerpt"\s*:\s*"((?:[^"\\]|\\.*)*)"/,
    category: /"category"\s*:\s*"((?:[^"\\]|\\.*)*)"/,
    tags:     /"tags"\s*:\s*"((?:[^"\\]|\\.*)*)"/,
    content:  /"content"\s*:\s*"([\s\S]*?)(?<!\\)"\s*[,}]/,
  };
  for (const [key, re] of Object.entries(fieldRe)) {
    const m = cleaned.match(re);
    if (m) fill[key] = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  const msgMatch = cleaned.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const message = msgMatch ? msgMatch[1] : (Object.keys(fill).length ? 'Fields filled.' : cleaned.slice(0, 200));
  return { message, fill };
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
  {
    name: 'fetch_url',
    description: 'Fetch and read the text content of a webpage.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to fetch' } },
      required: ['url'],
    },
  },
  {
    name: 'fill_site_copy',
    description: 'Generate marketing copy for W2 Marketing website sections (hero, services, about, contact).',
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
    description: 'Write a complete blog post for W2 Marketing with title, excerpt, HTML content, category, and tags.',
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
    name: 'update_design',
    description: 'Update the website design settings — colors, fonts, layouts, section visibility, and branding.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What design changes to make' },
        context: { type: 'string', description: 'Extra context, current settings, or research notes' },
      },
      required: ['task'],
    },
  },
  {
    name: 'manage_assets',
    description: 'Manage digital assets — list, search, create folders, move assets between folders, update tags, or delete assets.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: list, search, create_folder, move, tag, delete' },
        query: { type: 'string', description: 'Search query or folder name' },
        folder: { type: 'string', description: 'Target folder for move/create operations' },
        folders: { type: 'array', items: { type: 'string' }, description: 'Multiple folder slugs for multi-tag operations' },
        assetId: { type: 'string', description: 'Specific asset ID to operate on' },
        context: { type: 'string', description: 'Extra context' },
      },
      required: ['action'],
    },
  },
  {
    name: 'write_campaign',
    description: 'Draft an email marketing campaign with subject line, preheader, and HTML body for W2 Marketing subscribers.',
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
    description: 'Draft an invoice with title, line items, and notes for a W2 Marketing client.',
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
    description: 'Draft a professional email to send to a W2 Marketing client — project updates, follow-ups, onboarding, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Purpose of the email — update, follow-up, proposal, kickoff, etc.' },
        context: { type: 'string', description: 'Extra context like client name, project details' },
      },
      required: ['task'],
    },
  },
];

// ── Tool Handlers ─────────────────────────────────────────────────────────────

async function handleFillSiteCopy({ task, section, context }) {
  const searchResults = await webSearch(task.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';

  const systemPrompt = `You are a marketing copywriter for W2 Marketing, a digital marketing agency in Greeley, Colorado.

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
    "service1_title": "...", "service1_desc": "...",
    "service2_title": "...", "service2_desc": "...",
    "service3_title": "...", "service3_desc": "...",
    "about_quote": "...",
    "about_desc": "...",
    "about_sig": "W2 Marketing",
    "contact_sub": "...",
    "contact_location": "Greeley, Colorado",
    "contact_serving": "Northern Colorado & surrounding areas"
  }
}

Only include fields that are relevant to the task — omit unchanged ones.
Target section: ${section || 'relevant sections for the task'}
Tone: practical, local, trustworthy. Audience: small businesses in Greeley CO.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleWriteBlogPost({ topic, context }) {
  const searchResults = await webSearch(topic.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';

  const systemPrompt = `You are a blog writing assistant for W2 Marketing, a digital marketing agency in Greeley, Colorado.

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one short sentence describing what you wrote",
  "fill": {
    "title": "the post title",
    "excerpt": "1-2 sentence plain text summary",
    "content": "full HTML content as a single escaped string",
    "category": "one category",
    "tags": "tag1, tag2, tag3"
  }
}

Rules for content field:
- Write 400-800 words using <h2>, <p>, <strong>, <ul>, <li> tags
- All double quotes inside HTML must be escaped as \\"
- No literal newlines in the JSON string — use \\n instead
- End with a soft CTA mentioning W2 Marketing

Audience: small business owners in Greeley / Northern Colorado. Tone: practical, approachable.${contextNote}${researchCtx}`;

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

async function handleFillSection({ section_type, task, context }) {
  const searchResults = await webSearch(task.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';

  const fields = SECTION_FIELDS[section_type] || SECTION_FIELDS.text;
  const fillShape = fields.map(f => `    "${f}": "..."`).join(',\n');

  const systemPrompt = `You are a web content writer for W2 Marketing, a digital marketing agency in Greeley, Colorado.

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing what you created",
  "fill": {
${fillShape}
  }
}

Section type: ${section_type}. Tone: professional, local, trustworthy.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleWritePage({ title, page_type, task, context }) {
  const searchResults = await webSearch((title + ' ' + task).slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';
  const ptype = page_type || 'content';

  let systemPrompt;
  if (ptype === 'landing') {
    systemPrompt = `You are a landing page builder for W2 Marketing, a digital marketing agency in Greeley, Colorado.
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
    systemPrompt = `You are a web page content writer for W2 Marketing, a digital marketing agency in Greeley, Colorado.
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

async function handleGenerateSocialImage({ prompt, size, folder, clientId, context }) {
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

  const systemPrompt = `You are a social media graphic designer. Output ONLY raw JSON — no prose, no markdown fences.

Canvas: ${cW} x ${cH} pixels (size preset: "${chosenSize}").

Output shape:
{
  "message": "one sentence",
  "fill": {
    "title": "short asset title",
    "size": "${chosenSize}",
    "bgColor": "#1C2B4A",
    "sd_prompt": "Stable Diffusion prompt for AI background, or null",
    "sd_negative_prompt": "text, words, letters, numbers, watermark, blurry, low quality, deformed",
    "layers": [ ... ]
  }
}

LAYER TYPES:
- rect: { "type":"rect", "x":N, "y":N, "w":N, "h":N, "fill":"#hex or rgba()", "opacity":1, "radius":0 }
- text: { "type":"text", "text":"...", "x":N, "y":N, "w":N, "h":N, "fontSize":N, "fontFamily":"Jost", "color":"#hex", "align":"center", "bold":true }
- circle: { "type":"circle", "x":N, "y":N, "w":N, "h":N, "fill":"#hex" }

POSITIONING — use these exact formulas (canvas is ${cW}x${cH}):
- Full-width overlay: x=0, y=0, w=${cW}, h=${cH}
- Center horizontal with padding: x=${Math.round(cW * 0.08)}, w=${Math.round(cW * 0.84)}
- Heading near top third: y=${Math.round(cH * 0.25)}
- Subheading below heading: y=${Math.round(cH * 0.45)}
- Bottom strip: x=0, y=${Math.round(cH * 0.78)}, w=${cW}, h=${Math.round(cH * 0.22)}
- CTA button: x=${Math.round(cW * 0.25)}, y=${Math.round(cH * 0.72)}, w=${Math.round(cW * 0.5)}, h=${Math.round(cH * 0.08)}, radius=8

EXAMPLE for ${cW}x${cH} — centered headline with overlay:
{
  "layers": [
    { "type":"rect", "x":0, "y":${Math.round(cH * 0.2)}, "w":${cW}, "h":${Math.round(cH * 0.6)}, "fill":"rgba(0,0,0,0.5)", "radius":0 },
    { "type":"text", "text":"YOUR HEADLINE", "x":${Math.round(cW * 0.08)}, "y":${Math.round(cH * 0.3)}, "w":${Math.round(cW * 0.84)}, "h":100, "fontSize":${Math.round(Math.min(cW, cH) * 0.07)}, "fontFamily":"Cormorant Garamond", "color":"#FFFFFF", "align":"center", "bold":true },
    { "type":"text", "text":"Subtitle text here", "x":${Math.round(cW * 0.1)}, "y":${Math.round(cH * 0.48)}, "w":${Math.round(cW * 0.8)}, "h":60, "fontSize":${Math.round(Math.min(cW, cH) * 0.035)}, "fontFamily":"Jost", "color":"#F5F3EF", "align":"center", "bold":false }
  ]
}

RULES:
- Use 2-5 layers. Always include at least one text layer.
- Brand colors: navy #1C2B4A, gold #C9A848, ivory #F5F3EF (unless user says otherwise).
- Serif font: "Cormorant Garamond". Sans font: "Jost".
- Headline fontSize: ${Math.round(Math.min(cW, cH) * 0.06)}–${Math.round(Math.min(cW, cH) * 0.09)}. Subtitle: ${Math.round(Math.min(cW, cH) * 0.03)}–${Math.round(Math.min(cW, cH) * 0.045)}.
- When using sd_prompt (for themes like paintstrokes, holidays, sunset, etc.), ALWAYS put a semi-transparent rect overlay behind all text so it's readable.
- sd_prompt should describe textures/colors/atmosphere only — never text or logos. Set to null for plain designs.
- All x/y/w/h values must be integers within the ${cW}x${cH} canvas.
${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: `Design a social media graphic: ${prompt}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleUpdateDesign({ task, context }) {
  const searchResults = await webSearch(`${task} website color palette design`.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- DESIGN RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';

  const systemPrompt = `You are a design and branding assistant for W2 Marketing, a digital marketing agency in Greeley, Colorado.

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing your design changes",
  "fill": {
    "color_primary": "#hex",
    "color_primary_deep": "#hex",
    "color_primary_mid": "#hex",
    "color_accent": "#hex",
    "color_accent_light": "#hex",
    "color_bg": "#hex",
    "font_heading": "font name",
    "font_body": "font name",
    "portfolio_layout": "grid|masonry|carousel|list",
    "blog_layout": "grid|list|masonry|featured",
    "nav_logo_display": "text|image|both",
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

Only include fields that are relevant to the task — omit unchanged ones.
Font options for headings: Cormorant Garamond, Playfair Display, Lora, Merriweather, Libre Baskerville.
Font options for body: Jost, Inter, Poppins, Raleway, Nunito, DM Sans.
Keep palettes cohesive. Primary/deep/mid should be shades of same hue. Accent should contrast.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: task }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleManageAssets({ action, query, folder, folders, assetId, context }) {
  // This tool is handled by the asset agent route directly — the LLM just plans the action
  const contextNote = context ? `\nContext: ${context}` : '';
  const systemPrompt = `You are an asset management assistant for W2 Marketing.
Interpret the user's request and output a structured action plan.

Output ONLY raw JSON — no prose, no fences. Shape:
{
  "message": "one sentence describing what you will do",
  "fill": {
    "action": "list | search | create_folder | move | tag | delete",
    "query": "search term if searching",
    "folder": "target folder name if moving/creating",
    "folders": ["array of folder slugs if multi-tagging"],
    "assetId": "specific asset ID if targeting one",
    "tags": "comma-separated tags to apply"
  }
}

Actions:
- list: list assets in a folder or all
- search: search by title/tags
- create_folder: create a new custom folder
- move: move asset(s) to folder(s)
- tag: update tags on asset(s)
- delete: delete specific asset(s)
${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: `Asset management request: ${action || query || 'list all'}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleWriteCampaign({ task, context }) {
  const searchResults = await webSearch(task.slice(0, 200));
  const researchCtx = searchResults && !searchResults.startsWith('Search')
    ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---` : '';
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';

  const systemPrompt = `You are an email marketing specialist for W2 Marketing, a digital marketing agency in Greeley, Colorado.

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
- Include a clear CTA button with: <a href=\\"/#contact\\" style=\\"display:inline-block;padding:14px 28px;background:#C9A848;color:#1C2B4A;text-decoration:none;font-weight:600;border-radius:4px;\\">CTA Text</a>
- Support personalization tokens: {name}, {email}
- Keep copy concise (150-300 words)
- Open with personal greeting using {name}
- End with W2 Marketing signature
- Tone: professional but warm, local, trustworthy

Audience: small businesses in Greeley / Northern Colorado.${contextNote}${researchCtx}`;

  const raw = await callLLM([{ role: 'user', content: `Draft email campaign: ${task}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleDraftInvoice({ task, context }) {
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';

  const systemPrompt = `You are an invoicing assistant for W2 Marketing, a digital marketing agency in Greeley, Colorado.

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
- Use realistic pricing for a digital marketing agency (web design $1500-5000, SEO $500-1500/mo, social media $400-1200/mo, etc.)
- Include 2-5 line items that clearly describe deliverables
- Keep the title descriptive and professional
- Notes should mention payment terms if relevant${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: `Draft an invoice for: ${task}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

async function handleDraftClientEmail({ task, context }) {
  const contextNote = context ? `\n\nAdditional context: ${context}` : '';

  const systemPrompt = `You are a client communications specialist for W2 Marketing, a digital marketing agency in Greeley, Colorado.

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
- Professional but warm tone — Candace Wallace is the agency owner
- Sign off as "Candace Wallace" or "The W2 Marketing Team"
- Keep concise (100-250 words)
- Include next steps or a clear ask when appropriate${contextNote}`;

  const raw = await callLLM([{ role: 'user', content: `Draft client email: ${task}` }], systemPrompt);
  return tryParseAgentResponse(raw);
}

// ── Client Research Agent ────────────────────────────────────────────────────
export async function handleResearchClient({ clientName, company, website, notes, email }) {
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
  const systemPrompt = `You are a client research analyst for W2 Marketing, a digital marketing agency in Greeley, Colorado run by Candace Wallace.

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
    "suggestedServices": ["service W2 should offer them", "another service"],
    "websiteNotes": "analysis of their current website — design quality, SEO basics, mobile-friendliness, content gaps. Say 'No website found' if none.",
    "socialPresence": "what social platforms they appear to be on based on search results",
    "brandVoice": "suggested brand voice/tone based on their business type",
    "goals": "suggested marketing goals based on their business type and current state",
    "onboardingNotes": "key things the W2 team should know when onboarding this client"
  }
}

Rules:
- Be specific and actionable — generic advice is not useful
- If website content is available, analyze it in detail
- Tailor service suggestions to W2 Marketing's capabilities (social media, web design, SEO, branding, content marketing)
- Be honest about gaps and opportunities
- Keep each field concise but substantive`;

  const userMessage = `Research this client for onboarding:

Name: ${clientName || 'Unknown'}
Company: ${company || 'Unknown'}
Email: ${email || 'N/A'}
Website: ${website || 'None provided'}
Notes: ${notes || 'None'}

--- WEB SEARCH RESULTS ---
${searchResults}

${siteContent ? `--- WEBSITE CONTENT ---\n${siteContent}` : ''}`;

  const raw = await callLLM([{ role: 'user', content: userMessage }], systemPrompt);
  return tryParseAgentResponse(raw);
}

const TOOL_HANDLERS = {
  web_search:           ({ query }) => webSearch(query).then(r => ({ result: r })),
  fetch_url:            ({ url })   => fetchUrl(url).then(r => ({ result: r })),
  fill_site_copy:       handleFillSiteCopy,
  write_blog_post:      handleWriteBlogPost,
  fill_section:         handleFillSection,
  write_page:           handleWritePage,
  generate_social_image: handleGenerateSocialImage,
  update_design:        handleUpdateDesign,
  manage_assets:        handleManageAssets,
  write_campaign:       handleWriteCampaign,
  draft_invoice:        handleDraftInvoice,
  draft_client_email:   handleDraftClientEmail,
  research_client:      handleResearchClient,
};

export async function runTool(name, args) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) throw new Error(`Unknown MCP tool: ${name}`);
  return handler(args);
}

// ── MCP JSON-RPC Handler (MCP HTTP transport) ─────────────────────────────────

const MCP_SERVER_INFO = {
  name: 'w2marketing-agents',
  version: '1.0.0',
};

const MCP_CAPABILITIES = {
  tools: {},
};

export async function handleMcpRequest(body) {
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
      const result = await runTool(name, args || {});
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
