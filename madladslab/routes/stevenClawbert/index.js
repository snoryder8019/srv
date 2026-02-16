import express from 'express';
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const execAsync = promisify(exec);

// === Auth Middleware ===
function isAdmin(req, res, next) {
  if (req.user && req.user.isAdmin === true) return next();
  // For API routes return JSON, for page return 401
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return res.status(401).send('Unauthorized');
}

// === Thread & Conversation Storage ===
const DATA_DIR = '/srv/madladslab/data/stevenClawbert';
const THREADS_DIR = path.join(DATA_DIR, 'threads');
const THREADS_INDEX = path.join(DATA_DIR, 'threads-index.json');
if (!fs.existsSync(THREADS_DIR)) fs.mkdirSync(THREADS_DIR, { recursive: true });

// Thread index: [{ id, name, createdAt, updatedAt, messageCount }]
function loadThreadIndex() {
  try {
    if (fs.existsSync(THREADS_INDEX)) return JSON.parse(fs.readFileSync(THREADS_INDEX, 'utf8'));
  } catch (e) { console.warn('Failed to load thread index:', e.message); }
  return [];
}

function saveThreadIndex(index) {
  fs.writeFileSync(THREADS_INDEX, JSON.stringify(index, null, 2), 'utf8');
}

function threadPath(threadId) {
  const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(THREADS_DIR, safe + '.json');
}

function loadThread(threadId) {
  const fp = threadPath(threadId);
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) { console.warn('Failed to load thread:', threadId, e.message); }
  return [];
}

function saveThread(threadId, messages) {
  fs.writeFileSync(threadPath(threadId), JSON.stringify(messages), 'utf8');
}

function deleteThreadFile(threadId) {
  const fp = threadPath(threadId);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
}

// Migrate old conversations to thread system on first load
function migrateOldConversations() {
  const oldDir = DATA_DIR;
  try {
    const files = fs.readdirSync(oldDir).filter(f => f.endsWith('.json') && f !== 'threads-index.json');
    if (files.length === 0) return;
    const index = loadThreadIndex();
    const existingIds = new Set(index.map(t => t.id));
    for (const file of files) {
      const fullPath = path.join(oldDir, file);
      // Skip directories
      if (fs.statSync(fullPath).isDirectory()) continue;
      const id = file.replace('.json', '');
      if (existingIds.has(id)) continue;
      try {
        const messages = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (Array.isArray(messages) && messages.length > 0) {
          // Move file to threads dir
          const dest = threadPath(id);
          fs.copyFileSync(fullPath, dest);
          index.push({
            id,
            name: 'Migrated: ' + id.substring(0, 20),
            createdAt: messages[0]?.timestamp || Date.now(),
            updatedAt: messages[messages.length - 1]?.timestamp || Date.now(),
            messageCount: messages.length
          });
        }
      } catch (e) { /* skip bad files */ }
    }
    saveThreadIndex(index);
  } catch (e) { console.warn('Migration check failed:', e.message); }
}
migrateOldConversations();

// Allowed openclaw subcommands for the command endpoint
const ALLOWED_COMMANDS = [
  'status', 'health', 'sessions list', 'agents list',
  'channels status', 'config get', 'logs'
];

// Helper: run openclaw CLI command
async function runOpenClaw(args, timeoutMs = 120000) {
  const cmd = `openclaw ${args}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 5,
      env: { ...process.env, NO_COLOR: '1' }
    });
    return { success: true, output: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout ? err.stdout.trim() : '',
      error: err.message,
      stderr: err.stderr ? err.stderr.trim() : ''
    };
  }
}

// Extract the agent's reply text from openclaw output
function extractAgentText(rawOutput) {
  if (!rawOutput) return null;

  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(rawOutput);

    // openclaw --json returns { payloads: [{ text: "..." }], meta: {...} }
    if (parsed.payloads && Array.isArray(parsed.payloads)) {
      const texts = parsed.payloads
        .map(p => p.text)
        .filter(Boolean);
      if (texts.length) return texts.join('\n');
    }

    // Fallback for other JSON shapes
    if (parsed.text) return parsed.text;
    if (parsed.reply) return parsed.reply;
    if (parsed.message && typeof parsed.message === 'string') return parsed.message;
    if (parsed.content) return parsed.content;
    if (parsed.response) return parsed.response;

    // If nothing matched, return a summary rather than the full dump
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Not JSON — clean up raw text output
  }

  // Filter out diagnostic/noise lines from stderr that leak into stdout
  const lines = rawOutput.split('\n');
  const cleaned = lines.filter(line => {
    const l = line.trim();
    if (!l) return false;
    if (l.startsWith('[diagnostic]')) return false;
    if (l.startsWith('Gateway agent failed; falling back')) return false;
    if (l.startsWith('FailoverError:')) return false;
    return true;
  }).join('\n').trim();

  return cleaned || rawOutput;
}

// GET / — Main interface
router.get('/', (req, res) => {
  res.render('stevenClawbert/index', {
    title: 'Steven Clawbert - OpenClaw Agent',
    user: req.user
  });
});

// POST /message — Send message to OpenClaw agent
router.post('/message', async (req, res) => {
  try {
    const { message, sessionId, deliver } = req.body;
    if (!message || !message.trim()) {
      return res.json({ success: false, error: 'Message is required' });
    }

    // Build command
    const escapedMsg = message.replace(/'/g, "'\\''");
    let cmd = `agent --agent main --message '${escapedMsg}' --json`;

    if (sessionId) {
      const escapedSid = sessionId.replace(/'/g, "'\\''");
      cmd += ` --session-id '${escapedSid}'`;
    }

    if (deliver) {
      cmd += ' --deliver';
    }

    cmd += ' --timeout 120';

    const result = await runOpenClaw(cmd, 130000);

    // Extract just the text response
    const fullOutput = result.output || result.stderr || result.error || '';
    const responseText = extractAgentText(fullOutput);

    // Track conversation
    const sid = sessionId || 'default';
    if (!conversations.has(sid)) {
      conversations.set(sid, []);
    }
    conversations.get(sid).push(
      { role: 'user', content: message, timestamp: Date.now() },
      { role: 'assistant', content: responseText, timestamp: Date.now() }
    );

    res.json({
      success: result.success,
      response: responseText,
      error: result.success ? null : (result.error || result.stderr)
    });
  } catch (err) {
    console.error('Steven Clawbert message error:', err);
    res.json({ success: false, error: err.message });
  }
});

// GET /status — OpenClaw status
router.get('/status', async (req, res) => {
  const result = await runOpenClaw('status', 15000);
  res.json(result);
});

// GET /health — Gateway health
router.get('/health', async (req, res) => {
  const result = await runOpenClaw('health', 10000);
  res.json(result);
});

// GET /sessions — List sessions
router.get('/sessions', async (req, res) => {
  const result = await runOpenClaw('sessions list', 10000);
  res.json(result);
});

// POST /command — Run allowed openclaw commands
router.post('/command', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) {
      return res.json({ success: false, error: 'Command is required' });
    }

    // Validate against allowlist
    const isAllowed = ALLOWED_COMMANDS.some(allowed =>
      command.trim().startsWith(allowed)
    );

    if (!isAllowed) {
      return res.json({
        success: false,
        error: `Command not allowed. Permitted: ${ALLOWED_COMMANDS.join(', ')}`
      });
    }

    const result = await runOpenClaw(command.trim(), 30000);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// GET /history — Get conversation history for a session
router.get('/history', (req, res) => {
  const sid = req.query.sessionId || 'default';
  const history = conversations.get(sid) || [];
  res.json({ success: true, history });
});

export default router;
