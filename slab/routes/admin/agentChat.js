/**
 * Slab — Agent-chat capability endpoints (UNGATED beyond admin login)
 * ─────────────────────────────────────────────────────────────────────────────
 * Deliberately mounted at /admin/agent-chat, NOT under the feature-gated
 * /admin/chat control panel: per the architecture, the chat CAPABILITY is
 * untagged substrate (matchFeatureByPath finds no feature for this path, so
 * enforceFeatureAccess lets any authed admin/collaborator through), while the
 * control panel stays adminOnly + experimental.
 *
 * POST /resolve — find-or-create the ONE persistent thread for a
 * {kind, context.module} pair, so the ✦ launcher on e.g. the Design page always
 * reopens the same perpetual design conversation. Adds the requester as a
 * member on reuse (thread membership is the real per-thread gate).
 */

import express from 'express';
import { createThread, addMember, THREAD_KINDS } from '../../plugins/chat.js';

const router = express.Router();

router.post('/resolve', async (req, res) => {
  try {
    const db = req.db;
    const kind = THREAD_KINDS.includes(req.body.kind) ? req.body.kind : 'agent';
    const module = req.body.module ? String(req.body.module).slice(0, 40) : null;
    const title = (req.body.title ? String(req.body.title).slice(0, 200) : '')
      || kind.charAt(0).toUpperCase() + kind.slice(1) + ' agent';
    const uid = req.adminUser?.id;

    let thread = await db.collection('chat_threads').findOne(
      { kind, status: 'active', 'context.module': module },
      { sort: { lastMessageAt: -1 } },
    );

    if (thread) {
      if (uid) await addMember(db, thread._id, { userId: uid, role: 'collaborator' });
    } else {
      thread = await createThread(db, {
        kind, title,
        context: module ? { module } : null,
        createdBy: uid,
        members: uid ? [{ userId: uid, role: 'owner' }] : [],
      });
    }

    res.json({
      ok: true,
      threadId: String(thread._id),
      title: thread.title,
      kind: thread.kind,
      tenantDb: req.tenant?.db || '',
    });
  } catch (err) {
    console.error('[agent-chat/resolve] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
