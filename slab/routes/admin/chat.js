/**
 * Slab — Chat control surface (admin)
 * ─────────────────────────────────────────────────────────────────────────────
 * The chat CAPABILITY is untagged substrate (see plugins/chat.js). THIS panel is
 * the one gated piece: thread administration + the chatflow matrix (per-kind
 * agent / engine / tool assignment). Registered as an adminOnly, experimental
 * feature so only the owner + unrestricted admins reach it, and it's hidden
 * behind the /admin/labs opt-in until it graduates.
 *
 * Wire in app.js next to the other admin routers:
 *     import adminChat from './routes/admin/chat.js';
 *     app.use('/admin/chat', adminAuth, adminChat);   // match sibling mount style
 */

import express from 'express';
import {
  THREAD_KINDS, KIND_META, DEFAULT_AGENT_CONFIG,
  listThreads, getThread, createThread, setThreadStatus,
  addMember, removeMember, listMessages,
  getChatFlowMatrix, setChatFlow,
} from '../../plugins/chat.js';
import { MCP_TOOLS } from '../../plugins/agentMcp.js';
import { ANTHROPIC_MODELS } from '../../plugins/agentEngine.js';
import { agentsByCategory, getAgentConfigMap, setAgentConfig, getTenantDefault, setTenantDefault } from '../../plugins/agentRegistry.js';
const MODEL_KEYS = new Set(ANTHROPIC_MODELS.map((m) => m.key));

const router = express.Router();

// Engines the matrix can assign. 'house' works today; the other two are the
// BYO seams and render as "coming soon" until their provider layer lands.
const ENGINES = [
  { key: 'house',       label: 'House (Ollama)',            ready: true },
  { key: 'anthropic',   label: 'BYO Anthropic API key',     ready: true },
  // 'claude-code' (BYO Pro/Max via the Agent SDK) removed 2026-07-15 — different
  // surface than the API-key path, and superseded by the scope-builder rethink.
];

function viewerCtx(req) {
  return {
    isSuperAdmin: !!req.isSuperAdmin,
    isOwner: !!req.adminUser?.isOwner,
    userPermissions: Array.isArray(req.adminUser?.permissions) ? req.adminUser.permissions : [],
    featureStages: {},
    tenantOptIns: {},
  };
}

// ── Control panel ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const status = ['active', 'locked', 'archived'].includes(req.query.status) ? req.query.status : 'active';
    const [threads, matrix, agentConfig, tenantDefault] = await Promise.all([
      listThreads(db, { userId: req.adminUser?.id, ctx: { ...viewerCtx(req), isOwner: true }, status, limit: 100 }),
      getChatFlowMatrix(db),
      getAgentConfigMap(db),
      getTenantDefault(db),
    ]);
    res.render('admin/chat/index', {
      user: req.adminUser, page: 'chat', title: 'Chat Control',
      threads, matrix, kinds: THREAD_KINDS, kindMeta: KIND_META, engines: ENGINES, models: ANTHROPIC_MODELS,
      agentGroups: agentsByCategory(), agentConfig, tenantDefault,
      tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
      defaultAgent: DEFAULT_AGENT_CONFIG, status,
      tenantDb: req.tenant?.db || '', chatbotEnabled: req.tenant?.public?.chatbotEnabled === 'true',
      saved: req.query.saved === '1', error: req.query.error === '1',
    });
  } catch (err) {
    console.error('[admin/chat] index error:', err);
    res.redirect('/admin');
  }
});

// ── Thread status: lock / archive / reactivate ────────────────────────────────
router.post('/threads/:id/status', async (req, res) => {
  try {
    await setThreadStatus(req.db, req.params.id, req.body.status);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Thread delete (hard — removes messages too) ───────────────────────────────
router.post('/threads/:id/delete', async (req, res) => {
  try {
    const { ObjectId } = await import('mongodb');
    const id = new ObjectId(req.params.id);
    await Promise.all([
      req.db.collection('chat_threads').deleteOne({ _id: id }),
      req.db.collection('chat_messages').deleteMany({ threadId: id }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Membership ────────────────────────────────────────────────────────────────
router.post('/threads/:id/members', async (req, res) => {
  try {
    await addMember(req.db, req.params.id, { userId: req.body.userId, role: req.body.role });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/threads/:id/members/remove', async (req, res) => {
  try {
    await removeMember(req.db, req.params.id, req.body.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Read a thread's transcript (admin inspection) ─────────────────────────────
router.get('/threads/:id/messages', async (req, res) => {
  try {
    const thread = await getThread(req.db, req.params.id);
    if (!thread) return res.status(404).json({ ok: false, error: 'not found' });
    const messages = await listMessages(req.db, req.params.id, { before: req.query.before, limit: 100 });
    res.json({ ok: true, thread, messages });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Create a thread from the panel (e.g. an internal or agent thread) ──────────
router.post('/threads', async (req, res) => {
  try {
    const thread = await createThread(req.db, {
      kind: req.body.kind,
      title: req.body.title,
      createdBy: req.adminUser?.id,
      members: req.adminUser?.id ? [{ userId: req.adminUser.id, role: 'owner' }] : [],
    });
    res.json({ ok: true, thread });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Chatflow matrix: set the agent config for a thread kind ────────────────────
router.post('/flow/:kind', async (req, res) => {
  try {
    const { enabled, agentKey, engine, model, tools, greeting, captureContact, mode } = req.body;
    await setChatFlow(req.db, req.params.kind, {
      enabled: enabled === 'true' || enabled === true || enabled === 'on',
      agentKey: (agentKey || 'assistant').slice(0, 60),
      engine: ['house', 'anthropic'].includes(engine) ? engine : 'house',
      model: MODEL_KEYS.has(model) ? model : '', // '' → platform default (Opus 4.8)
      tools: Array.isArray(tools) ? tools : (tools ? [tools] : []),
      greeting: (greeting || '').slice(0, 500),
      captureContact: captureContact === 'true' || captureContact === true || captureContact === 'on',
      mode: mode === 'router' ? 'router' : 'chat',
    });
    res.redirect('/admin/chat?saved=1#matrix');
  } catch (err) {
    console.error('[admin/chat] flow save error:', err);
    res.redirect('/admin/chat?error=1#matrix');
  }
});

// ── Tenant default: base engine/model the whole tenant inherits ───────────────
router.post('/tenant-default', async (req, res) => {
  try {
    const { engine, model } = req.body;
    await setTenantDefault(req.db, {
      engine: ['house', 'anthropic'].includes(engine) ? engine : '', // '' → platform behaviour
      model: MODEL_KEYS.has(model) ? model : '',
    });
    res.redirect('/admin/chat?saved=1#agents');
  } catch (err) {
    console.error('[admin/chat] tenant-default save error:', err);
    res.redirect('/admin/chat?error=1#agents');
  }
});

// ── Per-agent config: engine/model override + enable for one registry agent ───
router.post('/agent-config/:key', async (req, res) => {
  try {
    const { enabled, engine, model } = req.body;
    await setAgentConfig(req.db, req.params.key, {
      enabled: enabled === 'true' || enabled === true || enabled === 'on',
      engine: ['house', 'anthropic'].includes(engine) ? engine : '', // '' → inherit
      model: MODEL_KEYS.has(model) ? model : '',                     // '' → inherit/default
    });
    res.redirect('/admin/chat?saved=1#agents');
  } catch (err) {
    console.error('[admin/chat] agent-config save error:', err);
    res.redirect('/admin/chat?error=1#agents');
  }
});

export default router;
