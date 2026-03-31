'use strict';

/**
 * Log Streamer — tails game server logs and emits raw lines via callback.
 * Used by admin Socket.IO namespace for real-time log viewing.
 */

const fs = require('fs');
const path = require('path');

const LOG_PATHS = {
  rust: [
    '/srv/games/rust/server/madlads/Log.EAC.txt',
    '/srv/games/rust/RustDedicated_Data/output_log.txt',
  ],
  valheim: ['/srv/games/valheim/logs/server.log'],
  l4d2: ['/srv/games/l4d2/logs/console.log'],
  '7dtd': ['/srv/games/7dtd/logs/output_log.txt'],
};

// Active streamers: { streamId: { timer, game, position } }
const active = new Map();

function getLogPath(game) {
  const paths = LOG_PATHS[game];
  if (!paths) return null;
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Start streaming log lines for a game.
 * @param {string} id - unique stream identifier (e.g., socket.id + game)
 * @param {string} game - game key
 * @param {function} onLines - callback(lines: string[]) called with new lines
 * @param {object} opts - { tail: number (initial lines to show), interval: ms }
 */
function startStream(id, game, onLines, opts) {
  const logPath = getLogPath(game);
  if (!logPath) {
    onLines(['[log] No log file found for ' + game]);
    return null;
  }

  const tail = (opts && opts.tail) || 80;
  const interval = (opts && opts.interval) || 1000;

  // Read last N lines initially
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const allLines = content.split('\n');
    const initial = allLines.slice(-tail).filter(l => l.trim());
    if (initial.length) onLines(initial);
  } catch (e) {
    onLines(['[log] Error reading log: ' + e.message]);
  }

  // Track file position from current end
  let position;
  try {
    position = fs.statSync(logPath).size;
  } catch (e) {
    position = 0;
  }

  // Poll for new lines
  const timer = setInterval(() => {
    try {
      const stat = fs.statSync(logPath);

      // Log rotated
      if (stat.size < position) {
        position = 0;
        onLines(['[log] --- Log rotated ---']);
      }

      if (stat.size <= position) return;

      const chunkSize = Math.min(stat.size - position, 128 * 1024);
      const buf = Buffer.alloc(chunkSize);
      const fd = fs.openSync(logPath, 'r');
      fs.readSync(fd, buf, 0, chunkSize, position);
      fs.closeSync(fd);
      position += chunkSize;

      const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
      if (lines.length) onLines(lines);
    } catch (e) {
      // File temporarily unavailable
    }
  }, interval);

  active.set(id, { timer, game });
  return id;
}

function stopStream(id) {
  const stream = active.get(id);
  if (stream) {
    clearInterval(stream.timer);
    active.delete(id);
  }
}

function stopAll() {
  for (const [id] of active) stopStream(id);
}

module.exports = { startStream, stopStream, stopAll, getLogPath };
