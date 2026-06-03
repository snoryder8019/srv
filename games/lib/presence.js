'use strict';

/**
 * presence — who is currently active across the arcade, for private invites.
 *
 * Two kinds of presence, unified in one map:
 *  - socket presence: an open /presence socket on the games portal (landing page).
 *  - soft presence: a heartbeat from another arcade surface (e.g. matchmaking
 *    intake on match.madladslab.com), refreshed via the internal API. This lets
 *    a player be invitable while they're sitting in matchmaking, not just on the
 *    portal landing page.
 *
 * Public-facing data is screen name only (never real name/email) — callers pass
 * the value of username.displayFor(user). In-memory by design; resets on restart.
 */
const online = new Map(); // platformId -> { platformId, name, sockets:Set, lastSeen, softUntil }

const SOFT_TTL_MS = 45 * 1000; // a heartbeat keeps a soft presence alive this long

function ensure(pid, name) {
  let e = online.get(pid);
  if (!e) { e = { platformId: pid, name, sockets: new Set(), lastSeen: Date.now(), softUntil: 0 }; online.set(pid, e); }
  if (name) e.name = name;
  e.lastSeen = Date.now();
  return e;
}

function add(platformId, name, socketId) {
  const e = ensure(String(platformId), name);
  e.sockets.add(socketId);
  return e;
}

function remove(platformId, socketId) {
  const pid = String(platformId);
  const e = online.get(pid);
  if (!e) return;
  e.sockets.delete(socketId);
  if (e.sockets.size === 0 && (!e.softUntil || e.softUntil < Date.now())) online.delete(pid);
}

// Soft presence: heartbeat from another surface. Call repeatedly to keep alive.
function heartbeat(platformId, name) {
  const e = ensure(String(platformId), name);
  e.softUntil = Date.now() + SOFT_TTL_MS;
  return e;
}

function clearSoft(platformId) {
  const pid = String(platformId);
  const e = online.get(pid);
  if (!e) return;
  e.softUntil = 0;
  if (e.sockets.size === 0) online.delete(pid);
}

function activeEntry(e) {
  if (!e) return false;
  if (e.sockets.size) return true;
  if (e.softUntil && e.softUntil >= Date.now()) return true;
  return false;
}

function isOnline(platformId) { return activeEntry(online.get(String(platformId))); }

function socketsFor(platformId) {
  const e = online.get(String(platformId));
  return e ? [...e.sockets] : [];
}

// Public list (screen names only). Optionally exclude one platformId (the asker).
function list(excludePlatformId = null) {
  const ex = excludePlatformId != null ? String(excludePlatformId) : null;
  // opportunistic cleanup of expired soft entries with no sockets
  const now = Date.now();
  for (const [pid, e] of online) {
    if (e.sockets.size === 0 && (!e.softUntil || e.softUntil < now)) online.delete(pid);
  }
  return [...online.values()]
    .filter((e) => activeEntry(e) && e.platformId !== ex)
    .map((e) => ({ platformId: e.platformId, name: e.name }));
}

module.exports = { add, remove, heartbeat, clearSoft, isOnline, socketsFor, list };
