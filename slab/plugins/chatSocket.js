/**
 * Slab — /chat Socket.IO namespace
 * ─────────────────────────────────────────────────────────────────────────────
 * A third namespace alongside /meetings and /live, wired the same way:
 *   • identify the user from the slab_token JWT cookie at connection
 *   • resolve the tenant DB from a `db` param on the join event (getTenantDb)
 *   • Mongo is the source of truth (plugins/chat.js); this only does live delivery
 *
 * Membership is enforced HERE, server-side, at join — feature-permission gets you
 * to the chat capability, but this decides which specific thread rooms you enter.
 *
 * Wire it in plugins/socketio.js, inside initSocketIO(server), before `return io;`:
 *     import { initChatNamespace } from './chatSocket.js';
 *     initChatNamespace(io);
 */

import jwt from 'jsonwebtoken';
import { getDb, getTenantDb } from './mongo.js';
import { config } from '../config/config.js';
import {
  ensureChatIndexes, getThread, canAccessThread, isThreadMember,
  postMessage, listMessages, dispatchAgent, chatbotEnabled,
  resolveAgentForThread, maybeRequestContact, saveContactSubmission,
} from './chat.js';

const room = (threadId) => 'thread:' + String(threadId);

// Build the canSeeFeature-style ctx from a decoded JWT. The JWT already carries
// isAdmin/isOwner/permissions in this codebase; superadmin + stage/opt-in gating
// is intentionally conservative here (feature inheritance still requires an
// explicit thread.context.module match plus a non-restricted admin).
function ctxFromUser(user) {
  return {
    isSuperAdmin: !!user?.isSuperAdmin,
    isOwner: !!user?.isOwner,
    userPermissions: Array.isArray(user?.permissions) ? user.permissions : [],
    featureStages: {},
    tenantOptIns: {},
  };
}

export function initChatNamespace(io) {
  const chat = io.of('/chat');

  chat.on('connection', (socket) => {
    // Identify the user from the JWT cookie (same pattern as /meetings, /live).
    let user = null;
    try {
      const m = (socket.handshake.headers.cookie || '').match(/slab_token=([^;]+)/);
      if (m) {
        const d = jwt.verify(m[1], config.JWT_SECRET);
        if (d?.isAdmin || d?.id) user = d;
      }
    } catch {}
    if (!user) { socket.emit('chat:error', { message: 'Sign in required.' }); return socket.disconnect(true); }

    socket.data.tenantDb = '';
    socket.data.rooms = new Set();

    const db = () => (socket.data.tenantDb ? getTenantDb(socket.data.tenantDb) : getDb());

    // ── Join a thread room ────────────────────────────────────────────────────
    socket.on('chat:join', async ({ threadId, db: dbName } = {}) => {
      try {
        if (dbName) socket.data.tenantDb = dbName;
        await ensureChatIndexes(db());

        const thread = await getThread(db(), threadId);
        if (!thread) return socket.emit('chat:error', { message: 'Thread not found.' });
        if (thread.status === 'archived') return socket.emit('chat:error', { message: 'This thread is archived.' });

        if (!canAccessThread(thread, user.id, ctxFromUser(user))) {
          return socket.emit('chat:error', { message: 'You do not have access to this thread.' });
        }

        socket.join(room(thread._id));
        socket.data.rooms.add(String(thread._id));

        const history = await listMessages(db(), thread._id, { limit: 50 });
        socket.emit('chat:joined', {
          threadId: String(thread._id),
          title: thread.title,
          kind: thread.kind,
          status: thread.status,
          canWrite: thread.status === 'active',
          messages: history,
        });
        socket.to(room(thread._id)).emit('chat:presence', { userId: user.id, name: user.displayName || user.email, state: 'joined' });
      } catch (err) {
        console.error('[chat] join error:', err);
        socket.emit('chat:error', { message: 'Could not open thread.' });
      }
    });

    // ── Send a message ────────────────────────────────────────────────────────
    socket.on('chat:message', async ({ threadId, body } = {}) => {
      try {
        if (!socket.data.rooms.has(String(threadId))) {
          return socket.emit('chat:error', { message: 'Join the thread before sending.' });
        }
        const text = String(body || '').trim();
        if (!text) return;

        const thread = await getThread(db(), threadId);
        if (!thread || thread.status !== 'active') {
          return socket.emit('chat:error', { message: 'This thread is locked.' });
        }
        // Re-check access on every write (membership can change mid-session).
        if (!canAccessThread(thread, user.id, ctxFromUser(user))) {
          return socket.emit('chat:error', { message: 'You do not have access to this thread.' });
        }

        const saved = await postMessage(db(), {
          threadId: thread._id,
          authorType: 'user',
          authorId: user.id,
          authorName: user.displayName || user.email || 'User',
          role: 'user',
          body: text,
        });
        chat.to(room(thread._id)).emit('chat:message', saved);

        // Contact capture — deterministic (flow-config gated, independent of the
        // chatbot toggle: it's a form, not an LLM reply).
        try {
          const flowAgent = await resolveAgentForThread(db(), thread);
          const formMsg = await maybeRequestContact(db(), thread, flowAgent);
          if (formMsg) chat.to(room(thread._id)).emit('chat:message', formMsg);
        } catch (e) { console.error('[chat] contact-capture error:', e.message); }

        // Fire the agent if the tenant chatbot toggle is on AND the resolved
        // agent for this thread is enabled. Reply is persisted + broadcast.
        let tenant = null;
        try { tenant = socket.data.tenantDb ? await getTenantMeta(socket.data.tenantDb) : null; } catch {}
        if (chatbotEnabled(tenant) || (!tenant && false)) {
          chat.to(room(thread._id)).emit('chat:agent-status', { threadId: String(thread._id), state: 'thinking' });
          const history = await listMessages(db(), thread._id, { limit: 25 });
          dispatchAgent(db(), {
            thread, tenant, history,
            onReply: (reply) => chat.to(room(thread._id)).emit('chat:message', reply),
          }).catch((e) => console.error('[chat] agent dispatch error:', e.message))
            .finally(() => chat.to(room(thread._id)).emit('chat:agent-status', { threadId: String(thread._id), state: 'idle' }));
        }
      } catch (err) {
        console.error('[chat] message error:', err);
        socket.emit('chat:error', { message: 'Message failed to send.' });
      }
    });

    // ── Contact form submission ───────────────────────────────────────────────
    socket.on('chat:form-submit', async ({ threadId, values, formMessageId } = {}) => {
      try {
        if (!socket.data.rooms.has(String(threadId))) {
          return socket.emit('chat:error', { message: 'Join the thread first.' });
        }
        const thread = await getThread(db(), threadId);
        if (!thread || thread.status !== 'active') {
          return socket.emit('chat:error', { message: 'This thread is locked.' });
        }
        if (!canAccessThread(thread, user.id, ctxFromUser(user))) {
          return socket.emit('chat:error', { message: 'You do not have access to this thread.' });
        }
        let tenantDomain = '';
        try { const t = socket.data.tenantDb ? await getTenantMeta(socket.data.tenantDb) : null; tenantDomain = t?.domain || ''; } catch {}
        const confirm = await saveContactSubmission(db(), { thread, values, formMessageId, tenantDomain });
        chat.to(room(thread._id)).emit('chat:contact-saved', { threadId: String(thread._id), formMessageId: formMessageId || null });
        chat.to(room(thread._id)).emit('chat:message', confirm);
      } catch (err) {
        socket.emit('chat:error', { message: err.message || 'Could not save contact info.' });
      }
    });

    // ── Paginate history (older messages) ─────────────────────────────────────
    socket.on('chat:history', async ({ threadId, before } = {}) => {
      try {
        if (!socket.data.rooms.has(String(threadId))) return;
        const older = await listMessages(db(), threadId, { before, limit: 50 });
        socket.emit('chat:history', { threadId: String(threadId), messages: older });
      } catch (err) {
        console.error('[chat] history error:', err);
      }
    });

    // ── Typing indicator (ephemeral, never persisted) ─────────────────────────
    socket.on('chat:typing', ({ threadId, state } = {}) => {
      if (!socket.data.rooms.has(String(threadId))) return;
      socket.to(room(threadId)).emit('chat:typing', {
        threadId: String(threadId), userId: user.id,
        name: user.displayName || user.email, state: state === 'start' ? 'start' : 'stop',
      });
    });

    socket.on('chat:leave', ({ threadId } = {}) => {
      socket.leave(room(threadId));
      socket.data.rooms.delete(String(threadId));
      socket.to(room(threadId)).emit('chat:presence', { userId: user.id, state: 'left' });
    });

    socket.on('disconnect', () => {
      for (const t of socket.data.rooms) {
        socket.to(room(t)).emit('chat:presence', { userId: user.id, state: 'left' });
      }
    });
  });

  return chat;
}

// The socket has the tenant DB name but not the tenant meta doc (public flags
// like chatbotEnabled live on the master `tenants` collection). Look it up by
// the tenant's db field. Cached lightly to avoid a hit per message.
const _tenantCache = new Map(); // dbName -> { tenant, at }
const TENANT_TTL = 60_000;
async function getTenantMeta(dbName) {
  const hit = _tenantCache.get(dbName);
  if (hit && Date.now() - hit.at < TENANT_TTL) return hit.tenant;
  const { getSlabDb } = await import('./mongo.js');
  const tenant = await getSlabDb().collection('tenants').findOne({ db: dbName });
  _tenantCache.set(dbName, { tenant, at: Date.now() });
  return tenant;
}
