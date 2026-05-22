'use strict';

// Windrose MCP server — gives mod authors a scoped MCP endpoint to inspect
// runtime state and write Lua mods + UI overlay files. Hard-jailed to a
// whitelist of paths under /srv/games/windrose and /srv/games/public/windrose-build.
//
// Transport is implemented inline in routes/windrose-mcp.js — this module
// supplies the token store, path-jail, and tool/resource handlers.

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const GAMES_ROOT       = '/srv/games';
const WINDROSE_ROOT    = '/srv/games/windrose';
const MODS_ROOT        = '/srv/games/windrose/R5/Binaries/Win64/ue4ss/Mods';
const UE4SS_LOG        = '/srv/games/windrose/R5/Binaries/Win64/ue4ss/UE4SS.log';
const R5_LOG           = '/srv/games/windrose/R5/Saved/Logs/R5.log';
const SERVER_LOG       = '/srv/games/windrose/logs/server.log';
const PLUS_DATA_DIR    = '/srv/games/windrose/windrose_plus_data';
const PLUS_CONFIG      = '/srv/games/windrose/windrose_plus.json';
const MODS_TXT         = path.join(MODS_ROOT, 'mods.txt');
const UI_EXT_DIR       = '/srv/games/public/windrose-build';
const MAP_EXT_DIR      = '/srv/games/public/windrose-map';
const DOCS_DIR         = '/srv/games/windrose/docs';

// Paths the MCP can READ from. A request path is allowed if its resolved form
// starts with one of these prefixes.
const READ_ROOTS = [WINDROSE_ROOT, UI_EXT_DIR, MAP_EXT_DIR];

// Paths the MCP can WRITE to. Same prefix-match rule, plus an explicit
// allowlist of single files outside these roots that should be writable.
// DOCS_DIR is inside WINDROSE_ROOT (so it's already readable); we make it
// writable so mod authors can drop notes, design docs, mod READMEs alongside
// the server files without opening up the rest of the Windrose tree.
const WRITE_ROOTS = [MODS_ROOT, UI_EXT_DIR, MAP_EXT_DIR, DOCS_DIR];
const WRITE_FILES = new Set([PLUS_CONFIG, MODS_TXT]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;   // 2 MB write cap
const MAX_LOG_LINES  = 2000;
const MAX_LIST       = 500;
const TOKEN_BYTES    = 24;                // 192 bits, base64url-encoded
const TOKEN_PREFIX   = 'wr_';

let db = null;
let tokens = null;

function init(database) {
  db = database;
  tokens = db.collection('windrose_mcp_tokens');
  // Hashed-token lookup is the hot path; the unique index also de-dupes any
  // accidental collision before we even consult the random source.
  tokens.createIndex({ hash: 1 }, { unique: true }).catch(() => {});
  tokens.createIndex({ userId: 1 }).catch(() => {});
  // Make sure all writable dirs exist so first writes succeed.
  fsSync.mkdirSync(UI_EXT_DIR, { recursive: true });
  fsSync.mkdirSync(MAP_EXT_DIR, { recursive: true });
  fsSync.mkdirSync(DOCS_DIR, { recursive: true });
  console.log('[mcp] windrose MCP ready on POST /mcp/windrose (Bearer auth, ' + TOOLS.length + ' tools)');
}

// ── Token store ─────────────────────────────────────────────────────────────

function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

async function mintToken(userId, label) {
  const raw = TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const doc = {
    userId: typeof userId === 'string' ? new ObjectId(userId) : userId,
    label: String(label || 'mod-builder').slice(0, 80),
    hash: hashToken(raw),
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
    callCount: 0,
  };
  const r = await tokens.insertOne(doc);
  // Plaintext is returned ONCE — never persisted, never logged.
  return { id: r.insertedId.toString(), token: raw, label: doc.label, createdAt: doc.createdAt };
}

async function listTokensFor(userId) {
  const uid = typeof userId === 'string' ? new ObjectId(userId) : userId;
  const rows = await tokens.find({ userId: uid }).sort({ createdAt: -1 }).toArray();
  return rows.map(t => ({
    id: t._id.toString(),
    label: t.label,
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt,
    revokedAt: t.revokedAt,
    callCount: t.callCount || 0,
    active: !t.revokedAt,
  }));
}

async function revokeToken(userId, tokenId) {
  const uid = typeof userId === 'string' ? new ObjectId(userId) : userId;
  const r = await tokens.updateOne(
    { _id: new ObjectId(tokenId), userId: uid, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return r.modifiedCount > 0;
}

async function validateToken(raw) {
  if (!raw || typeof raw !== 'string' || !raw.startsWith(TOKEN_PREFIX)) return null;
  const t = await tokens.findOne({ hash: hashToken(raw), revokedAt: null });
  if (!t) return null;
  // Async metering — never block the request on the write.
  tokens.updateOne({ _id: t._id }, { $set: { lastUsedAt: new Date() }, $inc: { callCount: 1 } })
    .catch(() => {});
  return t;
}

// ── Path jail ───────────────────────────────────────────────────────────────

function _resolve(reqPath) {
  if (typeof reqPath !== 'string' || !reqPath.length) {
    throw new Error('path required');
  }
  // Resolve absolute. If the request is relative, treat it as relative to
  // WINDROSE_ROOT — that's the natural cwd for a mod author.
  const abs = path.isAbsolute(reqPath)
    ? path.resolve(reqPath)
    : path.resolve(WINDROSE_ROOT, reqPath);
  return abs;
}

function _underAny(abs, roots) {
  return roots.some(root => abs === root || abs.startsWith(root + path.sep));
}

function _assertReadable(reqPath) {
  const abs = _resolve(reqPath);
  if (!_underAny(abs, READ_ROOTS)) {
    throw new Error(`path not in read scope: ${reqPath}`);
  }
  return abs;
}

function _assertWritable(reqPath) {
  const abs = _resolve(reqPath);
  if (WRITE_FILES.has(abs)) return abs;
  if (_underAny(abs, WRITE_ROOTS)) return abs;
  throw new Error(`path not in write scope: ${reqPath}`);
}

// Symlink safety — if the resolved real path escapes scope, refuse. We do
// this after the prefix check (which is enough for honest paths) so that
// non-existent targets — common for fs_write creating new files — still pass.
async function _assertRealUnder(abs, roots, extraFiles) {
  try {
    const real = await fs.realpath(abs);
    if (extraFiles && extraFiles.has(real)) return;
    if (!_underAny(real, roots)) {
      throw new Error('symlink escape blocked');
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') return;  // new file is fine
    throw e;
  }
}

// ── Tool handlers ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'fs_list',
    description: 'List files and directories under a Windrose-scoped path. Roots: ' + READ_ROOTS.join(', '),
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or windrose-relative path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'fs_read',
    description: 'Read a UTF-8 text file from the Windrose scope. Cap: 2 MB.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'fs_write',
    description: 'Write (or create) a file under the Mods directory, the windrose-build UI overlay, or one of the allow-listed config files. Creates parent directories as needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string', description: 'UTF-8 text content. Cap: 2 MB.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'fs_delete',
    description: 'Delete a file under the write scope (Mods/, windrose-build/). Refuses directories.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'fs_mkdir',
    description: 'Create a directory under the write scope. Recursive.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_mods',
    description: 'List UE4SS mods with their enabled state (parsed from mods.txt).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_mod_enabled',
    description: 'Enable or disable a UE4SS mod by editing mods.txt.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['name', 'enabled'],
    },
  },
  {
    name: 'tail_log',
    description: 'Tail a Windrose log. name = "ue4ss" | "r5" | "server".',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['ue4ss', 'r5', 'server'] },
        lines: { type: 'number', default: 200 },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_server_status',
    description: 'Read the live WindrosePlus server_status.json snapshot.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_livemap',
    description: 'Read the live WindrosePlus livemap_data.json (player/mob positions).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_pois',
    description: 'Read the POI scan (pois.json) — top-down view of every discovered POI on the map.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_world_census',
    description: 'Read poi_discovered_classes.json — the class census from MadLadsStats.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_events',
    description: 'Query the windrose game_events collection. Returns up to 200 most recent matching events.',
    inputSchema: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string' }, description: 'Filter to these event types (optional).' },
        since: { type: 'string', description: 'ISO timestamp lower bound (optional).' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'get_players',
    description: 'Recent player_stats rows for windrose, most-recently-seen first.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 50 } },
    },
  },
  {
    name: 'read_plus_config',
    description: 'Read /srv/games/windrose/windrose_plus.json.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'write_plus_config',
    description: 'Write a NEW windrose_plus.json. The caller is responsible for sending the full, valid JSON object (no merging on the server side).',
    inputSchema: {
      type: 'object',
      properties: { config: { type: 'object' } },
      required: ['config'],
    },
  },
  {
    name: 'whoami',
    description: 'Server-side introspection for the current MCP session. Returns the token label your call arrived with, the read/write paths the path-jail accepts, and a list of tool names. Useful for the client to confirm wiring is correct without making any state changes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_rcon',
    description: 'Send an admin command to the WindrosePlus RCON spool (file-based IPC, not TCP) and wait up to ~30s for the response. The Lua mod polls the spool every 1-5s. Examples: "wp.mapgen" (capture terrain), "wp.mapexport" (trigger C++ heightmap export), "wp.help", "wp.players". Returns {status, message} from the Lua handler. RCON password comes from the server config — the MCP supplies it; you do not need to.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The full command including args, e.g. "wp.mapgen" or "wp.kick playername reason"' },
        timeoutMs: { type: 'number', description: 'Max time to wait for the response file. Default 30000.', default: 30000 },
      },
      required: ['command'],
    },
  },
  {
    name: 'restart_server',
    description: 'Restart ONLY the Windrose game server (its dedicated tmux session). Use this after editing Lua files under Mods/ — UE4SS does not hot-reload. WARNING: any players currently in-game are disconnected. The whole restart takes ~30-60s (kill tmux session → fresh tmux + Proton-GE + UE5 boot → UE4SS injection → WindrosePlus + other mods load). Returns a status block plus instructions for verifying the restart completed cleanly. Safety: this tool kills exactly one named tmux session (`windrose`, owned by user `gs-windrose`) and respawns it via the windrose start script — it never touches node, the games portal, or any other game server.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Short freeform reason that gets logged ("query.lua yaw patch", "tile gen retry", etc.)' },
      },
    },
  },
];

async function tool_fs_list({ path: p }) {
  const abs = _assertReadable(p);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const out = entries.slice(0, MAX_LIST).map(e => ({
    name: e.name,
    type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file',
  }));
  // Decorate with size for files (best-effort — skip on error).
  await Promise.all(out.map(async (row) => {
    if (row.type !== 'file') return;
    try {
      const st = await fs.stat(path.join(abs, row.name));
      row.size = st.size;
      row.mtime = st.mtime.toISOString();
    } catch (_e) {}
  }));
  return { path: abs, truncated: entries.length > MAX_LIST, entries: out };
}

async function tool_fs_read({ path: p }) {
  const abs = _assertReadable(p);
  await _assertRealUnder(abs, READ_ROOTS);
  const st = await fs.stat(abs);
  if (st.isDirectory()) throw new Error('path is a directory');
  if (st.size > MAX_FILE_BYTES) {
    throw new Error(`file too large (${st.size} bytes > ${MAX_FILE_BYTES})`);
  }
  const content = await fs.readFile(abs, 'utf8');
  return { path: abs, size: st.size, content };
}

async function tool_fs_write({ path: p, content }) {
  const abs = _assertWritable(p);
  await _assertRealUnder(abs, WRITE_ROOTS, WRITE_FILES);
  if (typeof content !== 'string') throw new Error('content must be a string');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    throw new Error(`content too large (cap ${MAX_FILE_BYTES} bytes)`);
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  const st = await fs.stat(abs);
  return { path: abs, size: st.size, wrote: true };
}

async function tool_fs_delete({ path: p }) {
  const abs = _assertWritable(p);
  await _assertRealUnder(abs, WRITE_ROOTS, WRITE_FILES);
  const st = await fs.stat(abs);
  if (st.isDirectory()) throw new Error('refusing to delete a directory');
  await fs.unlink(abs);
  return { path: abs, deleted: true };
}

async function tool_fs_mkdir({ path: p }) {
  const abs = _assertWritable(p);
  await fs.mkdir(abs, { recursive: true });
  return { path: abs, created: true };
}

async function tool_list_mods() {
  // mods.txt is the source of truth for what UE4SS loads. We also surface
  // dirs that exist on disk but aren't in mods.txt — those are "uncalled mods"
  // and a common source of "why isn't my mod loading" questions.
  let txt = '';
  try { txt = await fs.readFile(MODS_TXT, 'utf8'); } catch (_e) {}
  const lines = txt.split(/\r?\n/);
  const declared = [];
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(.+?)\s*:\s*(0|1)\s*$/);
    if (!m) continue;
    declared.push({ name: m[1].trim(), enabled: m[2] === '1' });
  }

  let dirs = [];
  try {
    dirs = (await fs.readdir(MODS_ROOT, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (_e) {}

  const known = new Set(declared.map(d => d.name));
  const undeclared = dirs.filter(d => !known.has(d));

  return {
    modsTxt: MODS_TXT,
    modsRoot: MODS_ROOT,
    declared,
    onDiskButNotDeclared: undeclared,
  };
}

async function tool_set_mod_enabled({ name, enabled }) {
  if (!name || typeof name !== 'string') throw new Error('name required');
  let txt = '';
  try { txt = await fs.readFile(MODS_TXT, 'utf8'); } catch (_e) {}
  const lines = txt.split(/\r?\n/);
  let found = false;
  const flag = enabled ? '1' : '0';
  const out = lines.map(line => {
    // Comments and blank lines pass through.
    const stripped = line.replace(/;.*$/, '').trim();
    if (!stripped) return line;
    const m = stripped.match(/^(.+?)\s*:\s*(0|1)\s*$/);
    if (!m || m[1].trim() !== name) return line;
    found = true;
    return `${name} : ${flag}`;
  });
  if (!found) out.push(`${name} : ${flag}`);
  await fs.writeFile(MODS_TXT, out.join('\n'), 'utf8');
  return { name, enabled: !!enabled, added: !found, modsTxt: MODS_TXT };
}

async function tool_tail_log({ name, lines }) {
  const file = name === 'ue4ss' ? UE4SS_LOG
             : name === 'r5'    ? R5_LOG
             : name === 'server' ? SERVER_LOG
             : null;
  if (!file) throw new Error('name must be ue4ss|r5|server');
  const n = Math.max(1, Math.min(MAX_LOG_LINES, Number(lines) || 200));
  let buf;
  try { buf = await fs.readFile(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { file, lines: [], note: 'log not on disk yet' };
    throw e;
  }
  const all = buf.split(/\r?\n/);
  const tail = all.slice(-n);
  return { file, returned: tail.length, total: all.length, lines: tail };
}

async function _readJsonOptional(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function tool_get_server_status() {
  return await _readJsonOptional(path.join(PLUS_DATA_DIR, 'server_status.json')) || { note: 'not on disk' };
}

async function tool_get_livemap() {
  return await _readJsonOptional(path.join(PLUS_DATA_DIR, 'livemap_data.json')) || { note: 'not on disk' };
}

async function tool_get_pois() {
  return await _readJsonOptional(path.join(PLUS_DATA_DIR, 'pois.json')) || { note: 'not on disk' };
}

async function tool_get_world_census() {
  return await _readJsonOptional(path.join(PLUS_DATA_DIR, 'poi_discovered_classes.json')) || { note: 'not on disk' };
}

async function tool_get_events({ types, since, limit } = {}) {
  const q = { game: 'windrose' };
  if (Array.isArray(types) && types.length) q.type = { $in: types };
  if (since) {
    const d = new Date(since);
    if (!isNaN(d.getTime())) q.ts = { $gte: d };
  }
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await db.collection('game_events').find(q).sort({ ts: -1 }).limit(n).toArray();
  return { count: rows.length, events: rows };
}

async function tool_get_players({ limit } = {}) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await db.collection('player_stats')
    .find({ game: 'windrose' })
    .sort({ lastSeen: -1 })
    .limit(n)
    .toArray();
  return { count: rows.length, players: rows };
}

async function tool_read_plus_config() {
  return await _readJsonOptional(PLUS_CONFIG) || {};
}

async function tool_restart_server({ reason } = {}) {
  // Lazy-load the windrose lib so its own setup code (cron checks, etc.)
  // doesn't run when the MCP module is imported.
  const windrose = require('./windrose');
  // SAFETY: lib/windrose.js's restartServer() only touches the named tmux
  // session `windrose` for user `gs-windrose`, and respawns it via the
  // windrose start script. It does NOT run killall, pkill, or touch any
  // other tmux session, node process, or game server. Do not replace this
  // with a shell invocation — keep it routed through the lib so that
  // safety invariant is enforced in one place.
  const r = windrose.restartServer();
  const reasonText = (reason || '').toString().slice(0, 200) || 'no reason given';
  console.log('[mcp] windrose RESTART triggered via MCP — reason:', reasonText);
  return {
    action: 'restart_server',
    status: 'ok',
    reason: reasonText,
    libResult: r,
    scope: {
      tmuxUser: 'gs-windrose',
      tmuxSession: 'windrose',
      script: '/srv/games/start-windrose.sh',
    },
    nextSteps: [
      'Wait ~30-60s for the UE5 server to boot and UE4SS to inject mods.',
      'tail_log({ name: "ue4ss", lines: 50 }) — confirm UE4SS attached and your mods initialised.',
      'tail_log({ name: "r5", lines: 30 })   — confirm UE5 finished its boot sequence.',
      'get_events({ types: ["mod_boot", "config.load"], limit: 5 }) — confirm WindrosePlus reloaded the config.',
      'get_server_status() — confirm the live snapshot updates (player_count + invite_code reappear).',
    ],
    notes: [
      'Players who were in-game when this was called have been disconnected. They need to rejoin via the invite code once boot completes.',
      'If after 60s tail_log({name:"ue4ss"}) still shows nothing new, the start script may have failed — ask the admin.',
      'config.load.fail in get_events means your windrose_plus.json edit broke the schema; fix and restart again.',
    ],
  };
}

async function tool_send_rcon({ command, timeoutMs }) {
  if (!command || typeof command !== 'string') throw new Error('command (string) required');
  const cfg = await _readJsonOptional(PLUS_CONFIG);
  const password = cfg && cfg.rcon && cfg.rcon.password;
  if (!password) throw new Error('RCON password not set in windrose_plus.json — admin must enable it');

  const spoolDir = path.join(PLUS_DATA_DIR, 'rcon');
  const id = 'mcp_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const cmdName = `cmd_${id}.json`;
  const cmdPath = path.join(spoolDir, cmdName);
  const resPath = path.join(spoolDir, `res_${id}.json`);
  const indexPath = path.join(spoolDir, 'pending_commands.txt');

  const payload = {
    id,
    command,
    password,
    admin_user: 'mcp',
    timestamp: Math.floor(Date.now() / 1000),
  };

  await fs.mkdir(spoolDir, { recursive: true });
  // Atomic write: temp + rename so the Lua poller doesn't read a partial file.
  const tmp = cmdPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8');
  await fs.rename(tmp, cmdPath);
  // Append filename to the index so the Lua poller sees it.
  await fs.appendFile(indexPath, cmdName + '\r\n', 'utf8');

  // Poll for the response file.
  const deadline = Date.now() + (Number(timeoutMs) || 30000);
  while (Date.now() < deadline) {
    try {
      const text = await fs.readFile(resPath, 'utf8');
      const json = JSON.parse(text);
      // Clean up both files — Lua leaves them behind.
      fs.unlink(resPath).catch(() => {});
      fs.unlink(cmdPath).catch(() => {});
      return { command, ...json };
    } catch (_e) { /* not yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return { command, id, status: 'timeout', message: 'No response file within timeout. The RCON poller may be idle or the command rejected.' };
}

async function tool_whoami(_args, ctx) {
  const tok = ctx && ctx.token;
  return {
    token: tok ? {
      label: tok.label || 'unlabeled',
      id: String(tok._id),
      callCount: tok.callCount || 0,
      lastUsedAt: tok.lastUsedAt,
    } : null,
    scope: {
      readRoots:  READ_ROOTS,
      writeRoots: WRITE_ROOTS,
      writableFiles: Array.from(WRITE_FILES),
    },
    paths: {
      WINDROSE_ROOT, MODS_ROOT, UI_EXT_DIR, MAP_EXT_DIR, PLUS_CONFIG, MODS_TXT,
      UE4SS_LOG, R5_LOG, SERVER_LOG, PLUS_DATA_DIR,
    },
    tools: TOOLS.map(t => t.name),
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverTime: new Date().toISOString(),
  };
}

async function tool_write_plus_config({ config }) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('config must be a JSON object');
  }
  const text = JSON.stringify(config, null, 2);
  await fs.writeFile(PLUS_CONFIG, text, 'utf8');
  return { path: PLUS_CONFIG, bytes: Buffer.byteLength(text, 'utf8') };
}

const TOOL_IMPL = {
  fs_list: tool_fs_list,
  fs_read: tool_fs_read,
  fs_write: tool_fs_write,
  fs_delete: tool_fs_delete,
  fs_mkdir: tool_fs_mkdir,
  list_mods: tool_list_mods,
  set_mod_enabled: tool_set_mod_enabled,
  tail_log: tool_tail_log,
  get_server_status: tool_get_server_status,
  get_livemap: tool_get_livemap,
  get_pois: tool_get_pois,
  get_world_census: tool_get_world_census,
  get_events: tool_get_events,
  get_players: tool_get_players,
  read_plus_config: tool_read_plus_config,
  write_plus_config: tool_write_plus_config,
  whoami: tool_whoami,
  send_rcon: tool_send_rcon,
  restart_server: tool_restart_server,
};

// ── Resources ──────────────────────────────────────────────────────────────
// Tiny set of static resources so MCP clients that prefer resources/* over
// tools/* still see something useful at the boot of a session.

const RESOURCES = [
  { uri: 'windrose://config/plus',        name: 'WindrosePlus config',         mimeType: 'application/json' },
  { uri: 'windrose://state/server',       name: 'Live server status',          mimeType: 'application/json' },
  { uri: 'windrose://state/livemap',      name: 'Live player/mob positions',   mimeType: 'application/json' },
  { uri: 'windrose://state/pois',         name: 'POI scan',                    mimeType: 'application/json' },
  { uri: 'windrose://state/census',       name: 'Class census',                mimeType: 'application/json' },
  { uri: 'windrose://logs/ue4ss',         name: 'UE4SS log (last 500 lines)',  mimeType: 'text/plain' },
  { uri: 'windrose://mods/list',          name: 'mods.txt + on-disk diff',     mimeType: 'application/json' },
];

async function readResource(uri) {
  switch (uri) {
    case 'windrose://config/plus':    return JSON.stringify(await tool_read_plus_config(), null, 2);
    case 'windrose://state/server':   return JSON.stringify(await tool_get_server_status(), null, 2);
    case 'windrose://state/livemap':  return JSON.stringify(await tool_get_livemap(), null, 2);
    case 'windrose://state/pois':     return JSON.stringify(await tool_get_pois(), null, 2);
    case 'windrose://state/census':   return JSON.stringify(await tool_get_world_census(), null, 2);
    case 'windrose://logs/ue4ss':     return (await tool_tail_log({ name: 'ue4ss', lines: 500 })).lines.join('\n');
    case 'windrose://mods/list':      return JSON.stringify(await tool_list_mods(), null, 2);
  }
  throw new Error(`unknown resource: ${uri}`);
}

// ── MCP JSON-RPC dispatcher ────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = '2025-06-18';

async function dispatch(message, ctx) {
  const { id, method, params } = message || {};

  // Notifications carry no id and never get a response.
  const isNotification = id === undefined || id === null;

  try {
    let result;
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
          },
          serverInfo: {
            name: 'windrose-mcp',
            version: '0.1.0',
          },
          instructions: [
            'Windrose modding MCP. Read/write is jailed to Mods/, the UI overlay',
            '(public/windrose-build/), windrose_plus.json, and mods.txt.',
            '',
            'BEFORE anything else, call:',
            '  fs_read({ path: "/srv/games/windrose/MCP_HANDOFF.md" })',
            'That file is the source of truth for what you can do, the engine',
            'caveats (UE4SS hook reliability, no SteamID, which events do/don\'t',
            'fire), the UI-overlay convention, and a first-connect checklist.',
          ].join('\n'),
        };
        break;

      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/progress':
        return null; // ignore

      case 'ping':
        result = {};
        break;

      case 'tools/list':
        result = { tools: TOOLS };
        break;

      case 'tools/call': {
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        const fn = TOOL_IMPL[name];
        if (!fn) throw new Error(`unknown tool: ${name}`);
        // ctx is forwarded so tools like whoami can introspect the caller.
        const value = await fn(args, ctx);
        result = {
          content: [
            { type: 'text', text: JSON.stringify(value, null, 2) },
          ],
        };
        break;
      }

      case 'resources/list':
        result = { resources: RESOURCES };
        break;

      case 'resources/read': {
        const uri = params && params.uri;
        const text = await readResource(uri);
        result = {
          contents: [
            { uri, mimeType: uri.endsWith('ue4ss') ? 'text/plain' : 'application/json', text },
          ],
        };
        break;
      }

      case 'prompts/list':
        result = { prompts: [] };
        break;

      default:
        throw Object.assign(new Error(`method not found: ${method}`), { jsonrpcCode: -32601 });
    }

    if (isNotification) return null;
    return { jsonrpc: '2.0', id, result };
  } catch (e) {
    if (isNotification) return null;
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: e.jsonrpcCode || -32000,
        message: e.message || 'internal error',
      },
    };
  }
}

module.exports = {
  init,
  mintToken,
  listTokensFor,
  revokeToken,
  validateToken,
  dispatch,
  // Exposed for the build-tab UI
  paths: {
    WINDROSE_ROOT, MODS_ROOT, UI_EXT_DIR, MAP_EXT_DIR, DOCS_DIR,
    PLUS_CONFIG, MODS_TXT, UE4SS_LOG, R5_LOG, SERVER_LOG, PLUS_DATA_DIR,
  },
  TOOLS,
  RESOURCES,
};
