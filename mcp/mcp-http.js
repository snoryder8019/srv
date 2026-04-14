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

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';

const PORT = process.env.MCP_PORT || 3650;

// Security configuration
const ALLOWED_BASE_PATHS = ['/srv'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const COMMAND_TIMEOUT = 30000;

const KNOWN_SESSIONS = [
  { name: 'ps', port: 3399, description: 'Stringborn Universe service' },
  { name: 'game-state', port: 3500, description: 'Game state service' },
  { name: 'madladslab', port: 3000, description: 'Main lab service' },
  { name: 'acm', port: null, description: 'ACM service' },
  { name: 'nocometalworkz', port: null, description: 'NoCoMetalWorkz service' },
  { name: 'sfg', port: null, description: 'SFG service' },
  { name: 'sna', port: null, description: 'SNA service' },
  { name: 'twww', port: null, description: 'TWWW service' },
  { name: 'w2portal', port: null, description: 'W2 Portal service' },
  { name: 'madThree', port: null, description: 'Mad Three service' },
  { name: 'opsTrain', port: 3603, description: 'OpsTrain service' },
  { name: 'bih', port: 3055, description: 'BIH gaming hub' },
  { name: 'w2marketing', port: 3601, description: 'W2 Marketing service' },
];

const FORBIDDEN_COMMANDS = [
  'killall', 'pkill -9', 'rm -rf /', 'dd if=', 'mkfs',
  'reboot', 'shutdown', 'init 0', 'init 6'
];

function isPathAllowed(filePath) {
  const resolved = resolve(filePath);
  return ALLOWED_BASE_PATHS.some(basePath => resolved.startsWith(basePath));
}

function isForbiddenCommand(command) {
  return FORBIDDEN_COMMANDS.some(forbidden => command.includes(forbidden));
}

async function executeCommand(command, timeout = COMMAND_TIMEOUT) {
  return new Promise((resolve, reject) => {
    if (isForbiddenCommand(command)) {
      reject(new Error(`FORBIDDEN: Command contains dangerous operation. Never use: ${FORBIDDEN_COMMANDS.join(', ')}`));
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
      const result = await executeCommand('tmux ls 2>/dev/null || echo "No sessions"');
      const sessions = result.stdout.split('\n').filter(Boolean);
      const sessionInfo = KNOWN_SESSIONS.map(known => ({
        ...known,
        running: sessions.some(s => s.startsWith(known.name + ':')),
        status: sessions.some(s => s.startsWith(known.name + ':')) ? 'active' : 'stopped',
      }));
      return JSON.stringify({ sessions: sessionInfo, raw: result.stdout }, null, 2);
    }

    case 'tmux_session_status': {
      const listResult = await executeCommand(`tmux list-sessions 2>/dev/null | grep "^${args.session}:" || echo "Not running"`);
      const portCheck = KNOWN_SESSIONS.find(s => s.name === args.session);
      let portStatus = null;
      if (portCheck?.port) {
        const portResult = await executeCommand(`lsof -ti:${portCheck.port} 2>/dev/null || echo ""`);
        portStatus = portResult.stdout ? 'listening' : 'not listening';
      }
      return JSON.stringify({
        session: args.session, tmux_status: listResult.stdout,
        port: portCheck?.port, port_status: portStatus,
        running: !listResult.stdout.includes('Not running'),
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

// MCP endpoint - handle all methods
app.post('/mcp', express.json(), async (req, res) => {
  try {
    // Check for existing session
    const sessionId = req.headers['mcp-session-id'];
    let transport = transports[sessionId];

    if (transport) {
      // Existing session
      await transport.handleRequest(req, res, req.body);
      return;
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
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = transports[sessionId];
  if (!transport) {
    res.status(400).json({ error: 'No active session. Send an initialize request first.' });
    return;
  }
  await transport.handleRequest(req, res);
});

// Handle DELETE for session cleanup
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = transports[sessionId];
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handleRequest(req, res);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP Streamable HTTP server running on port ${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
