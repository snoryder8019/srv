#!/usr/bin/env node

/**
 * MCP Server for /srv VM Management
 *
 * CRITICAL SAFETY RULES:
 * - NEVER use 'killall node' - kills all services!
 * - ALWAYS use tmux session management for service control
 * - Use /srv/start-all-services.sh for full restart
 * - Use lsof -ti:PORT | xargs kill -9 for specific port kills
 *
 * Purpose: Allow Claude Android app to safely manage VM services,
 * read files, execute commands, and monitor tmux sessions.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Security configuration
const ALLOWED_BASE_PATHS = ['/srv'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const COMMAND_TIMEOUT = 30000; // 30 seconds

// Known tmux sessions from CLAUDE.md
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
  { name: 'madThree', port: null, description: 'Mad Three service' }
];

// FORBIDDEN COMMANDS - Will reject immediately
const FORBIDDEN_COMMANDS = [
  'killall',
  'pkill -9',
  'rm -rf /',
  'dd if=',
  'mkfs',
  'reboot',
  'shutdown',
  'init 0',
  'init 6'
];

// Safe command whitelist
const SAFE_COMMANDS = [
  'ls', 'cat', 'grep', 'find', 'ps', 'lsof', 'netstat', 'ss',
  'tmux', 'git', 'node', 'npm', 'curl', 'wget', 'echo', 'pwd',
  'head', 'tail', 'wc', 'tree', 'pstree', 'systemctl status',
  'mongosh', 'mongo'
];

/**
 * Validate file path is within allowed directories
 */
function isPathAllowed(filePath) {
  const resolved = resolve(filePath);
  return ALLOWED_BASE_PATHS.some(basePath => resolved.startsWith(basePath));
}

/**
 * Check if command is forbidden
 */
function isForbiddenCommand(command) {
  return FORBIDDEN_COMMANDS.some(forbidden => command.includes(forbidden));
}

/**
 * Execute shell command safely
 */
async function executeCommand(command, timeout = COMMAND_TIMEOUT) {
  return new Promise((resolve, reject) => {
    // Safety check
    if (isForbiddenCommand(command)) {
      reject(new Error(`FORBIDDEN: Command contains dangerous operation. Never use: ${FORBIDDEN_COMMANDS.join(', ')}`));
      return;
    }

    const child = spawn('bash', ['-c', command], {
      cwd: '/srv',
      timeout: timeout,
      maxBuffer: 1024 * 1024 * 5 // 5MB output limit
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        success: code === 0
      });
    });

    child.on('error', (error) => {
      reject(new Error(`Command execution failed: ${error.message}`));
    });

    // Timeout handler
    setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);
  });
}

// Create MCP server
const server = new Server(
  {
    name: 'srv-manager',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'read_file',
        description: 'Read a file from /srv directory tree. Returns file contents.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute path to file (must start with /srv)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file in /srv directory tree. Creates file if it doesn\'t exist.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute path to file (must start with /srv)',
            },
            content: {
              type: 'string',
              description: 'Content to write to the file',
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_directory',
        description: 'List contents of a directory in /srv tree.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute path to directory (must start with /srv)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'execute_command',
        description: 'Execute a bash command safely. NEVER use "killall node" - it kills ALL services! Use tmux session management instead.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Command to execute. Forbidden: killall, rm -rf /, dd, mkfs, reboot, shutdown',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 30000)',
              default: 30000,
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'tmux_list_sessions',
        description: 'List all running tmux sessions with their status.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'tmux_session_status',
        description: 'Get detailed status of a specific tmux session.',
        inputSchema: {
          type: 'object',
          properties: {
            session: {
              type: 'string',
              description: 'Session name (e.g., ps, madladslab, game-state)',
            },
          },
          required: ['session'],
        },
      },
      {
        name: 'tmux_capture_logs',
        description: 'Capture recent output from a tmux session (last 100 lines).',
        inputSchema: {
          type: 'object',
          properties: {
            session: {
              type: 'string',
              description: 'Session name to capture logs from',
            },
            lines: {
              type: 'number',
              description: 'Number of lines to capture (default: 100)',
              default: 100,
            },
          },
          required: ['session'],
        },
      },
      {
        name: 'service_status',
        description: 'Check if a service is running on a specific port.',
        inputSchema: {
          type: 'object',
          properties: {
            port: {
              type: 'number',
              description: 'Port number to check (e.g., 3399 for ps, 3000 for madladslab)',
            },
          },
          required: ['port'],
        },
      },
      {
        name: 'restart_service_safe',
        description: 'Safely restart a service using tmux session kill and restart. NEVER uses killall.',
        inputSchema: {
          type: 'object',
          properties: {
            session: {
              type: 'string',
              description: 'Tmux session name (e.g., ps, madladslab)',
            },
            port: {
              type: 'number',
              description: 'Port number for the service',
            },
            directory: {
              type: 'string',
              description: 'Working directory for the service (e.g., /srv/ps)',
            },
            command: {
              type: 'string',
              description: 'Start command (e.g., "PORT=3399 npm start")',
            },
          },
          required: ['session', 'port', 'directory', 'command'],
        },
      },
      {
        name: 'get_claude_context',
        description: 'Get the CLAUDE.md context file for current project state and instructions.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project name (e.g., ps, madladslab)',
              default: 'ps',
            },
          },
        },
      },
      {
        name: 'emergency_restart_all',
        description: 'Emergency: Restart ALL services using /srv/start-all-services.sh. Use only when necessary!',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'read_file': {
        const filePath = args.path;
        if (!isPathAllowed(filePath)) {
          throw new Error(`Access denied: Path must be within ${ALLOWED_BASE_PATHS.join(', ')}`);
        }

        const stats = await stat(filePath);
        if (stats.size > MAX_FILE_SIZE) {
          throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`);
        }

        const content = await readFile(filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text',
              text: content,
            },
          ],
        };
      }

      case 'write_file': {
        const filePath = args.path;
        if (!isPathAllowed(filePath)) {
          throw new Error(`Access denied: Path must be within ${ALLOWED_BASE_PATHS.join(', ')}`);
        }

        await writeFile(filePath, args.content, 'utf-8');
        return {
          content: [
            {
              type: 'text',
              text: `Successfully wrote ${args.content.length} bytes to ${filePath}`,
            },
          ],
        };
      }

      case 'list_directory': {
        const dirPath = args.path;
        if (!isPathAllowed(dirPath)) {
          throw new Error(`Access denied: Path must be within ${ALLOWED_BASE_PATHS.join(', ')}`);
        }

        const files = await readdir(dirPath, { withFileTypes: true });
        const fileList = files.map(f => ({
          name: f.name,
          type: f.isDirectory() ? 'directory' : 'file',
          path: join(dirPath, f.name),
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(fileList, null, 2),
            },
          ],
        };
      }

      case 'execute_command': {
        const result = await executeCommand(args.command, args.timeout);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'tmux_list_sessions': {
        const result = await executeCommand('tmux ls 2>/dev/null || echo "No sessions"');
        const sessions = result.stdout.split('\n').filter(Boolean);

        const sessionInfo = KNOWN_SESSIONS.map(known => {
          const running = sessions.some(s => s.startsWith(known.name + ':'));
          return {
            ...known,
            running,
            status: running ? 'active' : 'stopped',
          };
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ sessions: sessionInfo, raw: result.stdout }, null, 2),
            },
          ],
        };
      }

      case 'tmux_session_status': {
        const session = args.session;
        const listResult = await executeCommand(`tmux list-sessions 2>/dev/null | grep "^${session}:" || echo "Not running"`);
        const portCheck = KNOWN_SESSIONS.find(s => s.name === session);

        let portStatus = null;
        if (portCheck && portCheck.port) {
          const portResult = await executeCommand(`lsof -ti:${portCheck.port} 2>/dev/null || echo ""`);
          portStatus = portResult.stdout ? 'listening' : 'not listening';
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                session,
                tmux_status: listResult.stdout,
                port: portCheck?.port,
                port_status: portStatus,
                running: !listResult.stdout.includes('Not running'),
              }, null, 2),
            },
          ],
        };
      }

      case 'tmux_capture_logs': {
        const session = args.session;
        const lines = args.lines || 100;
        const result = await executeCommand(
          `tmux capture-pane -p -t ${session} -S -${lines} 2>/dev/null || echo "Session not found or not accessible"`
        );

        return {
          content: [
            {
              type: 'text',
              text: result.stdout,
            },
          ],
        };
      }

      case 'service_status': {
        const port = args.port;
        const result = await executeCommand(`lsof -ti:${port} 2>/dev/null || echo ""`);
        const pid = result.stdout.trim();

        let processInfo = null;
        if (pid) {
          const psResult = await executeCommand(`ps -p ${pid} -o pid,comm,args --no-headers 2>/dev/null || echo ""`);
          processInfo = psResult.stdout.trim();
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                port,
                status: pid ? 'listening' : 'not listening',
                pid: pid || null,
                process: processInfo,
              }, null, 2),
            },
          ],
        };
      }

      case 'restart_service_safe': {
        const { session, port, directory, command } = args;

        // Step 1: Kill tmux session
        const killResult = await executeCommand(`tmux kill-session -t ${session} 2>/dev/null || echo "Session not found"`);

        // Step 2: Wait a moment
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3: Verify port is free
        const portCheck = await executeCommand(`lsof -ti:${port} | xargs kill -9 2>/dev/null || echo "Port free"`);

        // Step 4: Start new session
        const startResult = await executeCommand(
          `tmux new-session -d -s ${session} -c ${directory} "${command}"`
        );

        // Step 5: Verify it started
        await new Promise(resolve => setTimeout(resolve, 3000));
        const verifyResult = await executeCommand(`tmux list-sessions | grep "^${session}:"`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                session,
                steps: {
                  kill_tmux: killResult.stdout,
                  kill_port: portCheck.stdout,
                  start_new: startResult.success ? 'success' : startResult.stderr,
                  verify: verifyResult.stdout,
                },
                success: verifyResult.success,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_claude_context': {
        const project = args.project || 'ps';
        const contextPath = `/srv/${project}/docs/CLAUDE.md`;

        try {
          const content = await readFile(contextPath, 'utf-8');
          return {
            content: [
              {
                type: 'text',
                text: content,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `CLAUDE.md not found at ${contextPath}. Available projects: ps, madladslab`,
              },
            ],
          };
        }
      }

      case 'emergency_restart_all': {
        const result = await executeCommand('/srv/start-all-services.sh');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                message: 'Emergency restart initiated',
                output: result.stdout,
                stderr: result.stderr,
                success: result.success,
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
