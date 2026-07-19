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

// The /chat namespace, stashed at init so HTTP routes (the public support bubble
// posts over HTTP, not the socket) can push guest messages into the live room —
// that's the bridge that lets an admin watch/intercept a guest conversation.
let _chatNsp = null;
export function chatBroadcast(threadId, event, payload) {
  try { if (_chatNsp) _chatNsp.to(room(threadId)).emit(event, payload); } catch { /* never throws into a route */ }
}

// Push a tenant-wide in-panel alert to every admin currently on the panel (they
// auto-join `admin:<db>` on connect). Used for new-visitor chats + captured leads
// so the flash fires wherever the admin is, not only inside an open thread.
const adminRoom = (tenantDb) => 'admin:' + String(tenantDb);
export function adminAlert(tenantDb, payload) {
  try { if (_chatNsp && tenantDb) _chatNsp.to(adminRoom(tenantDb)).emit('admin:alert', payload); } catch { /* never throws into a route */ }
}

// The staff member's first name, for the guest-facing "X is joining" notice and
// staff message labels — we don't expose full names/emails to visitors.
function firstNameOf(user) {
  const dn = String(user?.displayName || '').trim();
  if (dn) return dn.split(/\s+/)[0];
  const em = String(user?.email || '').trim();
  if (em) return em.split('@')[0];
  return 'A teammate';
}

// Build the canSeeFeature-style ctx from a decoded JWT. The JWT already carries
// isAdmin/isOwner/permissions in this codebase; superadmin + stage/opt-in gating
// is intentionally conservative here (feature inheritance still requires an
// explicit thread.context.module match plus a non-restricted admin).
function ctxFromUser(user) {
  return {
    isSuperAdmin: !!user?.isSuperAdmin,
    // A tenant admin is owner-level for their OWN tenant's threads — mirrors the
    // HTTP chat control, which grants isOwner to anyone who can load the page so
    // staff can review/intercept support conversations. Cross-tenant reach is
    // blocked separately by binding the socket DB to the JWT's tenantDb (below).
    isOwner: !!(user?.isOwner || user?.isAdmin),
    userPermissions: Array.isArray(user?.permissions) ? user.permissions : [],
    featureStages: {},
    tenantOptIns: {},
  };
}

export function initChatNamespace(io) {
  const chat = io.of('/chat');
  _chatNsp = chat;

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

    // Tenant-wide admin room: every signed-in admin joins on connect so in-panel
    // alerts reach whoever's on the panel, regardless of which thread (if any)
    // they have open. The room is keyed to the admin's OWN JWT tenant.
    if ((user.isAdmin || user.isOwner) && user.tenantDb) {
      try { socket.join(adminRoom(user.tenantDb)); } catch { /* non-fatal */ }
    }

    const db = () => (socket.data.tenantDb ? getTenantDb(socket.data.tenantDb) : getDb());

    // ── Join a thread room ────────────────────────────────────────────────────
    socket.on('chat:join', async ({ threadId, db: dbName } = {}) => {
      try {
        // Bind the tenant DB to the admin's OWN token; only a superadmin may target
        // another tenant's DB via the client param. Stops an admin from reaching a
        // different tenant's threads by passing a foreign db name.
        if (user.isSuperAdmin) { if (dbName) socket.data.tenantDb = dbName; }
        else if (user.tenantDb) { socket.data.tenantDb = user.tenantDb; }
        else if (dbName) { socket.data.tenantDb = dbName; }
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
          takeover: !!(thread.takeover && thread.takeover.active),
          honeypot: !!thread.honeypot,
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

        // On a public support thread the admin is replying TO a visitor — label
        // the message with just their first name and mark it staff, so the guest
        // sees a person (not an email) and the source is unambiguous.
        const isSupport = thread.kind === 'support';
        const saved = await postMessage(db(), {
          threadId: thread._id,
          authorType: 'user',
          authorId: user.id,
          authorName: isSupport ? firstNameOf(user) : (user.displayName || user.email || 'User'),
          role: 'user',
          body: text,
          meta: isSupport ? { staff: true } : null,
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
        // Stand the AI down while a human has taken over or the thread is flagged
        // as a honeypot — the assistant must not talk over a live staffer or feed
        // a suspected bot.
        const paused = !!((thread.takeover && thread.takeover.active) || thread.honeypot);
        if (chatbotEnabled(tenant) && !paused) {
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

    // ── Human takeover: stand the AI down + announce the staffer to the guest ──
    socket.on('chat:takeover', async ({ threadId, on } = {}) => {
      try {
        const thread = await getThread(db(), threadId);
        if (!thread) return socket.emit('chat:error', { message: 'Thread not found.' });
        if (!canAccessThread(thread, user.id, ctxFromUser(user))) {
          return socket.emit('chat:error', { message: 'You do not have access to this thread.' });
        }
        const active = !!on;
        const name = firstNameOf(user);
        const now = new Date();
        await db().collection('chat_threads').updateOne(
          { _id: thread._id },
          { $set: { takeover: active ? { active: true, byUserId: user.id, byName: name, at: now } : { active: false, byName: name, at: now }, updatedAt: now } },
        );
        // A visible notice the guest sees (green) and the admin room mirrors.
        const notice = await postMessage(db(), {
          threadId: thread._id, authorType: 'system', authorName: 'System', role: 'system',
          body: active ? `${name} is joining the chat` : `${name} handed the chat back to the assistant`,
          meta: { event: active ? 'admin-join' : 'admin-leave', byName: name },
        });
        chat.to(room(thread._id)).emit('chat:message', notice);
        chat.to(room(thread._id)).emit('chat:takeover', { threadId: String(thread._id), active, byName: name });
      } catch (err) {
        console.error('[chat] takeover error:', err.message);
        socket.emit('chat:error', { message: 'Could not change takeover.' });
      }
    });

    // ── Honeypot: flag a suspected bot/scanner — AI stands down, no lead alerts ──
    socket.on('chat:honeypot', async ({ threadId, on } = {}) => {
      try {
        const thread = await getThread(db(), threadId);
        if (!thread) return socket.emit('chat:error', { message: 'Thread not found.' });
        if (!canAccessThread(thread, user.id, ctxFromUser(user))) {
          return socket.emit('chat:error', { message: 'You do not have access to this thread.' });
        }
        const flagged = !!on;
        await db().collection('chat_threads').updateOne(
          { _id: thread._id }, { $set: { honeypot: flagged, updatedAt: new Date() } },
        );
        // Admin-only note (the guest only ever sees join/leave system messages).
        const note = await postMessage(db(), {
          threadId: thread._id, authorType: 'system', authorName: 'System', role: 'system',
          body: flagged
            ? `${firstNameOf(user)} flagged this visitor as a suspected bot — honeypot on, assistant silenced.`
            : `${firstNameOf(user)} cleared the honeypot flag.`,
          meta: { event: 'honeypot', on: flagged },
        });
        chat.to(room(thread._id)).emit('chat:message', note);
        chat.to(room(thread._id)).emit('chat:honeypot', { threadId: String(thread._id), on: flagged });
      } catch (err) {
        console.error('[chat] honeypot error:', err.message);
        socket.emit('chat:error', { message: 'Could not change honeypot.' });
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
