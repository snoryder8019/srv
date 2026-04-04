import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { clientFileUpload } from '../../middleware/upload.js';
import { generateInvoiceNumber, generatePaymentToken, calculateTotal, getNextGenerateDate } from '../../plugins/invoiceHelpers.js';
import { sendInvoiceEmail, sendClientEmail } from '../../plugins/mailer.js';
import { config } from '../../config/config.js';
import { normalizeSubject } from '../../plugins/imapPoller.js';
import { handleResearchClient } from '../../plugins/agentMcp.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import crypto from 'crypto';

const router = express.Router();

// ── Client tag definitions ─────────────────────────────────────────────────
const CLIENT_TAGS = {
  vip:            { label: 'VIP',           color: '#c9a848', bg: 'rgba(201,168,72,0.12)' },
  'high-value':   { label: 'High Value',    color: '#eab308', bg: 'rgba(234,179,8,0.10)' },
  'needs-followup': { label: 'Follow-Up',   color: '#f97316', bg: 'rgba(249,115,22,0.10)' },
  'at-risk':      { label: 'At Risk',       color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  referral:       { label: 'Referral',      color: '#0ea5e9', bg: 'rgba(14,165,233,0.10)' },
  recurring:      { label: 'Recurring',     color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  'new-lead':     { label: 'New Lead',      color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' },
  priority:       { label: 'Priority',      color: '#1e293b', bg: 'rgba(30,41,59,0.10)' },
};

// ── Client profile completeness checks ─────────────────────────────────────
const CLIENT_CONFIG = {
  email:       { label: 'Email',      icon: '✉', test: c => !!c.email },
  phone:       { label: 'Phone',      icon: '☎', test: c => !!c.phone },
  company:     { label: 'Company',    icon: '◼', test: c => !!c.company },
  website:     { label: 'Website',    icon: '🌐', test: c => !!c.website },
  address:     { label: 'Address',    icon: '📍', test: c => !!c.address },
  onboarding:  { label: 'Onboarded',  icon: '✓', test: c => !!c.onboarding?.complete },
};

function getClientConfig(client) {
  const out = {};
  for (const [key, check] of Object.entries(CLIENT_CONFIG)) {
    out[key] = check.test(client);
  }
  out._count = Object.values(out).filter(Boolean).length;
  out._total = Object.keys(CLIENT_CONFIG).length;
  return out;
}

// List
router.get('/', async (req, res) => {
  const db = req.db;
  const clients = await db.collection('clients').find({}).sort({ createdAt: -1 }).toArray();
  const configMap = {};
  for (const c of clients) configMap[c._id.toString()] = getClientConfig(c);
  res.render('admin/clients/index', {
    user: req.adminUser, clients,
    tagDefs: CLIENT_TAGS, configMap, configChecks: CLIENT_CONFIG,
  });
});

// New form
router.get('/new', (req, res) => {
  res.render('admin/clients/form', { user: req.adminUser, c: null, error: null });
});

// Create
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { name, email, phone, company, status, notes, website, address } = req.body;
    const result = await db.collection('clients').insertOne({
      name: name?.trim(),
      email: email?.trim() || '',
      phone: phone?.trim() || '',
      company: company?.trim() || '',
      website: website?.trim() || '',
      address: address?.trim() || '',
      status: status || 'prospect',
      notes: notes?.trim() || '',
      onboarding: { complete: false, step: 0, data: {} },
      createdAt: new Date(),
    });
    res.redirect(`/admin/clients/${result.insertedId}`);
  } catch (err) {
    res.render('admin/clients/form', { user: req.adminUser, c: null, error: err.message });
  }
});

// Detail (tabs: overview, invoices, files, assets, onboarding, emails)
// Only loads data for the active tab; other tabs get lightweight counts.
router.get('/:id', async (req, res) => {
  const db = req.db;
  const client = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
  if (!client) return res.redirect('/admin/clients');

  const cid = client._id.toString();
  const tab = req.query.tab || 'overview';

  // Always fetch counts (cheap) for tab badges
  const [invoiceCount, fileCount, assetCount, emailCount] = await Promise.all([
    db.collection('invoices').countDocuments({ clientId: cid }),
    db.collection('files').countDocuments({ clientId: cid }),
    db.collection('assets').countDocuments({ clientId: cid }),
    db.collection('client_emails').countDocuments({ clientId: cid }),
  ]);

  // Only load full data for the active tab
  let invoices = [], files = [], assets = [], emails = [];
  let threads = [], unthreaded = [], showArchived = false, archivedCount = 0;
  let onboardingForms = [], onboardingResponses = [];

  if (tab === 'onboarding') {
    onboardingForms = await db.collection('onboarding_forms')
      .find({ status: 'active', assignTo: 'client-onboarding' })
      .sort({ updatedAt: -1 }).toArray();
    if (onboardingForms.length) {
      onboardingResponses = await db.collection('onboarding_responses')
        .find({ clientId: client._id, formId: { $in: onboardingForms.map(f => f._id) } })
        .sort({ createdAt: -1 }).toArray();
    }
  } else if (tab === 'invoices') {
    invoices = await db.collection('invoices').find({ clientId: cid }).sort({ createdAt: -1 }).toArray();
  } else if (tab === 'files') {
    files = await db.collection('files').find({ clientId: cid }).sort({ uploadedAt: -1 }).toArray();
  } else if (tab === 'assets') {
    assets = await db.collection('assets').find({ clientId: cid }).sort({ uploadedAt: -1 }).toArray();
  } else if (tab === 'emails') {
    emails = await db.collection('client_emails').find({ clientId: cid }).sort({ sentAt: 1 }).toArray();

    // Split active vs archived
    showArchived = req.query.showArchived === '1';
    const activeEmails = emails.filter(e => !e.archived);
    const archivedEmails = emails.filter(e => e.archived);
    archivedCount = archivedEmails.length;
    const displayEmails = showArchived ? archivedEmails : activeEmails;

    // Build threads from display set
    const threadMap = new Map();
    for (const em of displayEmails) {
      const tid = em.threadId?.toString();
      if (tid) {
        if (!threadMap.has(tid)) threadMap.set(tid, []);
        threadMap.get(tid).push(em);
      } else {
        unthreaded.push(em);
      }
    }
    threads = [...threadMap.values()]
      .map(msgs => ({ root: msgs[0], messages: msgs, lastAt: msgs[msgs.length - 1].sentAt, allIds: msgs.map(m => m._id.toString()) }))
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    unthreaded.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  }

  res.render('admin/clients/detail', {
    user: req.adminUser, c: client, invoices, files, assets, emails,
    threads, unthreaded, tab, qs: req.query, showArchived, archivedCount,
    counts: { invoices: invoiceCount, files: fileCount, assets: assetCount, emails: emailCount },
    tagDefs: CLIENT_TAGS, configStatus: getClientConfig(client), configChecks: CLIENT_CONFIG,
    onboardingForms, onboardingResponses,
  });
});

// Edit form
router.get('/:id/edit', async (req, res) => {
  const db = req.db;
  const client = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
  if (!client) return res.redirect('/admin/clients');
  res.render('admin/clients/form', { user: req.adminUser, c: client, error: null });
});

// ── CLIENT AGENT — research client & generate onboarding KB ──
router.post('/:id/agent', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const client = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const result = await handleResearchClient({
      clientName: client.name,
      company: client.company,
      website: client.website,
      notes: client.notes,
      email: client.email,
      prompt: req.body.prompt || '',
      brandContext: await loadBrandContext(req.tenant, req.db),
    });

    // Persist agent report to client record
    await db.collection('clients').updateOne(
      { _id: client._id },
      { $set: { agentReport: { ...result.fill, generatedAt: new Date() } } }
    );

    res.json({ success: true, message: result.message, report: result.fill });
  } catch (err) {
    console.error('[Clients] Agent error:', err);
    res.status(500).json({ error: err.message || 'Agent research failed' });
  }
});

// ── START MEETING — create meeting, email client invite, redirect ──
router.post('/:id/start-meeting', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const client = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    const title = `Meeting with ${client.name}`;

    await db.collection('meetings').insertOne({
      title,
      token,
      createdBy: req.adminUser?.email || 'admin',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours
      maxUses: null,
      useCount: 0,
      status: 'active',
      participants: [],
      notes: [],
      assets: [],
      tags: { clients: [client._id], users: [] },
    });

    // Send email invite if client has email
    if (client.email) {
      const meetingUrl = `${req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN}/meeting/${token}`;
      const body = `<p>Hi ${client.name?.split(' ')[0] || 'there'},</p>
<p>You've been invited to a meeting with <strong>${req.tenant?.brand?.name || 'us'}</strong>.</p>
<p><a href="${meetingUrl}" style="display:inline-block;padding:12px 28px;background:#1C2B4A;color:#F5F3EF;text-decoration:none;border-radius:3px;font-weight:600;">Join Meeting</a></p>
<p style="color:#6B7380;font-size:13px;">Or copy this link: ${meetingUrl}</p>
<p style="margin-top:20px;">Looking forward to connecting!<br>— ${req.tenant?.brand?.name || 'The Team'}</p>`;

      try {
        await sendClientEmail(client.email, [], `${title} — Join Link`, body, null, req.tenant);
      } catch (emailErr) {
        console.error('[Clients] Meeting invite email failed:', emailErr.message);
        // Continue — meeting was created, email is best-effort
      }
    }

    res.json({ success: true, meetingUrl: `/meeting/${token}`, token, emailSent: !!client.email });
  } catch (err) {
    console.error('[Clients] Start meeting error:', err);
    res.status(500).json({ error: err.message || 'Failed to create meeting' });
  }
});

// Update client
router.post('/:id', async (req, res) => {
  try {
    const db = req.db;
    const { name, email, phone, company, status, notes, website, address } = req.body;
    await db.collection('clients').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { name: name?.trim(), email: email?.trim(), phone: phone?.trim(), company: company?.trim(), website: website?.trim(), address: address?.trim(), status, notes: notes?.trim(), updatedAt: new Date() } }
    );
    res.redirect(`/admin/clients/${req.params.id}`);
  } catch (err) {
    const db = req.db;
    const client = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
    res.render('admin/clients/form', { user: req.adminUser, c: client, error: err.message });
  }
});

// Toggle client tag
router.post('/:id/tags', async (req, res) => {
  const { tag, action } = req.body;
  if (!tag || !CLIENT_TAGS[tag]) return res.redirect(`/admin/clients/${req.params.id}`);
  const db = req.db;
  const op = action === 'remove'
    ? { $pull: { tags: tag }, $set: { updatedAt: new Date() } }
    : { $addToSet: { tags: tag }, $set: { updatedAt: new Date() } };
  await db.collection('clients').updateOne({ _id: new ObjectId(req.params.id) }, op);
  if (req.headers.accept?.includes('application/json')) return res.json({ ok: true });
  res.redirect(`/admin/clients/${req.params.id}`);
});

// Toggle client status (AJAX)
router.post('/:id/status', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { status } = req.body;
    const allowed = ['prospect', 'active', 'inactive'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await db.collection('clients').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } }
    );
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete client
router.post('/:id/delete', async (req, res) => {
  const db = req.db;
  await db.collection('clients').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/clients');
});

// ── INVOICES ──
router.post('/:id/invoices', async (req, res) => {
  try {
    const db = req.db;
    const { title, dueDate, notes, status } = req.body;

    // Parse line items from form (arrays of description[], quantity[], unitPrice[])
    let lineItems = [];
    if (req.body['description[]']) {
      const descs = [].concat(req.body['description[]']);
      const qtys = [].concat(req.body['quantity[]']);
      const prices = [].concat(req.body['unitPrice[]']);
      for (let i = 0; i < descs.length; i++) {
        if (descs[i]?.trim()) {
          lineItems.push({
            description: descs[i].trim(),
            quantity: parseFloat(qtys[i]) || 1,
            unitPrice: parseFloat(prices[i]) || 0,
          });
        }
      }
    }
    const amount = lineItems.length ? calculateTotal(lineItems) : parseFloat(req.body.amount) || 0;

    // Recurring config
    const recurEnabled = req.body.recurringEnabled === 'on';
    const frequency = req.body.recurringFrequency || null;

    const invoiceNumber = await generateInvoiceNumber(db);
    const paymentToken = generatePaymentToken();

    await db.collection('invoices').insertOne({
      clientId: req.params.id,
      invoiceNumber,
      title: title?.trim() || 'Invoice',
      lineItems,
      amount,
      status: status || 'draft',
      dueDate: dueDate || null,
      notes: notes?.trim() || '',
      paymentToken,
      recurring: {
        enabled: recurEnabled,
        frequency: recurEnabled ? frequency : null,
        nextGenerateDate: recurEnabled ? getNextGenerateDate(frequency) : null,
        autoSend: req.body.recurringAutoSend === 'on',
      },
      payments: [],
      emailSentAt: null,
      emailSentTo: null,
      createdAt: new Date(),
    });
    res.redirect(`/admin/clients/${req.params.id}?tab=invoices`);
  } catch (err) {
    console.error('Invoice create error:', err);
    res.redirect(`/admin/clients/${req.params.id}?tab=invoices&error=1`);
  }
});

// Send invoice email
router.post('/:id/invoices/:invoiceId/send', async (req, res) => {
  try {
    const db = req.db;
    const invoice = await db.collection('invoices').findOne({ _id: new ObjectId(req.params.invoiceId) });
    const clientDoc = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
    if (!invoice || !clientDoc?.email) {
      return res.redirect(`/admin/clients/${req.params.id}?tab=invoices&error=noemail`);
    }
    const paymentUrl = `${req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN}/pay/${invoice.paymentToken}`;
    await sendInvoiceEmail(invoice, clientDoc, paymentUrl, req.tenant);
    await db.collection('invoices').updateOne(
      { _id: invoice._id },
      { $set: { emailSentAt: new Date(), emailSentTo: clientDoc.email, status: invoice.status === 'draft' ? 'sent' : invoice.status } }
    );
    res.redirect(`/admin/clients/${req.params.id}?tab=invoices&sent=1`);
  } catch (err) {
    console.error('Invoice send error:', err);
    res.redirect(`/admin/clients/${req.params.id}?tab=invoices&error=sendfail`);
  }
});

router.post('/:id/invoices/:invoiceId/delete', async (req, res) => {
  const db = req.db;
  await db.collection('invoices').deleteOne({ _id: new ObjectId(req.params.invoiceId) });
  res.redirect(`/admin/clients/${req.params.id}?tab=invoices`);
});

router.post('/:id/invoices/:invoiceId/status', async (req, res) => {
  const db = req.db;
  await db.collection('invoices').updateOne(
    { _id: new ObjectId(req.params.invoiceId) },
    { $set: { status: req.body.status, updatedAt: new Date() } }
  );
  res.redirect(`/admin/clients/${req.params.id}?tab=invoices`);
});

// ── EMAILS ──
router.post('/:id/emails/send', async (req, res) => {
  try {
    const db = req.db;
    const client = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
    if (!client) return res.redirect('/admin/clients');

    const { to, cc, subject, body } = req.body;
    const toAddr = to || client.email;
    if (!toAddr) return res.redirect(`/admin/clients/${req.params.id}?tab=emails&error=No+email+address`);
    if (!subject || !body) return res.redirect(`/admin/clients/${req.params.id}?tab=emails&error=Subject+and+body+required`);

    // Send the email
    const ccList = cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : [];
    const info = await sendClientEmail(toAddr, ccList, subject, body, null, req.tenant);

    // Store in history — this outbound becomes the thread root
    const baseSubj = normalizeSubject(subject);
    const result = await db.collection('client_emails').insertOne({
      clientId: client._id.toString(),
      direction: 'outbound',
      from: config.ZOHO_USER,
      to: toAddr,
      cc: ccList,
      subject,
      baseSubject: baseSubj,
      body,
      messageId: info?.messageId || null,
      source: 'direct',
      sentBy: req.adminUser?.displayName || 'admin',
      sentAt: new Date(),
    });
    // Set threadId to own _id (thread root)
    await db.collection('client_emails').updateOne(
      { _id: result.insertedId },
      { $set: { threadId: result.insertedId } }
    );

    console.log(`[Clients] Email sent to ${toAddr} (client: ${client.name})`);
    res.redirect(`/admin/clients/${req.params.id}?tab=emails&success=Email+sent`);
  } catch (err) {
    console.error('Client email error:', err);
    res.redirect(`/admin/clients/${req.params.id}?tab=emails&error=${encodeURIComponent(err.message || 'Send failed')}`);
  }
});

// ── Inline reply to thread ──
router.post('/:id/emails/reply', async (req, res) => {
  try {
    const db = req.db;
    const client = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
    if (!client) return res.redirect('/admin/clients');

    const { to, subject, body, threadId } = req.body;
    const toAddr = to || client.email;
    if (!toAddr || !body) return res.redirect(`/admin/clients/${req.params.id}?tab=emails&error=Body+required`);

    const replySubject = subject || 'Re: (no subject)';

    // Build threading headers from the last message in thread
    let threadHeaders = null;
    if (threadId) {
      const threadMessages = await db.collection('client_emails')
        .find({ $or: [{ threadId: new ObjectId(threadId) }, { _id: new ObjectId(threadId) }] })
        .sort({ sentAt: -1 })
        .limit(5)
        .toArray();

      // Find the most recent message with a messageId
      const lastWithId = threadMessages.find(m => m.messageId);
      if (lastWithId) {
        // Collect all messageIds in the thread for References header
        const allMessageIds = threadMessages.map(m => m.messageId).filter(Boolean);
        threadHeaders = {
          inReplyTo: lastWithId.messageId,
          references: allMessageIds.join(' '),
        };
      }
    }

    const info = await sendClientEmail(toAddr, [], replySubject, body, threadHeaders, req.tenant);

    await db.collection('client_emails').insertOne({
      clientId: client._id.toString(),
      direction: 'outbound',
      from: config.ZOHO_USER,
      to: toAddr,
      cc: [],
      subject: replySubject,
      baseSubject: normalizeSubject(replySubject),
      body,
      messageId: info?.messageId || null,
      threadId: threadId ? new ObjectId(threadId) : null,
      source: 'direct',
      sentBy: req.adminUser?.displayName || 'admin',
      sentAt: new Date(),
    });

    console.log(`[Clients] Reply sent to ${toAddr} (thread: ${replySubject})`);
    res.redirect(`/admin/clients/${req.params.id}?tab=emails&success=Reply+sent`);
  } catch (err) {
    console.error('Reply error:', err);
    res.redirect(`/admin/clients/${req.params.id}?tab=emails&error=${encodeURIComponent(err.message || 'Reply failed')}`);
  }
});

// ── Archive/unarchive emails ──
router.post('/:id/emails/archive', async (req, res) => {
  const db = req.db;
  const ids = req.body.emailIds; // single ID or array
  const idList = Array.isArray(ids) ? ids : [ids];
  await db.collection('client_emails').updateMany(
    { _id: { $in: idList.map(id => new ObjectId(id)) } },
    { $set: { archived: true, archivedAt: new Date() } }
  );
  res.redirect(`/admin/clients/${req.params.id}?tab=emails&success=Archived`);
});

router.post('/:id/emails/unarchive', async (req, res) => {
  const db = req.db;
  const ids = req.body.emailIds;
  const idList = Array.isArray(ids) ? ids : [ids];
  await db.collection('client_emails').updateMany(
    { _id: { $in: idList.map(id => new ObjectId(id)) } },
    { $set: { archived: false }, $unset: { archivedAt: '' } }
  );
  res.redirect(`/admin/clients/${req.params.id}?tab=emails&showArchived=1&success=Unarchived`);
});

// ── FILES ──
router.post('/:id/files', clientFileUpload.single('file'), async (req, res) => {
  try {
    const db = req.db;
    let fileUrl = '', bucketKey = '', fileName = '', fileSize = 0, fileType = '';

    if (req.file) {
      fileName = req.file.originalname;
      fileSize = req.file.size;
      fileType = req.file.mimetype;
      if (req.file.location) {
        fileUrl = req.file.location;
        bucketKey = req.file.key;
      }
    }

    await db.collection('files').insertOne({
      clientId: req.params.id,
      name: fileName,
      label: req.body.label?.trim() || fileName,
      url: fileUrl,
      bucketKey,
      size: fileSize,
      type: fileType,
      uploadedAt: new Date(),
    });
    res.redirect(`/admin/clients/${req.params.id}?tab=files`);
  } catch (err) {
    res.redirect(`/admin/clients/${req.params.id}?tab=files&error=1`);
  }
});

router.post('/:id/files/:fileId/delete', async (req, res) => {
  const db = req.db;
  await db.collection('files').deleteOne({ _id: new ObjectId(req.params.fileId) });
  res.redirect(`/admin/clients/${req.params.id}?tab=files`);
});

// ── ONBOARDING ──
router.post('/:id/onboarding', async (req, res) => {
  try {
    const db = req.db;
    const { businessType, goals, budget, timeline, socialPlatforms, currentWebsite, brandNotes, step } = req.body;
    // Parse brand colors from comma/space separated input
    const rawColors = req.body.brandColors || '';
    const brandColors = rawColors.split(/[,\s]+/).map(c => c.trim()).filter(c => /^#[0-9a-fA-F]{3,8}$/.test(c));
    // Brand fonts
    const brandFonts = {
      heading: (req.body.brandFontHeading || '').trim(),
      body: (req.body.brandFontBody || '').trim(),
    };
    await db.collection('clients').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: {
        'onboarding.data': { businessType, goals, budget, timeline, socialPlatforms, currentWebsite, brandNotes },
        'onboarding.step': parseInt(step) || 1,
        'onboarding.complete': step === 'done',
        'onboarding.updatedAt': new Date(),
        brandColors,
        brandFonts,
      }}
    );
    res.redirect(`/admin/clients/${req.params.id}?tab=onboarding`);
  } catch (err) {
    res.redirect(`/admin/clients/${req.params.id}?tab=onboarding&error=1`);
  }
});

export default router;
