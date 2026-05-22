'use strict';

// Routes for the Windrose modbuilder MCP:
//
//   POST /mcp/windrose                — Streamable HTTP transport (modern)
//   GET  /mcp/windrose                — server-initiated message stream (modern)
//   GET  /mcp/windrose/sse            — Legacy SSE transport handshake
//   POST /mcp/windrose/messages       — Legacy SSE transport message inbox
//   GET  /mcp/windrose/health         — public probe (no auth)
//   GET  /mcp/windrose/tokens         — list caller's tokens (admin session)
//   POST /mcp/windrose/tokens         — mint a new token (admin session)
//   POST /mcp/windrose/tokens/:id/revoke — revoke (admin session)
//   GET  /mcp/windrose/status         — Build tab status payload (admin session)
//
// The two transports exist because Claude Desktop / older Claude Code use
// the legacy SSE handshake (GET -> endpoint event -> POST to that URL ->
// responses streamed back through the SSE), while newer Claude Code uses
// the simpler Streamable HTTP (POST gets a synchronous JSON response).

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const wmcp = require('../lib/windrose-mcp');

const router = express.Router();

// MCP protocol version we advertise. Must match the value in lib/windrose-mcp.js.
const MCP_PROTOCOL_VERSION = '2025-06-18';

// In-memory map of open legacy-SSE streams. Keyed by sessionId so the
// /messages POST can route the JSON-RPC response back through the right
// open stream.
const sseStreams = new Map();

// ── Logging helpers ────────────────────────────────────────────────────────
// Every MCP hit goes through one of these so the games tmux is the single
// place to watch what mod-builder clients are doing.

function _label(req) {
  const t = req.windroseToken;
  return t ? (t.label || 'unlabeled') : 'anon';
}

function _ip(req) {
  return (req.headers['x-forwarded-for'] || req.ip || '?').toString().split(',')[0].trim();
}

function logMcp(req, ...parts) {
  // Single-line, grep-friendly. Format: [mcp] <label> <ip> <…parts>
  // eslint-disable-next-line no-console
  console.log('[mcp]', _label(req), _ip(req), ...parts);
}

function logMcpWarn(req, ...parts) {
  // eslint-disable-next-line no-console
  console.warn('[mcp]', _label(req), _ip(req), ...parts);
}

// ── Auth helpers ───────────────────────────────────────────────────────────

// Browser session auth (used by the Build tab in index.html). Token
// management is admin-only — outside mod authors don't sign in here; they
// use the token an admin shares with them.
function requireAdmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'login required' });
  }
  const u = req.user;
  const gp = u.permissions && u.permissions.games;
  if (u.isAdmin || gp === 'admin') return next();
  return res.status(403).json({ error: 'admin only' });
}

// MCP-transport auth — Bearer token from the Authorization header.
async function requireMcpToken(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(\S+)/i);
  if (!m) {
    console.warn('[mcp] auth-fail (no Bearer header)', _ip(req), req.method, req.originalUrl);
    return res.status(401).json({ error: 'missing Bearer token' });
  }
  const tok = await wmcp.validateToken(m[1]);
  if (!tok) {
    console.warn('[mcp] auth-fail (invalid/revoked token)', _ip(req), req.method, req.originalUrl);
    return res.status(401).json({ error: 'invalid or revoked token' });
  }
  req.windroseToken = tok;
  next();
}

// ── MCP transport ──────────────────────────────────────────────────────────
//
// We implement the minimal subset of the MCP Streamable HTTP transport: clients
// POST a JSON-RPC message (or a batch) and we reply with the matching response.
// That's enough for Claude Code / Claude Desktop and any well-behaved client.
//
// GET is accepted as a capability probe — clients that prefer SSE will issue
// one before falling back to POST. We don't push server-initiated events yet,
// so we close the stream immediately with a 200 to signal "stream open, no
// events to deliver."

// ── Public health probe (NO AUTH) ─────────────────────────────────────────
// Lets a mod-builder client (or a curl test) verify the MCP is reachable
// WITHOUT having to first prove they hold a valid token. Returns enough
// detail for a client to know which transport URL to use and what protocol
// version we speak.
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    server: 'windrose-mcp',
    version: '0.1.0',
    protocolVersion: MCP_PROTOCOL_VERSION,
    transports: {
      streamableHttp: { post: '/mcp/windrose', get: '/mcp/windrose' },
      legacySse:      { sse:  '/mcp/windrose/sse', messages: '/mcp/windrose/messages' },
    },
    toolCount: wmcp.TOOLS.length,
    resourceCount: wmcp.RESOURCES.length,
    auth: 'Bearer <wr_*> token in Authorization header',
    hint: 'POST initialize to /mcp/windrose for Streamable HTTP; or GET /mcp/windrose/sse and POST to the endpoint event\'s data URL for legacy SSE.',
  });
});

// ── Streamable HTTP transport: GET (server-initiated stream) ──────────────
// Modern clients open this to subscribe to server notifications. We don't
// push any today, so we just hold the stream open with keepalive pings. If
// the client never opens GET that's fine — Streamable HTTP doesn't require
// it.
router.get('/', requireMcpToken, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // X-Accel-Buffering disables proxy buffering for nginx-style frontends;
    // harmless for Apache but useful belt-and-suspenders.
    'X-Accel-Buffering': 'no',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  });
  res.flushHeaders();
  res.write(': windrose-mcp streamable-http server-stream ready\n\n');
  logMcp(req, 'shttp-stream-connect');
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_e) {} }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    logMcp(req, 'shttp-stream-disconnect');
  });
});

// ── Legacy SSE transport: GET /sse (handshake) ────────────────────────────
// Per MCP 2024-11-05: client opens this SSE stream; server's first event
// MUST be `event: endpoint` whose data is the relative URL where the
// client will POST messages. Subsequent JSON-RPC responses come back
// through this same stream as `event: message` events.
router.get('/sse', requireMcpToken, (req, res) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    'Mcp-Session-Id': sessionId,
  });
  res.flushHeaders();
  // First event: tell the legacy client where to POST messages. Apache
  // strips the leading path on ProxyPass, but the client expects an
  // absolute or origin-relative URL — origin-relative is safest.
  res.write(`event: endpoint\ndata: /mcp/windrose/messages?sessionId=${sessionId}\n\n`);

  sseStreams.set(sessionId, {
    res,
    tokenId: String(req.windroseToken._id),
    label: req.windroseToken.label || 'unlabeled',
    openedAt: Date.now(),
  });
  logMcp(req, `legacy-sse-connect session=${sessionId}`);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_e) { clearInterval(ping); }
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseStreams.delete(sessionId);
    logMcp(req, `legacy-sse-disconnect session=${sessionId}`);
  });
});

// ── Legacy SSE transport: POST /messages?sessionId=... ────────────────────
// The client POSTs JSON-RPC here; the response is pushed back through the
// matching open SSE stream, not returned in the POST body. The POST itself
// returns 202 Accepted.
router.post('/messages', requireMcpToken, express.json({ limit: '4mb' }), async (req, res) => {
  const sessionId = (req.query.sessionId || '').toString();
  const stream = sessionId ? sseStreams.get(sessionId) : null;
  if (!stream) {
    logMcpWarn(req, `legacy-sse no session for sessionId=${sessionId || '(missing)'}`);
    return res.status(400).json({
      error: 'no active SSE session for that sessionId',
      sessionId,
      hint: 'Open GET /mcp/windrose/sse first and use the URL from the endpoint event.',
    });
  }
  if (stream.tokenId !== String(req.windroseToken._id)) {
    logMcpWarn(req, `legacy-sse token mismatch session=${sessionId}`);
    return res.status(403).json({ error: 'session belongs to a different token' });
  }

  const body = req.body;
  const t0 = Date.now();
  try {
    if (Array.isArray(body)) {
      const out = [];
      for (const msg of body) {
        const r = await wmcp.dispatch(msg, { token: req.windroseToken });
        _logCall(req, msg, r, Date.now() - t0);
        if (r) out.push(r);
      }
      res.status(202).json({ ack: true });
      for (const r of out) _pushToSse(stream, r);
    } else {
      const single = await wmcp.dispatch(body, { token: req.windroseToken });
      _logCall(req, body, single, Date.now() - t0);
      res.status(202).json({ ack: true });
      if (single) _pushToSse(stream, single);
    }
  } catch (e) {
    logMcpWarn(req, `legacy-sse fatal session=${sessionId}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

function _pushToSse(stream, payload) {
  try {
    stream.res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch (e) {
    console.warn('[mcp] failed to push response to legacy SSE stream:', e.message);
  }
}

router.post('/', requireMcpToken, express.json({ limit: '4mb' }), async (req, res) => {
  const body = req.body;
  const t0 = Date.now();
  // Streamable HTTP transport headers. The spec MAY include Mcp-Session-Id
  // on initialize responses; we generate one even for non-initialize calls
  // so clients have a stable session handle to log against.
  const sessionId = req.headers['mcp-session-id'] || crypto.randomBytes(16).toString('hex');
  res.set({
    'Mcp-Session-Id': sessionId,
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  });
  try {
    if (Array.isArray(body)) {
      const out = [];
      for (const msg of body) {
        const r = await wmcp.dispatch(msg, { token: req.windroseToken });
        _logCall(req, msg, r, Date.now() - t0);
        if (r) out.push(r);
      }
      // Per JSON-RPC: if every entry was a notification, return 204.
      if (!out.length) return res.status(204).end();
      return res.json(out);
    }
    const single = await wmcp.dispatch(body, { token: req.windroseToken });
    _logCall(req, body, single, Date.now() - t0);
    if (!single) return res.status(204).end();
    return res.json(single);
  } catch (e) {
    logMcpWarn(req, 'fatal', body && body.method, e.message);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: body && body.id,
      error: { code: -32000, message: e.message || 'internal' },
    });
  }
});

// Log a single dispatched JSON-RPC call. We pick out the tool name (when
// it's a tools/call) and any error so failures are immediately visible.
function _logCall(req, msg, response, ms) {
  if (!msg || typeof msg !== 'object') return;
  const method = msg.method || '?';
  // Notifications (no id) return null — log them anyway so disconnects/inits show up.
  const tag = method === 'tools/call' ? `tool=${msg.params && msg.params.name}` : null;
  if (response && response.error) {
    logMcpWarn(req, `${method}${tag ? ' ' + tag : ''} -> ERR (${response.error.code}) ${response.error.message} [${ms}ms]`);
    return;
  }
  // Truncate arg preview so we don't spam the log with huge fs_write payloads.
  let preview = '';
  if (method === 'tools/call' && msg.params && msg.params.arguments) {
    try {
      const a = JSON.stringify(msg.params.arguments);
      preview = ' ' + (a.length > 160 ? a.slice(0, 157) + '...' : a);
    } catch (_e) {}
  }
  logMcp(req, `${method}${tag ? ' ' + tag : ''}${preview} -> ok [${ms}ms]`);
}

// ── Browser-session: token management ──────────────────────────────────────

router.get('/tokens', requireAdmin, async (req, res) => {
  try {
    const tokens = await wmcp.listTokensFor(req.user._id);
    res.json({ tokens });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tokens', requireAdmin, express.json(), async (req, res) => {
  try {
    const label = (req.body && req.body.label) || 'mod-builder';
    const out = await wmcp.mintToken(req.user._id, label);
    // The plaintext token is included exactly once, on creation, and never logged.
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tokens/:id/revoke', requireAdmin, async (req, res) => {
  try {
    const ok = await wmcp.revokeToken(req.user._id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'token not found' });
    res.json({ revoked: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Browser-session: Build tab status ──────────────────────────────────────

router.get('/status', requireAdmin, async (req, res) => {
  try {
    const modsListing = await wmcp.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'list_mods', arguments: {} } }, { token: null });
    const modsResult = JSON.parse(modsListing.result.content[0].text);

    let ue4ssTail = [];
    try {
      const t = await wmcp.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'tail_log', arguments: { name: 'ue4ss', lines: 20 } } }, { token: null });
      ue4ssTail = JSON.parse(t.result.content[0].text).lines || [];
    } catch (_e) {}

    // List extension files so the Build tab can preview what the MCP has shipped.
    let overlayFiles = [];
    try {
      const entries = await fs.readdir(wmcp.paths.UI_EXT_DIR, { withFileTypes: true });
      overlayFiles = entries
        .filter(d => d.isFile())
        .map(d => d.name);
    } catch (_e) {}

    res.json({
      endpoint: '/mcp/windrose',
      protocol: 'mcp-streamable-http',
      paths: wmcp.paths,
      mods: modsResult,
      ue4ssTail,
      overlayFiles,
      tools: wmcp.TOOLS.map(t => t.name),
      resources: wmcp.RESOURCES.map(r => r.uri),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Browser-session: Build overlay REST proxies ────────────────────────────
// extension.js (loaded in the admin Build tab) needs lightweight REST shims —
// it can't speak MCP JSON-RPC from the browser (no Bearer token). Each route
// below dispatches the same tool the MCP exposes, then unwraps the single
// content[0].text payload so the overlay sees plain JSON.

async function callTool(name, args = {}) {
  const r = await wmcp.dispatch(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    { token: null },
  );
  if (r && r.error) throw new Error(r.error.message || 'tool dispatch failed');
  const text = r && r.result && r.result.content && r.result.content[0] && r.result.content[0].text;
  return text ? JSON.parse(text) : null;
}

router.get('/state', requireAdmin, async (req, res) => {
  try {
    const livemap = await callTool('get_livemap');
    const server  = await callTool('get_server_status').catch(() => null);
    res.json({ livemap, server });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/events', requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const events = await callTool('get_events', { limit });
    res.json({ events: Array.isArray(events) ? events : (events && events.events) || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/mods', requireAdmin, async (req, res) => {
  try {
    const mods = await callTool('list_mods');
    res.json({ mods: Array.isArray(mods) ? mods : (mods && mods.mods) || mods });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
