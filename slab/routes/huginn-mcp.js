/**
 * Huginn MCP Router — JSON-RPC 2.0 endpoint for the LLM machine
 * Mounted at /huginn/mcp
 *
 * The LLM machine (ollama.madladslab.com) can call these tools to read
 * Slab DB, browse the codebase, and manage Huginn's own collections.
 * Auth: Bearer token (OLLAMA_KEY) or superadmin cookie.
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import {
  // Tasks
  createTask, updateTask, listTasks, getTask,
  // Notes
  saveNote, searchNotes, listNotes,
  // Conversation
  logConversation, getConversationHistory,
  // Slab DB read
  readSlabCollection, readTenantCollection,
  listSlabCollections, listTenantCollections,
  getSlabStats,
  // Codebase read
  readFile, listDir,
} from '../plugins/huginnMcp.js';

import { readFileSync } from 'fs';

const router = express.Router();

// ── Platform MCP helpers ────────────────────────────────────────────────────

let _mcpSecret;
try { _mcpSecret = readFileSync('/root/.ssh/mcp_0001', 'utf-8').trim(); } catch { _mcpSecret = ''; }
const _MCP_BASE = 'https://madladslab.com/api/v1/mcp';

async function platformGet(path) {
  const r = await fetch(`${_MCP_BASE}${path}`, {
    headers: { 'x-mcp-secret': _mcpSecret },
    signal: AbortSignal.timeout(15_000),
  });
  return r.json();
}

async function platformPost(path, body) {
  const r = await fetch(`${_MCP_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mcp-secret': _mcpSecret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return r.json();
}

// ── Auth: Bearer token OR superadmin cookie ─────────────────────────────────

const SA_EMAILS = ['snoryder8019@gmail.com', 'scott@madladslab.com'];

function requireHuginnAuth(req, res, next) {
  // Bearer token from LLM machine
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${config.OLLAMA_KEY}`) return next();

  // Superadmin cookie (from browser) — verify JWT directly
  if (req.superAdmin || req.adminUser) return next();
  try {
    const token = req.cookies?.slab_token;
    if (token) {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (decoded.isAdmin && SA_EMAILS.includes(decoded.email)) return next();
    }
  } catch {}

  return res.status(401).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized' }, id: null });
}

router.use(express.json());
router.use(requireHuginnAuth);

// ── Tool registry ───────────────────────────────────────────────────────────

const TOOLS = {
  // Tasks
  'huginn.tasks.create':   async (p) => createTask(p),
  'huginn.tasks.update':   async (p) => updateTask(p.id, p.updates),
  'huginn.tasks.list':     async (p) => listTasks(p || {}),
  'huginn.tasks.get':      async (p) => getTask(p.id),

  // Notes
  'huginn.notes.save':     async (p) => saveNote(p),
  'huginn.notes.search':   async (p) => searchNotes(p.query, p.limit),
  'huginn.notes.list':     async (p) => listNotes(p?.topic, p?.limit),

  // Conversation history
  'huginn.conversations.log':     async (p) => logConversation(p.session, p.role, p.content, p.meta),
  'huginn.conversations.history': async (p) => getConversationHistory(p.session, p.limit),

  // Slab DB read
  'slab.collections':      async () => listSlabCollections(),
  'slab.read':             async (p) => readSlabCollection(p.collection, p.query, p),
  'slab.stats':            async () => getSlabStats(),
  'slab.tenant.collections': async (p) => listTenantCollections(p.db),
  'slab.tenant.read':     async (p) => readTenantCollection(p.db, p.collection, p.query, p),

  // Codebase read
  'codebase.readFile':     async (p) => readFile(p.path, p.maxLines),
  'codebase.listDir':      async (p) => listDir(p.path, p.depth),

  // Platform MCP passthrough (calls madladslab.com/api/v1/mcp)
  'platform.tmux.sessions':  async () => platformGet('/tmux/sessions'),
  'platform.tmux.session':   async (p) => platformGet(`/tmux/session/${encodeURIComponent(p.name)}`),
  'platform.tmux.logs':      async (p) => platformGet(`/tmux/logs/${encodeURIComponent(p.name)}?lines=${p.lines || 100}`),
  'platform.service.port':   async (p) => platformGet(`/service/port/${p.port}`),
  'platform.context':        async (p) => platformGet(`/context/${encodeURIComponent(p.project)}`),
  'platform.readFile':       async (p) => platformPost('/read-file', { path: p.path }),
  'platform.listDir':        async (p) => platformPost('/list-directory', { path: p.path }),
  'platform.execute':        async (p) => platformPost('/execute', { command: p.command }),

  // Weather
  'huginn.weather': async () => {
    const { fetchWeather } = await import('../plugins/huginnMcp.js');
    return fetchWeather();
  },

  // Discovery
  'tools.list':            async () => Object.keys(TOOLS).map(name => ({ name })),
};

// ── JSON-RPC 2.0 handler ────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { jsonrpc, method, params, id } = req.body;

  if (jsonrpc !== '2.0' || !method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid JSON-RPC request' },
      id: id || null,
    });
  }

  const tool = TOOLS[method];
  if (!tool) {
    return res.json({
      jsonrpc: '2.0',
      error: { code: -32601, message: `Unknown method: ${method}` },
      id,
    });
  }

  try {
    const result = await tool(params || {});
    res.json({ jsonrpc: '2.0', result, id });
  } catch (err) {
    console.error(`[huginn-mcp] ${method} error:`, err.message);
    res.json({
      jsonrpc: '2.0',
      error: { code: -32000, message: err.message },
      id,
    });
  }
});

// ── REST shortcuts for quick access ─────────────────────────────────────────

router.get('/tasks', async (req, res) => {
  try {
    const tasks = await listTasks({
      status: req.query.status || undefined,
      limit: parseInt(req.query.limit) || 50,
    });
    res.json({ ok: true, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks', async (req, res) => {
  try {
    const task = await createTask(req.body);
    res.json({ ok: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/tasks/:id', async (req, res) => {
  try {
    const task = await updateTask(req.params.id, req.body);
    res.json({ ok: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/notes', async (req, res) => {
  try {
    const notes = req.query.q
      ? await searchNotes(req.query.q, parseInt(req.query.limit) || 10)
      : await listNotes(req.query.topic, parseInt(req.query.limit) || 20);
    res.json({ ok: true, notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await getSlabStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/context', async (req, res) => {
  try {
    const { buildHuginnContext } = await import('../plugins/huginnMcp.js');
    const context = await buildHuginnContext('');
    res.json({ ok: true, context });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Weather (open-meteo, no API key needed) ────────────────────────────────

let weatherCache = { data: null, fetchedAt: 0 };

router.get('/weather', async (req, res) => {
  try {
    // Cache 10 min
    if (weatherCache.data && Date.now() - weatherCache.fetchedAt < 600_000) {
      return res.json({ ok: true, weather: weatherCache.data });
    }

    // Default: get location from IP via ip-api, then weather from open-meteo
    let lat = 40.76, lon = -73.98, location = 'New York'; // fallback
    try {
      const geoRes = await fetch('http://ip-api.com/json/?fields=lat,lon,city,regionName', {
        signal: AbortSignal.timeout(3000),
      });
      const geo = await geoRes.json();
      if (geo.lat) { lat = geo.lat; lon = geo.lon; location = `${geo.city}, ${geo.regionName}`; }
    } catch {}

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph`,
      { signal: AbortSignal.timeout(5000) }
    );
    const w = await weatherRes.json();
    const cur = w.current || {};

    // WMO weather code → icon + condition
    const WMO = {
      0:'Clear',1:'Mostly Clear',2:'Partly Cloudy',3:'Overcast',
      45:'Foggy',48:'Rime Fog',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',
      61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',73:'Snow',75:'Heavy Snow',
      80:'Light Showers',81:'Showers',82:'Heavy Showers',95:'Thunderstorm',96:'Hail Storm',99:'Heavy Hail',
    };
    const ICONS = {
      0:'\u2600\uFE0F',1:'\u26C5',2:'\u26C5',3:'\u2601\uFE0F',45:'\uD83C\uDF2B\uFE0F',48:'\uD83C\uDF2B\uFE0F',
      51:'\uD83C\uDF26\uFE0F',53:'\uD83C\uDF27\uFE0F',55:'\uD83C\uDF27\uFE0F',61:'\uD83C\uDF27\uFE0F',63:'\uD83C\uDF27\uFE0F',65:'\uD83C\uDF27\uFE0F',
      71:'\u2744\uFE0F',73:'\uD83C\uDF28\uFE0F',75:'\uD83C\uDF28\uFE0F',80:'\uD83C\uDF26\uFE0F',81:'\uD83C\uDF27\uFE0F',82:'\uD83C\uDF27\uFE0F',
      95:'\u26C8\uFE0F',96:'\u26C8\uFE0F',99:'\u26C8\uFE0F',
    };
    const code = cur.weather_code ?? 0;

    weatherCache.data = {
      temp: Math.round(cur.temperature_2m || 0) + '\u00B0F',
      condition: WMO[code] || 'Unknown',
      icon: ICONS[code] || '\u2600\uFE0F',
      humidity: (cur.relative_humidity_2m || 0) + '%',
      wind: Math.round(cur.wind_speed_10m || 0) + ' mph',
      location,
      lat, lon,
    };
    weatherCache.fetchedAt = Date.now();

    res.json({ ok: true, weather: weatherCache.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── HTTP MCP Passthrough (proxy to madladslab.com/api/v1/mcp) ──────────────
// Lets Huginn reach all platform MCPs: tmux, services, files, commands

// Proxy GET
router.get('/platform/:path(*)', async (req, res) => {
  try {
    const url = `${_MCP_BASE}/${req.params.path}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    const data = await platformGet(`/${req.params.path}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Platform MCP unreachable', detail: err.message });
  }
});

// Proxy POST
router.post('/platform/:path(*)', async (req, res) => {
  try {
    const data = await platformPost(`/${req.params.path}`, req.body);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Platform MCP unreachable', detail: err.message });
  }
});

// Discovery: list all available platform MCP endpoints
router.get('/platform-tools', (req, res) => {
  res.json({
    ok: true,
    base: '/huginn/mcp/platform',
    tools: [
      { method: 'GET',  path: '/health',              desc: 'Platform MCP health check' },
      { method: 'GET',  path: '/tmux/sessions',       desc: 'List all tmux sessions' },
      { method: 'GET',  path: '/tmux/session/:name',  desc: 'Session status' },
      { method: 'GET',  path: '/tmux/logs/:name',     desc: 'Capture session logs (?lines=100)' },
      { method: 'GET',  path: '/service/port/:port',  desc: 'Check if port is in use' },
      { method: 'GET',  path: '/context/:project',    desc: 'Get project CLAUDE.md' },
      { method: 'POST', path: '/read-file',           desc: 'Read file {path}' },
      { method: 'POST', path: '/list-directory',      desc: 'List directory {path}' },
      { method: 'POST', path: '/execute',             desc: 'Execute command {command}' },
    ],
  });
});

export default router;
