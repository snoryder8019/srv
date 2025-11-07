import express from 'express';
import { spawn } from 'child_process';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';

const router = express.Router();

// Security configuration
const ALLOWED_BASE_PATHS = ['/srv'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const COMMAND_TIMEOUT = 30000; // 30 seconds

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

const KNOWN_SESSIONS = [
  { name: 'ps', port: 3399, description: 'Stringborn Universe service' },
  { name: 'game-state', port: 3500, description: 'Game state service' },
  { name: 'madladslab', port: 3000, description: 'Main lab service' },
];

// Helper functions
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
      reject(new Error(`FORBIDDEN: Command contains dangerous operation`));
      return;
    }

    const child = spawn('bash', ['-c', command], {
      cwd: '/srv',
      timeout: timeout,
      maxBuffer: 1024 * 1024 * 5
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

    setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);
  });
}

// Routes

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List tmux sessions
router.get('/tmux/sessions', async (req, res) => {
  try {
    const result = await executeCommand('tmux ls 2>/dev/null || echo "No sessions"');
    const sessions = result.stdout.split('\n').filter(Boolean);

    const sessionInfo = KNOWN_SESSIONS.map(known => {
      const running = sessions.some(s => s.startsWith(known.name + ':'));
      return {
        ...known,
        running,
        status: running ? 'active' : 'stopped'
      };
    });

    res.json({ success: true, sessions: sessionInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session status
router.get('/tmux/session/:name', async (req, res) => {
  try {
    const session = req.params.name;
    const listResult = await executeCommand(`tmux list-sessions 2>/dev/null | grep "^${session}:" || echo "Not running"`);
    const portCheck = KNOWN_SESSIONS.find(s => s.name === session);

    let portStatus = null;
    if (portCheck && portCheck.port) {
      const portResult = await executeCommand(`lsof -ti:${portCheck.port} 2>/dev/null || echo ""`);
      portStatus = portResult.stdout ? 'listening' : 'not listening';
    }

    res.json({
      success: true,
      session,
      tmux_status: listResult.stdout,
      port: portCheck?.port,
      port_status: portStatus,
      running: !listResult.stdout.includes('Not running')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Capture session logs
router.get('/tmux/logs/:name', async (req, res) => {
  try {
    const session = req.params.name;
    const lines = parseInt(req.query.lines) || 100;
    const result = await executeCommand(
      `tmux capture-pane -p -t ${session} -S -${lines} 2>/dev/null || echo "Session not found"`
    );

    res.json({ success: true, logs: result.stdout });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Service status by port
router.get('/service/port/:port', async (req, res) => {
  try {
    const port = req.params.port;
    const result = await executeCommand(`lsof -ti:${port} 2>/dev/null || echo ""`);
    const pid = result.stdout.trim();

    let processInfo = null;
    if (pid) {
      const psResult = await executeCommand(`ps -p ${pid} -o pid,comm,args --no-headers 2>/dev/null || echo ""`);
      processInfo = psResult.stdout.trim();
    }

    res.json({
      success: true,
      port,
      status: pid ? 'listening' : 'not listening',
      pid: pid || null,
      process: processInfo
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read file
router.post('/read-file', async (req, res) => {
  try {
    const { path } = req.body;
    if (!isPathAllowed(path)) {
      return res.status(403).json({ error: 'Access denied: Path must be within /srv' });
    }

    const stats = await stat(path);
    if (stats.size > MAX_FILE_SIZE) {
      return res.status(413).json({ error: `File too large: ${stats.size} bytes` });
    }

    const content = await readFile(path, 'utf-8');
    res.json({ success: true, content, size: stats.size });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List directory
router.post('/list-directory', async (req, res) => {
  try {
    const { path } = req.body;
    if (!isPathAllowed(path)) {
      return res.status(403).json({ error: 'Access denied: Path must be within /srv' });
    }

    const files = await readdir(path, { withFileTypes: true });
    const fileList = files.map(f => ({
      name: f.name,
      type: f.isDirectory() ? 'directory' : 'file',
      path: join(path, f.name)
    }));

    res.json({ success: true, files: fileList });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute command
router.post('/execute', async (req, res) => {
  try {
    const { command, timeout } = req.body;
    const result = await executeCommand(command, timeout);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get CLAUDE.md context
router.get('/context', async (req, res) => {
  try {
    const project = req.query.project || 'ps';
    const contextPath = `/srv/${project}/docs/CLAUDE.md`;
    const content = await readFile(contextPath, 'utf-8');
    res.json({ success: true, content });
  } catch (error) {
    res.status(404).json({ error: `CLAUDE.md not found for project: ${req.query.project || 'ps'}` });
  }
});

router.get('/context/:project', async (req, res) => {
  try {
    const project = req.params.project;
    const contextPath = `/srv/${project}/docs/CLAUDE.md`;
    const content = await readFile(contextPath, 'utf-8');
    res.json({ success: true, content });
  } catch (error) {
    res.status(404).json({ error: `CLAUDE.md not found for project: ${project}` });
  }
});

export default router;
