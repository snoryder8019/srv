'use strict';

const crypto = require('crypto');

// In-memory broadcast store
const broadcasts = new Map();

function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getUserRole(user) {
  if (!user) return 'viewer';
  if (user.isAdmin === true) return 'superadmin';
  if (user.permissions && user.permissions.games === 'admin') return 'admin';
  return 'player';
}

function createBroadcast(host, game) {
  const code = generateCode();
  const role = getUserRole(host);
  const broadcast = {
    code,
    game, // 'rust', 'valheim', 'l4d2', '7dtd'
    host: {
      id: host._id.toString(),
      name: host.displayName || host.firstName || host.email,
      role,
      socketId: null, // set when broadcaster connects via socket
    },
    viewers: new Map(),     // authenticated viewers
    anonViewers: 0,         // anonymous viewer count
    banned: new Set(),
    muted: new Set(),
    messages: [],
    live: false,            // true once screen share is streaming
    createdAt: Date.now(),
  };
  broadcasts.set(code, broadcast);
  return broadcast;
}

function getBroadcast(code) {
  return broadcasts.get(code) || null;
}

function getBroadcastByGame(game) {
  for (const [, b] of broadcasts) {
    if (b.game === game) return b;
  }
  return null;
}

function setLive(code, socketId) {
  const b = broadcasts.get(code);
  if (!b) return null;
  b.live = true;
  b.host.socketId = socketId;
  return b;
}

function endBroadcast(code) {
  const b = broadcasts.get(code);
  if (!b) return null;
  broadcasts.delete(code);
  return b;
}

function addViewer(code, user) {
  const b = broadcasts.get(code);
  if (!b) return { error: 'Broadcast not found' };

  // Anonymous viewer
  if (!user) {
    b.anonViewers++;
    return { ok: true, anon: true, broadcast: b };
  }

  const uid = user._id.toString();
  if (b.banned.has(uid)) return { error: 'You are banned from this broadcast' };

  b.viewers.set(uid, {
    id: uid,
    name: user.displayName || user.firstName || user.email,
    role: getUserRole(user),
    joinedAt: Date.now(),
  });
  return { ok: true, broadcast: b };
}

function removeViewer(code, userId) {
  const b = broadcasts.get(code);
  if (!b) return;
  if (!userId) {
    b.anonViewers = Math.max(0, b.anonViewers - 1);
    return;
  }
  b.viewers.delete(userId);
}

function getViewerCount(code) {
  const b = broadcasts.get(code);
  if (!b) return 0;
  return b.viewers.size + b.anonViewers;
}

function canModerate(code, userId) {
  const b = broadcasts.get(code);
  if (!b) return false;
  if (b.host.id === userId) return true;
  const v = b.viewers.get(userId);
  return v && v.role === 'superadmin';
}

function kickViewer(code, modId, targetId) {
  if (!canModerate(code, modId)) return { error: 'Not authorized' };
  const b = broadcasts.get(code);
  if (!b) return { error: 'Broadcast not found' };
  if (targetId === b.host.id) return { error: 'Cannot kick the broadcaster' };
  b.viewers.delete(targetId);
  return { ok: true };
}

function muteViewer(code, modId, targetId) {
  if (!canModerate(code, modId)) return { error: 'Not authorized' };
  const b = broadcasts.get(code);
  if (!b) return { error: 'Broadcast not found' };
  if (b.muted.has(targetId)) {
    b.muted.delete(targetId);
    return { ok: true, muted: false };
  }
  b.muted.add(targetId);
  return { ok: true, muted: true };
}

function banViewer(code, modId, targetId) {
  if (!canModerate(code, modId)) return { error: 'Not authorized' };
  const b = broadcasts.get(code);
  if (!b) return { error: 'Broadcast not found' };
  if (targetId === b.host.id) return { error: 'Cannot ban the broadcaster' };
  b.viewers.delete(targetId);
  b.banned.add(targetId);
  return { ok: true };
}

function addMessage(code, userId, userName, userRole, text) {
  const b = broadcasts.get(code);
  if (!b) return null;
  if (b.muted.has(userId)) return { error: 'You are muted' };
  const msg = {
    id: crypto.randomBytes(4).toString('hex'),
    userId,
    name: userName,
    role: userRole,
    text,
    ts: Date.now(),
  };
  b.messages.push(msg);
  if (b.messages.length > 200) b.messages = b.messages.slice(-200);
  return msg;
}

function listBroadcasts() {
  const list = [];
  for (const [code, b] of broadcasts) {
    list.push({
      code,
      game: b.game,
      host: b.host.name,
      hostRole: b.host.role,
      viewers: b.viewers.size + b.anonViewers,
      live: b.live,
      createdAt: b.createdAt,
    });
  }
  return list;
}

function serializeBroadcast(b, includeMessages) {
  return {
    code: b.code,
    game: b.game,
    host: { id: b.host.id, name: b.host.name, role: b.host.role },
    viewers: Array.from(b.viewers.values()),
    viewerCount: b.viewers.size + b.anonViewers,
    muted: Array.from(b.muted),
    live: b.live,
    messages: includeMessages ? b.messages.slice(-50) : [],
    createdAt: b.createdAt,
  };
}

module.exports = {
  createBroadcast,
  getBroadcast,
  getBroadcastByGame,
  setLive,
  endBroadcast,
  addViewer,
  removeViewer,
  getViewerCount,
  kickViewer,
  muteViewer,
  banViewer,
  addMessage,
  listBroadcasts,
  serializeBroadcast,
  getUserRole,
  canModerate,
};
