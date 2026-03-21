/**
 * W2 Marketing — Agent MCP Module
 * Shared tools registry for all copy agents.
 * Also exposes a JSON-RPC handler for the MCP HTTP endpoint.
 */

import { config } from '../config/config.js';

const OLLAMA_KEY = '6255f716c9107e6e90de1cb06389a5fa763d4d6d7a5dd8d7b9063ea4c1db2c64';
const OLLAMA_URL = 'https://ollama.madladslab.com/v1/chat/completions';
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

const TOOL_HANDLERS = {
  web_search:      ({ query }) => webSearch(query).then(r => ({ result: r })),
  fetch_url:       ({ url })   => fetchUrl(url).then(r => ({ result: r })),
  fill_site_copy:  handleFillSiteCopy,
  write_blog_post: handleWriteBlogPost,
  fill_section:    handleFillSection,
  write_page:      handleWritePage,
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
