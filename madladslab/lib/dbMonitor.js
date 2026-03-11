/**
 * DB I/O Monitor
 * Tracks Mongoose reads/writes across Agent and AgentAction models
 * and broadcasts live events to the /agents socket namespace.
 *
 * Usage:
 *   import { track } from './dbMonitor.js';
 *   track('read' | 'write', collectionName, agentId?, label?)
 */

let _io = null;
const _recent = [];
const MAX_EVENTS = 60;

// Per-collection cooldown for reads to prevent flooding (ms)
const READ_COOLDOWN_MS = 1500;
const _lastRead = {};

export function init(io) {
  _io = io;
}

export function track(op, collection, agentId = null, label = null) {
  if (!_io) return;

  // Throttle reads per collection to avoid noise on high-frequency polling
  if (op === 'read') {
    const now = Date.now();
    if (_lastRead[collection] && now - _lastRead[collection] < READ_COOLDOWN_MS) return;
    _lastRead[collection] = now;
  }

  const event = { op, collection, agentId, label, ts: Date.now() };
  _recent.unshift(event);
  if (_recent.length > MAX_EVENTS) _recent.pop();

  _io.of('/agents').to('db-monitor').emit('db:event', event);
}

export function getRecent() {
  return [..._recent];
}
