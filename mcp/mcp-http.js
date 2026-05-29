#!/usr/bin/env node

/**
 * Streamable HTTP MCP Server for Claude App
 *
 * Exposes the MCP server over HTTP so Claude (app/web) can connect
 * via mcp.madladslab.com
 *
 * CRITICAL SAFETY RULES:
 * - NEVER use 'killall node' - kills all services!
 * - ALWAYS use tmux session management for service control
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { verifyJWT } from './lib/jwtVerify.js';

const PORT = process.env.MCP_PORT || 3650;

// ── Auth config (resource server) ─────────────────────────────────
// /mcp accepts either: (a) a static bearer key — for curl / Claude Code / the
// API connector; or (b) an RS256 JWT minted by the mllOauth service — for the
// claude.ai web connector. Unauthenticated requests get a 401 with a
// WWW-Authenticate challenge so Claude can discover the OAuth flow.
const STATIC_TOKENS = (process.env.MCP_STATIC_TOKENS || '').split(',').map(s => s.trim()).filter(Boolean);
const OAUTH_ISSUER = process.env.MCP_OAUTH_ISSUER || 'https://mcp.madladslab.com';
const OAUTH_RESOURCE = process.env.MCP_RESOURCE || 'https://mcp.madladslab.com/mcp';
const PRM_URL = process.env.MCP_PROTECTED_RESOURCE_METADATA
  || 'https://mcp.madladslab.com/.well-known/oauth-protected-resource';
let OAUTH_PUBLIC_KEY = null;
try {
  if (process.env.MCP_OAUTH_PUBLIC_KEY) OAUTH_PUBLIC_KEY = readFileSync(process.env.MCP_OAUTH_PUBLIC_KEY, 'utf8');
} catch (e) {
  console.warn(`Could not read OAuth public key (${process.env.MCP_OAUTH_PUBLIC_KEY}): ${e.message}`);
}

function authenticate(req, res, next) {
  const challenge = () => res
    .set('WWW-Authenticate', `Bearer resource_metadata="${PRM_URL}"`)
    .status(401)
    .json({ error: 'unauthorized', error_description: 'Bearer token required' });

  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return challenge();
  const token = m[1].trim();

  // (a) static pre-shared keys
  if (STATIC_TOKENS.includes(token)) return next();

  // (b) OAuth-issued JWT
  if (OAUTH_PUBLIC_KEY) {
    try {
      verifyJWT(token, OAUTH_PUBLIC_KEY, { issuer: OAUTH_ISSUER, audience: OAUTH_RESOURCE });
      return next();
    } catch (e) {
      console.warn(`JWT rejected: ${e.message}`);
    }
  }
  return challenge();
}

// Security configuration
const ALLOWED_BASE_PATHS = ['/srv'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const COMMAND_TIMEOUT = 30000;

// ── Session metadata (cosmetic only) ──────────────────────────────
// The source of truth for what is running is ALWAYS live `tmux`/`lsof`/`ps`
// output, resolved at request time. This map only supplies a friendly label
// when we happen to recognize a session name (after stripping a trailing
// "_session"). Unknown/new sessions still report fully — nothing here gates
// whether a session is considered running. Add/remove services freely; the
// report tracks reality without edits to this file.
const SESSION_META = {
  ps: 'Stringborn Universe service',
  'game-state-service': 'Game state service',
  'game-state': 'Game state service',
  madladslab: 'Main lab service',
  slab: 'Main lab service',
  servers: 'Servers service',
  opsTrain: 'OpsTrain service',
  bih: 'BIH gaming hub',
  w2marketing: 'W2 Marketing service',
  mcp: 'MCP server (this connector)',
  'mcp-streamable': 'MCP Streamable HTTP server (this connector)',
  mllOauth: 'MLL OAuth (claude.ai connector auth)',
  mllPitches: 'MLL Pitches service',
  coDevs: 'CoDevs service',
  games: 'Games service',
  'graffiti-tv': 'Graffiti TV service',
  greealitytv: 'Greeality TV service',
  'piper-tts': 'Piper TTS service',
  'triple-twenty': 'Triple Twenty service',
};

function normalizeSession(name) {
  return name.replace(/_session$/, '');
}

// Build pid -> Set(ports) from a single `lsof -F pn` listen scan.
function parseListenPorts(lsofStdout) {
  const map = {};
  let pid = null;
  for (const line of lsofStdout.split('\n')) {
    if (!line) continue;
    const tag = line[0], val = line.slice(1);
    if (tag === 'p') pid = val;
    else if (tag === 'n' && pid) {
      const m = val.match(/:(\d+)$/);
      if (m) (map[pid] = map[pid] || new Set()).add(Number(m[1]));
    }
  }
  return map;
}

// Build pid -> children[] from `ps -eo pid=,ppid=`.
function parseProcTree(psStdout) {
  const children = {};
  for (const line of psStdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) (children[m[2]] = children[m[2]] || []).push(m[1]);
  }
  return children;
}

// Depth-first collect a pid and all its descendants.
function collectSubtree(children, root) {
  const out = [], stack = [String(root)], seen = new Set();
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p); out.push(p);
    for (const c of (children[p] || [])) stack.push(c);
  }
  return out;
}

// Patterns matched against the full command (case-insensitive). A blacklist is
// defense-in-depth only — the real boundary is the Apache bearer token + the
// loopback bind. These catch the foot-guns that take the whole VM down.
const FORBIDDEN_PATTERNS = [
  /\bkillall\b/i,                 // kills every matching process incl. all node
  /\bpkill\b/i,                   // any pkill (not just -9) can nuke services
  /\bkill\s+-9\b/i,               // forceful kills
  /\brm\s+-[a-z]*r[a-z]*f?\s+\//i,// rm -rf / and recursive deletes from root
  /\bdd\s+if=/i,                  // raw disk writes
  /\bmkfs\b/i,                    // format filesystem
  /\b(reboot|shutdown|halt|poweroff)\b/i,
  /\binit\s+[06]\b/i,             // runlevel 0/6
  /\bsystemctl\s+(stop|disable|mask|poweroff|reboot)\b/i,
  /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/, // fork bomb :(){ :|:& };:
  /\bchmod\s+-R\s+0*777\s+\//i,   // recursive world-writable from root
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/i, // pipe remote -> shell
  />\s*\/dev\/(sd|nvme|vd|xvd)/i, // clobber a block device
];

function describeForbidden() {
  return FORBIDDEN_PATTERNS.map(p => p.source).join(', ');
}

function isPathAllowed(filePath) {
  const resolved = resolve(filePath);
  return ALLOWED_BASE_PATHS.some(basePath => resolved.startsWith(basePath));
}

function isForbiddenCommand(command) {
  return FORBIDDEN_PATTERNS.some(pattern => pattern.test(command));
}

async function executeCommand(command, timeout = COMMAND_TIMEOUT) {
  return new Promise((resolve, reject) => {
    if (isForbiddenCommand(command)) {
      reject(new Error(`FORBIDDEN: Command matched a dangerous pattern. Blocked: ${describeForbidden()}`));
      return;
    }

    const child = spawn('bash', ['-c', command], {
      cwd: '/srv',
      timeout: timeout,
      maxBuffer: 1024 * 1024 * 5
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), success: code === 0 });
    });

    child.on('error', (error) => {
      reject(new Error(`Command execution failed: ${error.message}`));
    });

    setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);
  });
}

// Tool definitions (shared)
const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from /srv directory tree.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path (must start with /srv)' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in /srv directory tree.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path (must start with /srv)' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List contents of a directory in /srv tree.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path (must start with /srv)' } },
      required: ['path'],
    },
  },
  {
    name: 'execute_command',
    description: 'Execute a bash command safely. NEVER use "killall node". Use tmux session management instead.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute. Forbidden: killall, rm -rf /, dd, mkfs, reboot, shutdown' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)', default: 30000 },
      },
      required: ['command'],
    },
  },
  {
    name: 'tmux_list_sessions',
    description: 'List all running tmux sessions with their status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tmux_session_status',
    description: 'Get detailed status of a specific tmux session.',
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: 'Session name' } },
      required: ['session'],
    },
  },
  {
    name: 'tmux_capture_logs',
    description: 'Capture recent output from a tmux session.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
        lines: { type: 'number', description: 'Lines to capture (default: 100)', default: 100 },
      },
      required: ['session'],
    },
  },
  {
    name: 'service_status',
    description: 'Check if a service is running on a specific port.',
    inputSchema: {
      type: 'object',
      properties: { port: { type: 'number', description: 'Port number to check' } },
      required: ['port'],
    },
  },
  {
    name: 'restart_service_safe',
    description: 'Safely restart a service using tmux. NEVER uses killall.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Tmux session name' },
        port: { type: 'number', description: 'Port number' },
        directory: { type: 'string', description: 'Working directory (e.g., /srv/ps)' },
        command: { type: 'string', description: 'Start command (e.g., "PORT=3399 npm start")' },
      },
      required: ['session', 'port', 'directory', 'command'],
    },
  },
  {
    name: 'get_claude_context',
    description: 'Get the CLAUDE.md context file for a project.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Project name', default: 'ps' } },
    },
  },
  {
    name: 'emergency_restart_all',
    description: 'Emergency: Restart ALL services using /srv/start-all-services.sh.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// Tool handler logic
async function handleTool(name, args) {
  switch (name) {
    case 'read_file': {
      if (!isPathAllowed(args.path)) throw new Error('Access denied: Path must be within /srv');
      const stats = await stat(args.path);
      if (stats.size > MAX_FILE_SIZE) throw new Error(`File too large: ${stats.size} bytes`);
      return await readFile(args.path, 'utf-8');
    }

    case 'write_file': {
      if (!isPathAllowed(args.path)) throw new Error('Access denied: Path must be within /srv');
      await writeFile(args.path, args.content, 'utf-8');
      return `Wrote ${args.content.length} bytes to ${args.path}`;
    }

    case 'list_directory': {
      if (!isPathAllowed(args.path)) throw new Error('Access denied: Path must be within /srv');
      const files = await readdir(args.path, { withFileTypes: true });
      return JSON.stringify(files.map(f => ({
        name: f.name,
        type: f.isDirectory() ? 'directory' : 'file',
        path: join(args.path, f.name),
      })), null, 2);
    }

    case 'execute_command': {
      const result = await executeCommand(args.command, args.timeout);
      return JSON.stringify(result, null, 2);
    }

    case 'tmux_list_sessions': {
      // Source of truth = live tmux. Each real session is enriched with the
      // port it is actually listening on (resolved from its process subtree),
      // the working directory of that process, and an optional friendly label.
      // Nothing is hardcoded as "running": if a session isn't in tmux, it
      // isn't reported. New services appear automatically.
      const fmt = '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}';
      const ls = await executeCommand(`tmux list-sessions -F '${fmt}' 2>/dev/null || true`);
      const lines = ls.stdout.split('\n').map(s => s.trim()).filter(Boolean);
      if (lines.length === 0) {
        return JSON.stringify({ count: 0, sessions: [], raw: ls.stdout, note: 'No tmux sessions running' }, null, 2);
      }

      const [lsof, ps, panes] = await Promise.all([
        executeCommand('lsof -nP -iTCP -sTCP:LISTEN -F pn 2>/dev/null || true'),
        executeCommand('ps -eo pid=,ppid= 2>/dev/null || true'),
        executeCommand(`tmux list-panes -a -F '#{session_name}|#{pane_pid}' 2>/dev/null || true`),
      ]);

      const pidToPorts = parseListenPorts(lsof.stdout);
      const children = parseProcTree(ps.stdout);
      const panePidsBySession = {};
      for (const line of panes.stdout.split('\n')) {
        const idx = line.indexOf('|');
        if (idx === -1) continue;
        const sess = line.slice(0, idx).trim();
        const pid = line.slice(idx + 1).trim();
        if (sess && pid) (panePidsBySession[sess] = panePidsBySession[sess] || []).push(pid);
      }

      const sessions = [];
      for (const line of lines) {
        const [name, created, attached, windows] = line.split('|');
        const pids = (panePidsBySession[name] || []).flatMap(pp => collectSubtree(children, pp));
        let port = null, listenPid = null;
        for (const pid of pids) {
          if (pidToPorts[pid] && pidToPorts[pid].size) {
            port = Math.min(...pidToPorts[pid]);
            listenPid = pid;
            break;
          }
        }
        let cwd = null;
        if (listenPid) {
          const cwdRes = await executeCommand(`readlink /proc/${listenPid}/cwd 2>/dev/null || true`);
          cwd = cwdRes.stdout.trim() || null;
        }
        sessions.push({
          name,
          running: true,
          status: 'active',
          port,
          pid: listenPid ? Number(listenPid) : (pids[0] ? Number(pids[0]) : null),
          cwd,
          attached: attached === '1',
          windows: Number(windows) || null,
          created: created ? new Date(Number(created) * 1000).toISOString() : null,
          description: SESSION_META[normalizeSession(name)] || null,
        });
      }
      sessions.sort((a, b) => (a.port ?? 1e9) - (b.port ?? 1e9));
      return JSON.stringify({ count: sessions.length, sessions, raw: ls.stdout }, null, 2);
    }

    case 'tmux_session_status': {
      // Resolve everything live: tmux presence, the port the session's process
      // subtree is listening on, and that listener's status — no static map.
      const listResult = await executeCommand(
        `tmux list-sessions -F '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}' 2>/dev/null | grep "^${args.session}|" || echo "Not running"`
      );
      const running = !listResult.stdout.includes('Not running') && listResult.stdout.trim() !== '';

      let port = null, listenPid = null, cwd = null, portStatus = null;
      if (running) {
        const [panes, ps, lsof] = await Promise.all([
          executeCommand(`tmux list-panes -a -F '#{session_name}|#{pane_pid}' 2>/dev/null || true`),
          executeCommand('ps -eo pid=,ppid= 2>/dev/null || true'),
          executeCommand('lsof -nP -iTCP -sTCP:LISTEN -F pn 2>/dev/null || true'),
        ]);
        const children = parseProcTree(ps.stdout);
        const pidToPorts = parseListenPorts(lsof.stdout);
        const panePids = [];
        for (const line of panes.stdout.split('\n')) {
          const idx = line.indexOf('|');
          if (idx === -1) continue;
          if (line.slice(0, idx).trim() === args.session) panePids.push(line.slice(idx + 1).trim());
        }
        const pids = panePids.flatMap(pp => collectSubtree(children, pp));
        for (const pid of pids) {
          if (pidToPorts[pid] && pidToPorts[pid].size) {
            port = Math.min(...pidToPorts[pid]);
            listenPid = pid;
            portStatus = 'listening';
            break;
          }
        }
        if (listenPid) {
          const cwdRes = await executeCommand(`readlink /proc/${listenPid}/cwd 2>/dev/null || true`);
          cwd = cwdRes.stdout.trim() || null;
        } else {
          portStatus = 'no listening port';
        }
      }

      return JSON.stringify({
        session: args.session,
        running,
        tmux_status: listResult.stdout,
        port,
        port_status: portStatus,
        pid: listenPid ? Number(listenPid) : null,
        cwd,
        description: SESSION_META[normalizeSession(args.session)] || null,
      }, null, 2);
    }

    case 'tmux_capture_logs': {
      const lines = args.lines || 100;
      const result = await executeCommand(
        `tmux capture-pane -p -t ${args.session} -S -${lines} 2>/dev/null || echo "Session not found"`
      );
      return result.stdout;
    }

    case 'service_status': {
      const result = await executeCommand(`lsof -ti:${args.port} 2>/dev/null || echo ""`);
      const pid = result.stdout.trim();
      let processInfo = null;
      if (pid) {
        const psResult = await executeCommand(`ps -p ${pid} -o pid,comm,args --no-headers 2>/dev/null || echo ""`);
        processInfo = psResult.stdout.trim();
      }
      return JSON.stringify({ port: args.port, status: pid ? 'listening' : 'not listening', pid: pid || null, process: processInfo }, null, 2);
    }

    case 'restart_service_safe': {
      const { session, port, directory, command } = args;
      await executeCommand(`tmux kill-session -t ${session} 2>/dev/null || echo "Session not found"`);
      await new Promise(r => setTimeout(r, 2000));
      await executeCommand(`lsof -ti:${port} | xargs kill -9 2>/dev/null || echo "Port free"`);
      await executeCommand(`tmux new-session -d -s ${session} -c ${directory} "${command}"`);
      await new Promise(r => setTimeout(r, 3000));
      const verify = await executeCommand(`tmux list-sessions | grep "^${session}:"`);
      return JSON.stringify({ session, success: verify.success, status: verify.stdout }, null, 2);
    }

    case 'get_claude_context': {
      const project = args.project || 'ps';
      try {
        return await readFile(`/srv/${project}/docs/CLAUDE.md`, 'utf-8');
      } catch {
        return `CLAUDE.md not found for project: ${project}`;
      }
    }

    case 'emergency_restart_all': {
      const result = await executeCommand('/srv/start-all-services.sh');
      return JSON.stringify({ message: 'Emergency restart initiated', output: result.stdout, success: result.success }, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Track active transports by session ID
const transports = {};

function createServer() {
  const server = new Server(
    { name: 'srv-manager', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  return server;
}

// Express app
const app = express();
app.use(cors());

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', transport: 'streamable-http', sessions: Object.keys(transports).length });
});

// MCP endpoint - handle all methods (auth enforced in-process)
app.post('/mcp', authenticate, express.json(), async (req, res) => {
  try {
    // Check for existing session
    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports[sessionId] : undefined;

    if (transport) {
      // Existing session
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // A session id was supplied but we don't have it (e.g. the server restarted
    // and the in-memory session map was lost). Per the MCP Streamable HTTP spec
    // we MUST answer 404 so the client drops the dead session and re-sends an
    // InitializeRequest WITHOUT a session id — otherwise it loops forever on
    // "Server not initialized" (400) replaying calls against a session we can
    // never resurrect.
    if (sessionId) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: req.body?.id ?? null,
      });
    }

    // New session - create transport and server
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
        console.log(`Session initialized: ${id}`);
      },
      onsessionclosed: (id) => {
        delete transports[id];
        console.log(`Session closed: ${id}`);
      },
    });

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Handle GET for SSE streams
app.get('/mcp', authenticate, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = transports[sessionId];
  if (!transport) {
    res.status(400).json({ error: 'No active session. Send an initialize request first.' });
    return;
  }
  await transport.handleRequest(req, res);
});

// Handle DELETE for session cleanup
app.delete('/mcp', authenticate, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = transports[sessionId];
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handleRequest(req, res);
});

// Bind to loopback only. Apache (mcp.madladslab.com) proxies from localhost
// and enforces the bearer token; never expose this port directly.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`MCP Streamable HTTP server running on 127.0.0.1:${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
