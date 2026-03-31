/**
 * Slab — Public Ticket API
 * Mounted at /api/tickets in app.js
 *
 * POST /                → create ticket from bug button (any page)
 * POST /debug-capture   → capture server logs (admin-only)
 * GET  /mine            → list own tickets (portal auth)
 * GET  /:id             → view own ticket (portal auth)
 * POST /:id/reply       → reply to own ticket (portal auth)
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import { execSync } from 'child_process';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { ticketUpload } from '../middleware/upload.js';

const router = express.Router();

// ── Auth helpers (optional — detect who's calling) ─────────────────────────────

function tryDecodeAdmin(req) {
  const token = req.cookies?.slab_token;
  if (!token) return null;
  try { return jwt.verify(token, config.JWT_SECRET); } catch { return null; }
}

function tryDecodePortal(req) {
  const token = req.cookies?.slab_portal;
  if (!token) return null;
  try { return jwt.verify(token, config.JWT_SECRET); } catch { return null; }
}

// ── Ticket number generator ────────────────────────────────────────────────────

async function nextTicketNumber(db) {
  const result = await db.collection('ticket_counter').findOneAndUpdate(
    { _id: 'ticket_seq' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = result.seq || result.value?.seq || 1;
  return `T-${String(seq).padStart(6, '0')}`;
}

function fileToAttachment(file) {
  if (!file) return null;
  return {
    url: file.location || '',
    key: file.key || '',
    name: file.originalname,
    size: file.size,
    type: file.mimetype,
    uploadedAt: new Date(),
  };
}

// ── Debug capture (admin-only) ─────────────────────────────────────────────────

router.post('/debug-capture', (req, res) => {
  const admin = tryDecodeAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin auth required for debug capture' });

  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  const data = { capturedAt: new Date().toISOString() };

  // Tmux scrollback
  try {
    data.tmuxLog = execSync(`tmux capture-pane -t slab -p -S -${lines}`, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch { data.tmuxLog = '[not available]'; }

  // Apache logs
  const logFiles = [
    ['apacheAccessLog', '/var/log/apache2/slab-access.log'],
    ['apacheErrorLog', '/var/log/apache2/slab-error.log'],
    ['wildcardAccessLog', '/var/log/apache2/slab-wildcard-access.log'],
    ['wildcardErrorLog', '/var/log/apache2/slab-wildcard-error.log'],
  ];
  for (const [key, path] of logFiles) {
    try {
      data[key] = execSync(`tail -n ${lines} ${path}`, { encoding: 'utf8', timeout: 5000 }).trim();
    } catch { data[key] = '[not available]'; }
  }

  res.json(data);
});

// ── Create ticket (from bug button) ────────────────────────────────────────────

router.post('/', ticketUpload.single('screenshot'), async (req, res) => {
  try {
    if (!req.db) return res.status(400).json({ error: 'No tenant context' });

    const db = req.db;
    const admin = tryDecodeAdmin(req);
    const portal = tryDecodePortal(req);

    const { subject, description, category, priority, email, debugData } = req.body;
    if (!subject?.trim()) return res.status(400).json({ error: 'Subject is required' });

    // Determine submitter identity
    let submittedBy;
    if (admin) {
      submittedBy = { type: 'admin', userId: admin.id, email: admin.email, displayName: admin.displayName, clientId: null };
    } else if (portal) {
      submittedBy = { type: 'portal', userId: portal.id, email: portal.email, displayName: portal.displayName, clientId: portal.clientId || null };
    } else {
      if (!email?.trim()) return res.status(400).json({ error: 'Email is required for unauthenticated submissions' });
      submittedBy = { type: 'public', userId: null, email: email.trim(), displayName: email.trim().split('@')[0], clientId: null };
    }

    const ticketNumber = await nextTicketNumber(db);
    const attachments = [];
    const att = fileToAttachment(req.file);
    if (att) attachments.push(att);

    // Parse debug data if provided
    let parsedDebug = null;
    if (debugData) {
      try { parsedDebug = typeof debugData === 'string' ? JSON.parse(debugData) : debugData; }
      catch { parsedDebug = null; }
    }

    const doc = {
      ticketNumber,
      subject: subject.trim(),
      description: (description || '').trim(),
      category: category || 'bug',
      priority: priority || 'medium',
      status: 'open',
      submittedBy,
      escalated: false,
      escalatedAt: null,
      escalatedBy: null,
      escalationNotes: null,
      tenantDomain: req.tenant?.domain || '',
      tenantDbName: req.tenant?.db || '',
      tenantBrandName: req.tenant?.brand?.name || '',
      attachments,
      debugData: parsedDebug,
      replies: [],
      assignedTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
    };

    const result = await db.collection('tickets').insertOne(doc);
    res.json({ ok: true, ticketId: result.insertedId, ticketNumber });
  } catch (err) {
    console.error('[ticket-api] create error:', err);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// ── List own tickets (portal auth) ─────────────────────────────────────────────

router.get('/mine', async (req, res) => {
  const portal = tryDecodePortal(req);
  const admin = tryDecodeAdmin(req);
  const user = portal || admin;
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (!req.db) return res.status(400).json({ error: 'No tenant context' });

  const tickets = await req.db.collection('tickets')
    .find({ 'submittedBy.email': user.email })
    .sort({ createdAt: -1 })
    .project({ ticketNumber: 1, subject: 1, status: 1, priority: 1, category: 1, createdAt: 1, 'replies.createdAt': 1 })
    .toArray();

  res.json({ tickets });
});

// ── View own ticket ────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const portal = tryDecodePortal(req);
  const admin = tryDecodeAdmin(req);
  const user = portal || admin;
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (!req.db) return res.status(400).json({ error: 'No tenant context' });

  let ticket;
  try {
    ticket = await req.db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  } catch { return res.status(404).json({ error: 'Not found' }); }

  if (!ticket || ticket.submittedBy?.email !== user.email) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Strip debug data for non-admin users
  if (!admin) ticket.debugData = null;

  res.json({ ticket });
});

// ── Reply to own ticket ────────────────────────────────────────────────────────

router.post('/:id/reply', ticketUpload.single('attachment'), async (req, res) => {
  const portal = tryDecodePortal(req);
  const admin = tryDecodeAdmin(req);
  const user = portal || admin;
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (!req.db) return res.status(400).json({ error: 'No tenant context' });

  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Reply body is required' });

  let ticket;
  try {
    ticket = await req.db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  } catch { return res.status(404).json({ error: 'Not found' }); }

  if (!ticket || ticket.submittedBy?.email !== user.email) {
    return res.status(404).json({ error: 'Not found' });
  }

  const reply = {
    _id: new ObjectId(),
    author: {
      type: admin ? 'admin' : 'portal',
      email: user.email,
      displayName: user.displayName,
    },
    body: body.trim(),
    attachments: [],
    createdAt: new Date(),
  };
  const att = fileToAttachment(req.file);
  if (att) reply.attachments.push(att);

  await req.db.collection('tickets').updateOne(
    { _id: ticket._id },
    { $push: { replies: reply }, $set: { updatedAt: new Date() } },
  );

  res.json({ ok: true });
});

export default router;
