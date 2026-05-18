// /admin/inquiries — review contact-form submissions and convert/push them
// to other lifecycle stages (clients, email-marketing contacts).
//
// Collection: req.db.inquiries (written by routes/index.js POST /contact)

import express from 'express';
import { ObjectId } from 'mongodb';
import { sendClientEmail } from '../../plugins/mailer.js';
import { logActivity } from '../../plugins/activityLog.js';

const router = express.Router();

const STATUSES = ['new', 'read', 'replied', 'converted', 'archived', 'spam'];

// ── List ───────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const db = req.db;
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const q = (req.query.q || '').trim();

  const filter = {};
  if (status) filter.status = status;
  else filter.status = { $nin: ['archived', 'spam'] }; // default hides archived/spam
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { company: rx }, { message: rx }];
  }

  const [items, counts] = await Promise.all([
    db.collection('inquiries').find(filter).sort({ createdAt: -1 }).limit(200).toArray(),
    db.collection('inquiries').aggregate([
      { $group: { _id: { $ifNull: ['$status', 'new'] }, n: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const tally = { new: 0, read: 0, replied: 0, converted: 0, archived: 0, spam: 0, total: 0 };
  for (const c of counts) {
    const k = c._id || 'new';
    if (tally[k] !== undefined) tally[k] = c.n;
    tally.total += c.n;
  }

  res.render('admin/inquiries/index', {
    user: req.adminUser,
    page: 'inquiries',
    items,
    tally,
    status,
    q,
    flash: { saved: req.query.saved, error: req.query.error, info: req.query.info },
  });
});

// ── Detail ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const db = req.db;
  let inquiry;
  try { inquiry = await db.collection('inquiries').findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.redirect('/admin/inquiries'); }
  if (!inquiry) return res.redirect('/admin/inquiries');

  // Auto-mark as read on first view
  if (!inquiry.status || inquiry.status === 'new') {
    await db.collection('inquiries').updateOne(
      { _id: inquiry._id },
      { $set: { status: 'read', readAt: new Date() } }
    );
    inquiry.status = 'read';
  }

  // Has this email already been converted to a client or marketing contact?
  const [existingClient, existingContact] = await Promise.all([
    db.collection('clients').findOne({ email: inquiry.email }, { projection: { _id: 1, name: 1 } }),
    db.collection('contacts').findOne({ email: inquiry.email }, { projection: { _id: 1, funnel: 1 } }),
  ]);

  res.render('admin/inquiries/detail', {
    user: req.adminUser,
    page: 'inquiries',
    inquiry,
    existingClient,
    existingContact,
    flash: { saved: req.query.saved, error: req.query.error, info: req.query.info },
  });
});

// ── Update status ──────────────────────────────────────────────────────────
router.post('/:id/status', express.json(), async (req, res) => {
  const db = req.db;
  const { status } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    await db.collection('inquiries').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } }
    );
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Convert to client (push to /admin/clients) ─────────────────────────────
router.post('/:id/convert-client', async (req, res) => {
  const db = req.db;
  try {
    const inquiry = await db.collection('inquiries').findOne({ _id: new ObjectId(req.params.id) });
    if (!inquiry) return res.redirect('/admin/inquiries?error=Inquiry+not+found');

    // Avoid dup: if a client with this email already exists, link instead of inserting
    const existing = await db.collection('clients').findOne({ email: inquiry.email });
    let clientId;
    if (existing) {
      clientId = existing._id;
    } else {
      const notes = [
        `Source: contact form (${inquiry.tenantDomain || ''})`,
        inquiry.service ? `Interested in: ${inquiry.service}` : '',
        inquiry.message ? `\nMessage:\n${inquiry.message}` : '',
        Object.keys(inquiry.customFields || {}).length
          ? `\nCustom fields:\n${Object.entries(inquiry.customFields).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n');

      const result = await db.collection('clients').insertOne({
        name: inquiry.name || inquiry.email,
        email: inquiry.email,
        phone: inquiry.customFields?.phone || '',
        company: inquiry.company || '',
        website: '',
        address: '',
        status: 'prospect',
        notes,
        source: 'contact-form',
        sourceInquiryId: inquiry._id,
        onboarding: { complete: false, step: 0, data: {} },
        createdAt: new Date(),
      });
      clientId = result.insertedId;
    }

    await db.collection('inquiries').updateOne(
      { _id: inquiry._id },
      { $set: { status: 'converted', convertedAt: new Date(), clientId } }
    );

    logActivity({
      category: 'inquiries', action: 'convert_client',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { inquiryId: inquiry._id.toString(), clientId: clientId.toString(), reused: !!existing },
      ip: req.ip,
    });

    res.redirect(`/admin/clients/${clientId}?info=${encodeURIComponent(existing ? 'Linked to existing client' : 'New client created')}`);
  } catch (err) {
    console.error('[inquiries] convert-client error:', err);
    res.redirect(`/admin/inquiries/${req.params.id}?error=Convert+failed`);
  }
});

// ── Push to email marketing (contacts collection) ──────────────────────────
router.post('/:id/push-marketing', async (req, res) => {
  const db = req.db;
  try {
    const inquiry = await db.collection('inquiries').findOne({ _id: new ObjectId(req.params.id) });
    if (!inquiry) return res.redirect('/admin/inquiries?error=Inquiry+not+found');

    const funnel = (req.body.funnel || 'lead').trim();
    const email = inquiry.email.toLowerCase().trim();

    const existing = await db.collection('contacts').findOne({ email });
    if (existing) {
      // Already a marketing contact — just refresh tags and link
      await db.collection('contacts').updateOne(
        { _id: existing._id },
        {
          $set: { funnel, updatedAt: new Date(), sourceInquiryId: inquiry._id },
          $addToSet: { tags: 'contact-form' },
        }
      );
    } else {
      await db.collection('contacts').insertOne({
        email,
        name: inquiry.name || '',
        funnel,
        source: 'contact-form',
        sourceInquiryId: inquiry._id,
        tags: ['contact-form', inquiry.service].filter(Boolean),
        status: 'subscribed',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await db.collection('inquiries').updateOne(
      { _id: inquiry._id },
      { $set: { marketingPushedAt: new Date(), marketingFunnel: funnel } }
    );

    logActivity({
      category: 'inquiries', action: 'push_marketing',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { inquiryId: inquiry._id.toString(), email, funnel, reused: !!existing },
      ip: req.ip,
    });

    res.redirect(`/admin/inquiries/${inquiry._id}?info=${encodeURIComponent(existing ? 'Updated marketing contact' : 'Added to marketing list')}`);
  } catch (err) {
    console.error('[inquiries] push-marketing error:', err);
    res.redirect(`/admin/inquiries/${req.params.id}?error=Push+failed`);
  }
});

// ── Reply via email (uses tenant Zoho — requires it to be configured) ──────
router.post('/:id/reply', async (req, res) => {
  const db = req.db;
  try {
    const inquiry = await db.collection('inquiries').findOne({ _id: new ObjectId(req.params.id) });
    if (!inquiry) return res.redirect('/admin/inquiries?error=Inquiry+not+found');

    const subject = (req.body.subject || `Re: your inquiry`).trim();
    const body = (req.body.body || '').trim();
    if (!body) return res.redirect(`/admin/inquiries/${inquiry._id}?error=Reply+body+required`);

    try {
      await sendClientEmail(inquiry.email, [], subject, body, null, req.tenant);
    } catch (mailErr) {
      return res.redirect(`/admin/inquiries/${inquiry._id}?error=${encodeURIComponent(mailErr.message)}`);
    }

    await db.collection('inquiries').updateOne(
      { _id: inquiry._id },
      {
        $set: { status: 'replied', repliedAt: new Date(), updatedAt: new Date() },
        $push: { replies: { subject, body, sentAt: new Date(), sentBy: req.adminUser?.email || 'admin' } },
      }
    );

    res.redirect(`/admin/inquiries/${inquiry._id}?saved=1`);
  } catch (err) {
    console.error('[inquiries] reply error:', err);
    res.redirect(`/admin/inquiries/${req.params.id}?error=Reply+failed`);
  }
});

// ── Delete ─────────────────────────────────────────────────────────────────
router.post('/:id/delete', async (req, res) => {
  const db = req.db;
  try {
    await db.collection('inquiries').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/inquiries?info=Deleted');
  } catch (err) {
    res.redirect(`/admin/inquiries/${req.params.id}?error=Delete+failed`);
  }
});

export default router;
