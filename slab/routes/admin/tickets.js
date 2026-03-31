/**
 * Slab — Admin Support Tickets
 * Mounted at /admin/tickets — requires admin JWT.
 *
 * GET  /                    → ticket list (filterable)
 * GET  /new                 → new ticket form
 * POST /                    → create ticket
 * GET  /:id                 → ticket detail + reply thread
 * POST /:id/reply           → add reply
 * POST /:id/status          → change status (JSON)
 * POST /:id/assign          → assign to admin
 * POST /:id/escalate        → escalate to superadmin
 * POST /:id/resolve         → mark resolved
 * POST /:id/close           → mark closed
 * POST /:id/delete          → delete ticket
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import { getSlabDb } from '../../plugins/mongo.js';
import { ticketUpload } from '../../middleware/upload.js';

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── List ───────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const db = req.db;
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.priority) filter.priority = req.query.priority;
  if (req.query.category) filter.category = req.query.category;

  const [tickets, stats] = await Promise.all([
    db.collection('tickets').find(filter).sort({ createdAt: -1 }).toArray(),
    Promise.all([
      db.collection('tickets').countDocuments({ status: 'open' }),
      db.collection('tickets').countDocuments({ status: 'in-progress' }),
      db.collection('tickets').countDocuments({ status: 'escalated' }),
      db.collection('tickets').countDocuments({ status: 'resolved' }),
      db.collection('tickets').countDocuments({ status: 'closed' }),
    ]).then(([open, inProgress, escalated, resolved, closed]) => ({
      open, inProgress, escalated, resolved, closed,
      total: open + inProgress + escalated + resolved + closed,
    })),
  ]);

  res.render('admin/tickets/index', {
    user: req.adminUser,
    page: 'tickets',
    tickets,
    stats,
    filters: { status: req.query.status || '', priority: req.query.priority || '', category: req.query.category || '' },
  });
});

// ── New form ───────────────────────────────────────────────────────────────────

router.get('/new', async (req, res) => {
  const db = req.db;
  const admins = await db.collection('users').find({ isAdmin: true }).project({ email: 1, displayName: 1 }).toArray();
  res.render('admin/tickets/form', {
    user: req.adminUser,
    page: 'tickets',
    admins,
    error: null,
  });
});

// ── Create ─────────────────────────────────────────────────────────────────────

router.post('/', ticketUpload.single('screenshot'), async (req, res) => {
  try {
    const db = req.db;
    const { subject, description, category, priority, assignedTo } = req.body;
    if (!subject?.trim()) throw new Error('Subject is required.');

    const ticketNumber = await nextTicketNumber(db);
    const attachments = [];
    const att = fileToAttachment(req.file);
    if (att) attachments.push(att);

    const doc = {
      ticketNumber,
      subject: subject.trim(),
      description: (description || '').trim(),
      category: category || 'other',
      priority: priority || 'medium',
      status: 'open',
      submittedBy: {
        type: 'admin',
        userId: req.adminUser.id,
        email: req.adminUser.email,
        displayName: req.adminUser.displayName,
        clientId: null,
      },
      escalated: false,
      escalatedAt: null,
      escalatedBy: null,
      escalationNotes: null,
      tenantDomain: req.tenant?.domain || '',
      tenantDbName: req.tenant?.db || '',
      tenantBrandName: req.tenant?.brand?.name || '',
      attachments,
      debugData: null,
      replies: [],
      assignedTo: assignedTo || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
    };

    const result = await db.collection('tickets').insertOne(doc);
    res.redirect(`/admin/tickets/${result.insertedId}`);
  } catch (err) {
    const db = req.db;
    const admins = await db.collection('users').find({ isAdmin: true }).project({ email: 1, displayName: 1 }).toArray();
    res.render('admin/tickets/form', {
      user: req.adminUser,
      page: 'tickets',
      admins,
      error: err.message,
    });
  }
});

// ── Detail ─────────────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const db = req.db;
  let ticket;
  try {
    ticket = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  } catch { return res.redirect('/admin/tickets'); }
  if (!ticket) return res.redirect('/admin/tickets');

  const admins = await db.collection('users').find({ isAdmin: true }).project({ email: 1, displayName: 1 }).toArray();

  res.render('admin/tickets/detail', {
    user: req.adminUser,
    page: 'tickets',
    ticket,
    admins,
  });
});

// ── Reply ──────────────────────────────────────────────────────────────────────

router.post('/:id/reply', ticketUpload.single('attachment'), async (req, res) => {
  const db = req.db;
  const { body } = req.body;
  if (!body?.trim()) return res.redirect(`/admin/tickets/${req.params.id}`);

  const reply = {
    _id: new ObjectId(),
    author: {
      type: 'admin',
      email: req.adminUser.email,
      displayName: req.adminUser.displayName,
    },
    body: body.trim(),
    attachments: [],
    createdAt: new Date(),
  };
  const att = fileToAttachment(req.file);
  if (att) reply.attachments.push(att);

  await db.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $push: { replies: reply }, $set: { updatedAt: new Date() } },
  );
  res.redirect(`/admin/tickets/${req.params.id}`);
});

// ── Status change (JSON) ───────────────────────────────────────────────────────

router.post('/:id/status', async (req, res) => {
  const db = req.db;
  const { status } = req.body;
  const valid = ['open', 'in-progress', 'escalated', 'resolved', 'closed'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const update = { status, updatedAt: new Date() };
  if (status === 'resolved') update.resolvedAt = new Date();
  if (status === 'closed') update.closedAt = new Date();

  await db.collection('tickets').updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
  res.json({ ok: true, status });
});

// ── Assign ─────────────────────────────────────────────────────────────────────

router.post('/:id/assign', async (req, res) => {
  const db = req.db;
  const { assignedTo } = req.body;
  await db.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { assignedTo: assignedTo || null, updatedAt: new Date() } },
  );
  res.redirect(`/admin/tickets/${req.params.id}`);
});

// ── Escalate ───────────────────────────────────────────────────────────────────

router.post('/:id/escalate', async (req, res) => {
  const db = req.db;
  const ticket = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!ticket) return res.redirect('/admin/tickets');

  const now = new Date();
  await db.collection('tickets').updateOne(
    { _id: ticket._id },
    {
      $set: {
        status: 'escalated',
        escalated: true,
        escalatedAt: now,
        escalatedBy: req.adminUser.email,
        escalationNotes: (req.body.escalationNotes || '').trim() || null,
        updatedAt: now,
      },
    },
  );

  // Write index entry to slab registry for superadmin cross-tenant view
  const slab = getSlabDb();
  await slab.collection('escalated_tickets').updateOne(
    { ticketId: ticket._id.toString(), tenantDbName: ticket.tenantDbName },
    {
      $set: {
        ticketId: ticket._id.toString(),
        tenantDomain: ticket.tenantDomain,
        tenantDbName: ticket.tenantDbName,
        tenantBrandName: ticket.tenantBrandName,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: 'escalated',
        priority: ticket.priority,
        category: ticket.category,
        submittedByEmail: ticket.submittedBy?.email || '',
        escalatedAt: now,
        escalatedBy: req.adminUser.email,
        resolvedAt: null,
      },
    },
    { upsert: true },
  );

  res.redirect(`/admin/tickets/${req.params.id}`);
});

// ── Resolve ────────────────────────────────────────────────────────────────────

router.post('/:id/resolve', async (req, res) => {
  const db = req.db;
  const now = new Date();
  const ticket = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!ticket) return res.redirect('/admin/tickets');

  await db.collection('tickets').updateOne(
    { _id: ticket._id },
    { $set: { status: 'resolved', resolvedAt: now, updatedAt: now } },
  );

  // Update escalation index if it was escalated
  if (ticket.escalated) {
    const slab = getSlabDb();
    await slab.collection('escalated_tickets').updateOne(
      { ticketId: ticket._id.toString(), tenantDbName: ticket.tenantDbName },
      { $set: { status: 'resolved', resolvedAt: now } },
    );
  }

  res.redirect(`/admin/tickets/${req.params.id}`);
});

// ── Close ──────────────────────────────────────────────────────────────────────

router.post('/:id/close', async (req, res) => {
  const db = req.db;
  const now = new Date();
  const ticket = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!ticket) return res.redirect('/admin/tickets');

  await db.collection('tickets').updateOne(
    { _id: ticket._id },
    { $set: { status: 'closed', closedAt: now, updatedAt: now } },
  );

  if (ticket.escalated) {
    const slab = getSlabDb();
    await slab.collection('escalated_tickets').updateOne(
      { ticketId: ticket._id.toString(), tenantDbName: ticket.tenantDbName },
      { $set: { status: 'closed', resolvedAt: now } },
    );
  }

  res.redirect(`/admin/tickets/${req.params.id}`);
});

// ── Delete ─────────────────────────────────────────────────────────────────────

router.post('/:id/delete', async (req, res) => {
  const db = req.db;
  const ticket = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (ticket?.escalated) {
    const slab = getSlabDb();
    await slab.collection('escalated_tickets').deleteOne({
      ticketId: ticket._id.toString(), tenantDbName: ticket.tenantDbName,
    });
  }
  await db.collection('tickets').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/tickets');
});

export default router;
