'use strict';

/**
 * global-chat — the Arcade-wide chat backing the global modal (one room).
 *
 * In-memory ring of the last N messages for instant history, plus a per-sender
 * rate limit. Screen names only (callers pass username.displayFor). No PII.
 * Ephemeral by design: history resets on restart (matches presence).
 *
 * A message: { id, from, surface, text, ts, admin }.
 */
const RING_MAX = 100;          // history depth kept in memory
const RATE_MS = 900;           // min gap between messages from one sender
const TEXT_MAX = 500;          // hard cap on message length

const ring = [];               // last RING_MAX messages (oldest -> newest)
const lastSent = new Map();    // platformId -> ts of last accepted message
let seq = 0;

function _clean(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
}

// Returns { ok, msg } | { ok:false, error }. `from` is a screen name.
function add({ platformId, from, surface = null, text, admin = false }) {
  const clean = _clean(text);
  if (!clean) return { ok: false, error: 'empty' };
  if (!platformId) return { ok: false, error: 'no identity' };
  const now = Date.now();
  const prev = lastSent.get(String(platformId)) || 0;
  if (now - prev < RATE_MS) return { ok: false, error: 'slow down' };
  lastSent.set(String(platformId), now);
  seq += 1;
  const msg = { id: seq, from: from || 'Player', surface: surface || null, text: clean, ts: now, admin: !!admin };
  ring.push(msg);
  if (ring.length > RING_MAX) ring.shift();
  return { ok: true, msg };
}

function history() { return ring.slice(); }

function clear() { ring.length = 0; return true; }

module.exports = { add, history, clear, RING_MAX, TEXT_MAX };
