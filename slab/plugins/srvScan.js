/**
 * srvScan — live inventory of the /srv root.
 *
 * The superadmin overview's job is to oversee "the latest srv and the
 * directories inside srv". Rather than a hand-maintained list, this scans the
 * real /srv directory each request and overlays the curated SERVICES registry
 * (ports / domains / tmux names) where a directory matches a known service.
 *
 * A directory that isn't in the registry still shows up — flagged `registered:
 * false` — so newly-added apps appear automatically instead of going unseen.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SERVICES } from './serviceRegistry.js';

const SRV_ROOT = '/srv';

// Directories that are not services and only add noise to the overview.
const IGNORE = new Set([
  '_archive', '_shared', 'depricated', 'scripts', 'users', 'node_modules',
]);

/** Live tmux sessions as a Set of names. */
function getActiveSessions() {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' });
    return new Set(out.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Is something listening on this TCP port? */
function isPortOpen(port) {
  if (!port) return null;
  try {
    execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/** Read package.json name/version/scripts, tolerating malformed/missing files. */
function readPackage(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return {
      name: pkg.name || null,
      version: pkg.version || null,
      hasStart: !!(pkg.scripts && pkg.scripts.start),
    };
  } catch {
    return null;
  }
}

/** Git branch + last-commit timestamp/hash for a directory, if it's a repo. */
function readGit(dir) {
  // `-c safe.directory=*` avoids git's "dubious ownership" refusal when /srv/.git
  // is owned by a different user than the slab process (read-only log only).
  const G = `git -c safe.directory=* -C "${dir}"`;
  try {
    const meta = execSync(
      `${G} log -1 --format="%h%x00%cI%x00%s" 2>/dev/null`,
      { encoding: 'utf8' },
    ).trim();
    if (!meta) return null;
    const [hash, iso, subject] = meta.split('\0');
    let branch = null;
    try {
      branch = execSync(`${G} rev-parse --abbrev-ref HEAD 2>/dev/null`, { encoding: 'utf8' }).trim() || null;
    } catch {}
    return { hash: hash || null, committedAt: iso || null, subject: subject || null, branch };
  } catch {
    return null;
  }
}

/**
 * Scan /srv and return one entry per top-level directory, newest activity first.
 * @param {{ includeNoise?: boolean }} [opts]
 */
export function scanSrv({ includeNoise = false } = {}) {
  const sessions = getActiveSessions();
  const byDir = new Map(SERVICES.map(s => [s.dir, s]));

  let dirents = [];
  try {
    dirents = fs.readdirSync(SRV_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries = dirents
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .filter(d => includeNoise || !IGNORE.has(d.name))
    .map(d => {
      const dir = path.join(SRV_ROOT, d.name);
      const reg = byDir.get(dir) || null;
      const pkg = readPackage(dir);
      const git = readGit(dir);

      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(dir).mtimeMs; } catch {}

      const tmux = reg?.tmux || null;
      const alive = tmux ? sessions.has(tmux) : null;

      return {
        name: d.name,
        dir,
        registered: !!reg,
        category: reg?.category || (pkg ? 'unregistered' : 'other'),
        description: reg?.description || null,
        port: reg?.port || null,
        domain: reg?.domain || null,
        tmux,
        alive,
        portOpen: isPortOpen(reg?.port || null),
        isNodeApp: !!pkg,
        pkgName: pkg?.name || null,
        version: pkg?.version || null,
        git,
        mtimeMs,
      };
    });

  // "The latest srv" — surface most-recently-touched directories first, using
  // last git commit when available, otherwise the directory mtime.
  const activity = e => (e.git?.committedAt ? Date.parse(e.git.committedAt) : e.mtimeMs) || 0;
  entries.sort((a, b) => activity(b) - activity(a));
  return entries;
}

/** Summary counts for the overview header. */
export function scanSrvSummary(entries) {
  const list = entries || scanSrv();
  return {
    total: list.length,
    registered: list.filter(e => e.registered).length,
    unregistered: list.filter(e => !e.registered).length,
    running: list.filter(e => e.alive === true).length,
    down: list.filter(e => e.alive === false).length,
    nodeApps: list.filter(e => e.isNodeApp).length,
  };
}
