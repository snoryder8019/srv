/**
 * Slab — Chat substrate
 * ─────────────────────────────────────────────────────────────────────────────
 * Chat is NOT a page. It's an embeddable substrate that shows up inside Design,
 * Clients, Meetings, agent panels, etc. Two collections back it, both PER-TENANT:
 *
 *   chat_threads   — one document per conversation
 *   chat_messages  — one document per message (NOT an embedded array; perpetual
 *                    chat would blow Mongo's 16MB doc cap and can't paginate)
 *
 * Source of truth is Mongo. Sockets (plugins/chatSocket.js) are only live
 * delivery — history survives reconnects, restarts, and (later) multiple procs.
 *
 * ACCESS CONTROL is two layers, deliberately separate:
 *   1. Capability — "can this admin use chat at all". Chat is UNTAGGED infra:
 *      an embedded thread inherits the permission of whatever hosts it
 *      (design-chat needs `design`, client-chat needs `clients`, …). Enforced
 *      via thread.context + canAccessThread() below. Standalone threads fall
 *      back to explicit membership.
 *   2. Membership — "can this person see THIS thread". The members[] array,
 *      enforced server-side at socket join. "Authorized collaborators" live here.
 *
 * The CONTROL surface (routes/admin/chat.js — thread admin + chatflow matrix +
 * agent/engine/tool assignment) is the only piece that carries a feature tag,
 * and it's adminOnly. The capability stays open substrate.
 */

import { ObjectId } from 'mongodb';
import { canSeeFeature, featureByKey } from './featureRegistry.js';

// ── Thread kinds ─────────────────────────────────────────────────────────────
// A kind selects the default agent behaviour via the chatflow matrix. `context`
// (module + refId) is what an embedded thread inherits its permission from.
export const THREAD_KINDS = ['internal', 'support', 'design', 'client', 'agent'];

// Hard fallback agent config, lowest priority. The per-tenant chatflow matrix
// (chat_flow collection) overrides per kind; a thread's own agentConfig overrides
// that. Engine/tools are the seams for the BYO-engine + MCP-design work later.
export const DEFAULT_AGENT_CONFIG = {
  enabled: false,       // agent stays silent unless a thread/kind turns it on
  agentKey: 'assistant',
  engine: 'house',      // 'house' (Ollama) | 'anthropic' (BYO key) | 'claude-code' (BYO sub)
  mode: 'chat',         // 'chat' converses; 'router' routes to a department and proposes changes
  tools: [],            // MCP tool names from agentMcp.js the agent may call
  captureContact: false, // when true, first user message triggers an inline Name/Phone/Email form
  greeting: '',
};

let _indexed = false;

/** Create the indexes chat needs. Idempotent; safe to call on every boot. */
export async function ensureChatIndexes(db) {
  if (!db) return;
  await Promise.all([
    db.collection('chat_messages').createIndex({ threadId: 1, createdAt: -1 }),
    db.collection('chat_threads').createIndex({ 'members.userId': 1, lastMessageAt: -1 }),
    db.collection('chat_threads').createIndex({ 'context.module': 1, 'context.refId': 1 }),
    db.collection('chat_threads').createIndex({ status: 1, lastMessageAt: -1 }),
  ]).catch(() => {});
  _indexed = true;
}

const oid = (v) => { try { return typeof v === 'string' ? new ObjectId(v) : v; } catch { return null; } };
const sameId = (a, b) => a && b && String(a) === String(b);

// ── Membership + access ──────────────────────────────────────────────────────

/** Is this user an explicit member of the thread? */
export function isThreadMember(thread, userId) {
  if (!thread || !userId) return false;
  return (thread.members || []).some((m) => sameId(m.userId, userId));
}

/**
 * Can this viewer access the thread? Combines the two layers:
 *   • explicit membership, OR
 *   • host-permission inheritance — an embedded thread (thread.context.module set
 *     to a feature key) is reachable by anyone who can see that feature.
 * ctx is the same shape canSeeFeature() takes (isSuperAdmin, isOwner,
 * userPermissions, featureStages, tenantOptIns).
 */
export function canAccessThread(thread, userId, ctx = {}) {
  if (!thread) return false;
  if (ctx.isSuperAdmin || ctx.isOwner) return true;
  if (isThreadMember(thread, userId)) return true;

  const mod = thread.context?.module;
  if (mod) {
    const feature = featureByKey(mod);
    if (feature && canSeeFeature(feature, ctx)) return true;
  }
  return false;
}

// ── Threads ──────────────────────────────────────────────────────────────────

export async function createThread(db, {
  kind = 'internal', title = '', context = null,
  members = [], agentConfig = null, createdBy = null,
} = {}) {
  const now = new Date();
  const doc = {
    kind: THREAD_KINDS.includes(kind) ? kind : 'internal',
    title: String(title || '').slice(0, 200),
    // context = what an embedded thread hangs off + inherits permission from.
    // e.g. { module: 'clients', refId: <clientId> } or { module: 'design' }.
    context: context && context.module ? {
      module: String(context.module).slice(0, 40),
      refId: context.refId != null ? oid(context.refId) || String(context.refId) : null,
    } : null,
    members: (members || []).map((m) => ({
      userId: oid(m.userId) || m.userId,
      role: ['owner', 'collaborator', 'agent'].includes(m.role) ? m.role : 'collaborator',
      addedAt: now,
    })),
    agentConfig: agentConfig ? { ...DEFAULT_AGENT_CONFIG, ...agentConfig } : null,
    status: 'active',                 // active | locked | archived
    createdBy: oid(createdBy) || createdBy || null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: '',
  };
  const { insertedId } = await db.collection('chat_threads').insertOne(doc);
  return { ...doc, _id: insertedId };
}

export async function getThread(db, threadId) {
  const id = oid(threadId);
  if (!id) return null;
  return db.collection('chat_threads').findOne({ _id: id });
}

/** Threads a user can see: explicit membership OR embedded-in-a-feature-they-have. */
export async function listThreads(db, { userId, ctx = {}, status = 'active', limit = 50 } = {}) {
  const uid = oid(userId) || userId;
  const q = { status };
  if (!(ctx.isSuperAdmin || ctx.isOwner)) {
    // Member of the thread, or the thread is embedded in a feature this ctx can see.
    const allowedModules = THREAD_KINDS // cheap: let canAccessThread do the exact check post-fetch
      ? undefined : undefined;
    q.$or = [{ 'members.userId': uid }, { 'context.module': { $ne: null } }];
    void allowedModules;
  }
  const rows = await db.collection('chat_threads')
    .find(q).sort({ lastMessageAt: -1 }).limit(limit * 2).toArray();
  // Final authoritative filter (handles the feature-permission inheritance path).
  const visible = rows.filter((t) => canAccessThread(t, uid, ctx));
  return visible.slice(0, limit);
}

export async function setThreadStatus(db, threadId, status) {
  if (!['active', 'locked', 'archived'].includes(status)) throw new Error('bad status');
  const id = oid(threadId);
  await db.collection('chat_threads').updateOne({ _id: id }, { $set: { status, updatedAt: new Date() } });
}

export async function addMember(db, threadId, { userId, role = 'collaborator' }) {
  const id = oid(threadId);
  await db.collection('chat_threads').updateOne(
    { _id: id, 'members.userId': { $ne: oid(userId) || userId } },
    { $push: { members: { userId: oid(userId) || userId, role, addedAt: new Date() } }, $set: { updatedAt: new Date() } },
  );
}

export async function removeMember(db, threadId, userId) {
  const id = oid(threadId);
  await db.collection('chat_threads').updateOne(
    { _id: id },
    { $pull: { members: { userId: oid(userId) || userId } }, $set: { updatedAt: new Date() } },
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

export async function postMessage(db, {
  threadId, authorType = 'user', authorId = null, authorName = 'Unknown',
  role = 'user', body = '', meta = null,
} = {}) {
  const id = oid(threadId);
  if (!id) throw new Error('bad threadId');
  const text = String(body || '').slice(0, 20000);
  if (!text && !meta) throw new Error('empty message');
  const now = new Date();
  const msg = {
    threadId: id,
    authorType,                              // user | agent | system
    authorId: oid(authorId) || authorId || null,
    authorName: String(authorName || '').slice(0, 120),
    role,                                    // user | assistant | system (LLM-friendly)
    body: text,
    meta: meta || null,
    createdAt: now,
  };
  const { insertedId } = await db.collection('chat_messages').insertOne(msg);
  await db.collection('chat_threads').updateOne(
    { _id: id },
    { $set: { lastMessageAt: now, updatedAt: now, lastMessagePreview: text.slice(0, 140) } },
  );
  return { ...msg, _id: insertedId };
}

/** Reverse-chronological page of messages, oldest-first in the returned array. */
export async function listMessages(db, threadId, { before = null, limit = 50 } = {}) {
  const id = oid(threadId);
  if (!id) return [];
  const q = { threadId: id };
  if (before) q.createdAt = { $lt: new Date(before) };
  const rows = await db.collection('chat_messages')
    .find(q).sort({ createdAt: -1 }).limit(Math.min(limit, 200)).toArray();
  return rows.reverse();
}

// ── Chatflow matrix + agent resolution ───────────────────────────────────────
// The matrix (chat_flow collection, per tenant) maps thread kind → agentConfig.
// Resolution priority: thread.agentConfig > matrix[kind] > DEFAULT_AGENT_CONFIG.

export async function getChatFlowMatrix(db) {
  const rows = await db.collection('chat_flow').find({}).toArray();
  const matrix = {};
  for (const r of rows) matrix[r.kind] = r.agentConfig || {};
  return matrix;
}

export async function setChatFlow(db, kind, agentConfig) {
  if (!THREAD_KINDS.includes(kind)) throw new Error('bad kind');
  await db.collection('chat_flow').updateOne(
    { kind },
    { $set: { kind, agentConfig: { ...DEFAULT_AGENT_CONFIG, ...agentConfig }, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function resolveAgentForThread(db, thread) {
  const matrix = await getChatFlowMatrix(db);
  return {
    ...DEFAULT_AGENT_CONFIG,
    ...(matrix[thread?.kind] || {}),
    ...(thread?.agentConfig || {}),
  };
}

// ── Contact capture ("chat flow adds input lines to build contact info") ─────
// Deterministic, not LLM-driven: when the resolved flow has captureContact on
// and the thread has no contact yet, post ONE inline form message. Submission
// writes a native inquiry (mirrors the landing /contact shape) + stamps the
// thread, then marks the form message done so history replays it completed.
export const CONTACT_FORM = {
  id: 'contact',
  fields: [
    { key: 'name',  label: 'Name',  type: 'text',  required: true },
    { key: 'phone', label: 'Phone', type: 'tel',   required: false },
    { key: 'email', label: 'Email', type: 'email', required: true },
  ],
};

export async function maybeRequestContact(db, thread, agent) {
  if (!agent?.captureContact) return null;
  if (thread?.contact?.capturedAt) return null;
  const pending = await db.collection('chat_messages').findOne({
    threadId: thread._id, 'meta.form.id': 'contact', 'meta.form.done': { $ne: true },
  });
  if (pending) return null;
  return postMessage(db, {
    threadId: thread._id, authorType: 'agent',
    authorName: agent.agentKey || 'Assistant', role: 'assistant',
    body: 'So we can follow up properly, drop your contact info here:',
    meta: { form: { ...CONTACT_FORM, done: false } },
  });
}

const EMAIL_RE = /^[^\s@]{1,80}@[^\s@]{1,80}\.[^\s@]{2,24}$/;

export async function saveContactSubmission(db, { thread, values = {}, formMessageId = null, tenantDomain = '' } = {}) {
  const name  = String(values.name  || '').trim().slice(0, 120);
  const phone = String(values.phone || '').trim().slice(0, 40);
  const email = String(values.email || '').trim().toLowerCase().slice(0, 160);
  if (!name) throw new Error('Name is required.');
  if (!EMAIL_RE.test(email)) throw new Error('A valid email is required.');
  const now = new Date();

  await db.collection('inquiries').insertOne({
    name, email, company: '', service: '',
    message: 'Captured via chat thread "' + (thread.title || String(thread._id)) + '"',
    customFields: phone ? { phone } : {},
    tenantDomain, source: 'chat', threadId: thread._id,
    createdAt: now,
  });
  await db.collection('chat_threads').updateOne(
    { _id: thread._id },
    { $set: { contact: { name, phone, email, capturedAt: now }, updatedAt: now } },
  );
  if (formMessageId) {
    try {
      await db.collection('chat_messages').updateOne(
        { _id: oid(formMessageId), threadId: thread._id },
        { $set: { 'meta.form.done': true } },
      );
    } catch { /* non-fatal */ }
  }
  return postMessage(db, {
    threadId: thread._id, authorType: 'system', authorName: 'System', role: 'system',
    body: 'Contact saved for ' + name + ' \u2014 we\u2019ll follow up at ' + email + (phone ? ' / ' + phone : '') + '.',
    meta: { contactSaved: true },
  });
}

// ── Agent dispatch ───────────────────────────────────────────────────────────
// When a user posts to a thread whose resolved agent is enabled, produce a reply.
// This is the seam where the whole earlier plan converges: the engine field will
// route to Ollama today / a BYO Anthropic key / Claude Code later, and the tools
// field lets an agent hold e.g. `update_design` so "design-via-chat" is just an
// agent thread with that tool. For now: house engine (callLLM), reply-only.
export async function dispatchAgent(db, { thread, tenant, history, onReply } = {}) {
  const agent = await resolveAgentForThread(db, thread);
  if (!agent.enabled) return null;

  // ── Router mode: route (biased by the thread's context module), run the
  // department tool, and post the proposed change (meta.fill) for the Apply
  // affordance → shared committer. A non-task message routes to "assist" and
  // falls through to the operator conversation below.
  const lastUser = [...(history || [])].reverse().find((m) => m.authorType === 'user');
  if ((agent.mode || 'chat') === 'router') {
    const { routeMessage, runDepartment } = await import('./agentRouter.js');
    const route = await routeMessage(lastUser?.body || '', {
      contextModule: thread?.context?.module || null,
      kind: thread?.kind || null,
    });
    if (route.department && route.department !== 'assist') {
      const out = await runDepartment(db, tenant, { ...route, audience: 'admin' });
      const saved = await postMessage(db, {
        threadId: thread._id, authorType: 'agent',
        authorName: agent.agentKey || 'Assistant', role: 'assistant',
        body: out.message || 'Done.',
        meta: {
          department: out.department || null,
          fill: out.fill && Object.keys(out.fill).length ? out.fill : null,
          action: out.action || null,
          navigate: out.navigate || null,
          section_type: out.section_type || null,
          page_type: out.page_type || null,
          engine: agent.engine,
        },
      });
      if (typeof onReply === 'function') onReply(saved);
      return saved;
    }
    // assist → operator conversation below
  }


  const { callLLM } = await import('./agentMcp.js');
  let brandCtx = '';
  try {
    const { loadBrandContext } = await import('./brandContext.js');
    brandCtx = await loadBrandContext(tenant, db);
  } catch { /* non-fatal */ }

  const KIND_JOB = {
    design:   'site design and content — colors, fonts, layout tokens, section visibility, page copy',
    client:   'clients and leads — research, outreach drafts, follow-ups, CRM hygiene',
    support:  'support — triaging visitor questions and tickets',
    internal: 'internal team operations and coordination',
    agent:    'any admin task — blog posts, site copy, design changes, campaigns, invoices, social posts',
  };
  const systemPrompt = `You are ${agent.agentKey || 'the assistant'}, the ${thread?.kind || 'agent'} OPERATIONS agent inside this business's admin panel.
You are talking to the site owner / staff — NOT a customer. Never use customer-service voice ("How can I assist you today?"), never pitch the business to them, never sign off like a support rep.
Your job: ${KIND_JOB[thread?.kind] || KIND_JOB.agent}.
Be direct, brief, and peer-to-peer. When they name a task, state exactly what you will do or ask for the one missing specific. Treat the brand context below as reference knowledge about their business — not as your speaking style.
${brandCtx}
Reply in plain text — no JSON envelope.
${agent.greeting ? 'Persona note: ' + agent.greeting : ''}`.trim();

  // Map stored messages to LLM roles. Agent = assistant, everyone else = user.
  const msgs = (history || []).slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.authorType === 'user' ? `${m.authorName}: ${m.body}` : m.body,
  }));

  // TODO(engine): switch on agent.engine → anthropic (BYO key) / claude-code (BYO sub).
  // TODO(tools): if agent.tools includes an MCP tool, run the tool-call loop here.
  const reply = await callLLM(msgs, systemPrompt);
  if (!reply) return null;

  const saved = await postMessage(db, {
    threadId: thread._id,
    authorType: 'agent',
    authorName: agent.agentKey || 'Assistant',
    role: 'assistant',
    body: reply,
    meta: { engine: agent.engine },
  });
  if (typeof onReply === 'function') onReply(saved);
  return saved;
}

/** Is the tenant's chatbot toggle on? Reads the settings flag added in settings.js. */
export function chatbotEnabled(tenant) {
  return String(tenant?.public?.chatbotEnabled ?? 'false') === 'true';
}
