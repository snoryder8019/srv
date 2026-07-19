import express from 'express';
import { ObjectId } from 'mongodb';
import { generateInvoiceNumber } from '../../plugins/invoiceHelpers.js';
import { sendClientEmail } from '../../plugins/mailer.js';
import { clientFileUpload } from '../../middleware/upload.js';
import { config } from '../../config/config.js';
import { callLLM, tryParseAgentResponse } from '../../plugins/agentMcp.js';
import { agentLLMOpts } from '../../plugins/agentRegistry.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { buildClientNotes } from '../../plugins/clientNotes.js';
import {
  generateEngagementNumber, generateEngagementToken,
  materializeTemplates, freezeDraftPackages, normalizeTermSections,
  DEFAULT_TERM_SECTIONS, hashDocument, logEvent, validateSelections,
  selectedItems, engagementToInvoice, timeframeLabel, priceLabel,
} from '../../plugins/engagements.js';

// ═══════════════════════════════════════════════════════════════════════════
// CATALOG ROUTER — /admin/engagements
// Services builder + Package builder live HERE. Letters call on them.
// ═══════════════════════════════════════════════════════════════════════════
const catalogRouter = express.Router();

catalogRouter.get('/', async (req, res) => {
  const db = req.db;
  const [services, templates, engagements, clients] = await Promise.all([
    db.collection('services').find({ active: { $ne: false } }).sort({ sortOrder: 1, createdAt: 1 }).toArray(),
    db.collection('package_templates').find({}).sort({ createdAt: 1 }).toArray(),
    db.collection('engagements').find({}).sort({ createdAt: -1 }).limit(50).toArray(),
    db.collection('clients').find({}).project({ name: 1, company: 1 }).toArray(),
  ]);
  const clientMap = {};
  for (const c of clients) clientMap[c._id.toString()] = c.name || c.company || 'Client';
  res.render('admin/engagements/index', {
    user: req.adminUser, services, templates, engagements, clients, clientMap,
    timeframeLabel, priceLabel, qs: req.query,
  });
});

// ── Services CRUD ──
function parseServiceBody(body) {
  return {
    name: (body.name || '').trim(),
    blurb: (body.blurb || '').trim(),
    description: (body.description || '').trim(),
    category: body.category || 'build',
    pricing: {
      model: body.pricingModel || 'one-time',
      amount: parseFloat(body.amount) || 0,
      discountPct: body.discountPct ? parseFloat(body.discountPct) : null,
      discountLabel: (body.discountLabel || '').trim(),
    },
    timeframe: {
      value: parseInt(body.tfValue) || 0,
      unit: body.tfUnit || 'days',
      startsFrom: body.tfStartsFrom || 'requirements',
      label: (body.tfLabel || '').trim(),
    },
    deliverables: (body.deliverables || '').split('\n').map(s => s.trim()).filter(Boolean),
    active: true,
    sortOrder: parseInt(body.sortOrder) || 0,
    updatedAt: new Date(),
  };
}

catalogRouter.post('/services', async (req, res) => {
  try {
    const doc = parseServiceBody(req.body);
    if (!doc.name) return res.redirect('/admin/engagements?error=Name+required');
    doc.createdAt = new Date();
    await req.db.collection('services').insertOne(doc);
    res.redirect('/admin/engagements?success=Service+created');
  } catch (err) {
    console.error('[engagements] service create:', err);
    res.redirect('/admin/engagements?error=' + encodeURIComponent(err.message));
  }
});

catalogRouter.post('/services/:sid', async (req, res) => {
  try {
    const doc = parseServiceBody(req.body);
    await req.db.collection('services').updateOne(
      { _id: new ObjectId(req.params.sid) }, { $set: doc }
    );
    res.redirect('/admin/engagements?success=Service+updated');
  } catch (err) {
    res.redirect('/admin/engagements?error=' + encodeURIComponent(err.message));
  }
});

// Soft delete — a hard delete orphans serviceId provenance on old engagements
catalogRouter.post('/services/:sid/delete', async (req, res) => {
  await req.db.collection('services').updateOne(
    { _id: new ObjectId(req.params.sid) },
    { $set: { active: false, updatedAt: new Date() } }
  );
  res.redirect('/admin/engagements?success=Service+archived');
});

// ── Package templates — built once here, called on from any letter ──
function parseTemplateBody(body) {
  let options = [];
  try { options = JSON.parse(body.optionsJson || '[]'); } catch { options = []; }
  return {
    name: (body.name || '').trim(),
    label: (body.label || body.name || '').trim(),
    selectMode: ['one', 'many', 'required'].includes(body.selectMode) ? body.selectMode : 'one',
    options: options.map(o => ({
      key: String(o.key || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'option',
      name: String(o.name || '').slice(0, 300),
      recommended: !!o.recommended,
      recommendedNote: String(o.recommendedNote || '').slice(0, 500),
      serviceIds: Array.isArray(o.serviceIds) ? o.serviceIds.map(String) : [],
    })).filter(o => o.name && o.serviceIds.length),
    updatedAt: new Date(),
  };
}

catalogRouter.post('/templates', async (req, res) => {
  try {
    const doc = parseTemplateBody(req.body);
    if (!doc.name || !doc.options.length) return res.redirect('/admin/engagements?error=Template+needs+a+name+and+at+least+one+option+with+services');
    if (req.body.templateId) {
      await req.db.collection('package_templates').updateOne({ _id: new ObjectId(req.body.templateId) }, { $set: doc });
      return res.redirect('/admin/engagements?success=Template+updated');
    }
    doc.createdAt = new Date();
    await req.db.collection('package_templates').insertOne(doc);
    res.redirect('/admin/engagements?success=Template+created');
  } catch (err) {
    console.error('[engagements] template save:', err);
    res.redirect('/admin/engagements?error=' + encodeURIComponent(err.message));
  }
});

catalogRouter.post('/templates/:tid/delete', async (req, res) => {
  // Hard delete is fine — letters hold materialized copies, nothing references templates
  await req.db.collection('package_templates').deleteOne({ _id: new ObjectId(req.params.tid) });
  res.redirect('/admin/engagements?success=Template+deleted');
});

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT ROUTER — /admin/clients/:id/engagements  (mergeParams)
// ═══════════════════════════════════════════════════════════════════════════
const clientRouter = express.Router({ mergeParams: true });

async function loadPair(req) {
  const db = req.db;
  const client = await db.collection('clients').findOne({ _id: new ObjectId(req.params.id) });
  const engagement = req.params.eid
    ? await db.collection('engagements').findOne({ _id: new ObjectId(req.params.eid) })
    : null;
  return { db, client, engagement };
}

// List for this client
clientRouter.get('/', async (req, res) => {
  const { db, client } = await loadPair(req);
  if (!client) return res.redirect('/admin/clients');
  const [engagements, services] = await Promise.all([
    db.collection('engagements').find({ clientId: client._id.toString() }).sort({ createdAt: -1 }).toArray(),
    db.collection('services').find({ active: { $ne: false } }).sort({ sortOrder: 1 }).toArray(),
  ]);
  res.render('admin/engagements/client', {
    user: req.adminUser, c: client, engagements, services,
    timeframeLabel, priceLabel, qs: req.query,
  });
});

// Editor (draft) / detail (sent+) view
clientRouter.get('/:eid', async (req, res) => {
  const { db, client, engagement } = await loadPair(req);
  if (!client || !engagement) return res.redirect('/admin/clients');
  const [services, rawTemplates] = await Promise.all([
    db.collection('services').find({ active: { $ne: false } }).sort({ sortOrder: 1 }).toArray(),
    db.collection('package_templates').find({}).sort({ createdAt: 1 }).toArray(),
  ]);
  const templates = await materializeTemplates(db, rawTemplates);
  const clientNotes = await buildClientNotes(db, client);
  res.render('admin/engagements/editor', {
    user: req.adminUser, c: client, e: engagement, services, templates,
    timeframeLabel, priceLabel, qs: req.query, clientNotes,
    publicUrl: `${req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN}/engage/${engagement.accessToken}`,
  });
});

// Create draft — arrives with the standard clause set already in place
clientRouter.post('/', async (req, res) => {
  try {
    const { db, client } = await loadPair(req);
    if (!client) return res.redirect('/admin/clients');
    const engagementNumber = await generateEngagementNumber(db, req.tenant);
    const r = await db.collection('engagements').insertOne({
      clientId: client._id.toString(),
      engagementNumber,
      title: (req.body.title || 'Letter of Engagement').trim(),
      status: 'draft',
      accessToken: generateEngagementToken(),
      intro: '',
      termsSections: DEFAULT_TERM_SECTIONS.map(s => ({ ...s })),
      validUntil: null,
      draftPackages: [],      // materialized items — the letter owns its copies
      packages: [],           // frozen at send
      selections: {}, notes: [],
      declined: null,
      signature: null,
      acknowledgedAt: null, acknowledgedBy: null,
      w9: { requestedAt: null, requestedBy: null, releasedAt: null, releasedBy: null, fileId: null, revision: null },
      auditLog: [],
      sentAt: null, sentTo: null, viewedAt: null, viewCount: 0,
      invoiceIds: [],
      createdAt: new Date(), updatedAt: new Date(),
    });
    res.redirect(`/admin/clients/${client._id}/engagements/${r.insertedId}`);
  } catch (err) {
    console.error('[engagements] create:', err);
    res.redirect(`/admin/clients/${req.params.id}/engagements?error=1`);
  }
});

// Update — drafts freely; sent docs get a 409 (the freeze rule, enforced server-side)
clientRouter.post('/:eid', async (req, res) => {
  try {
    const { db, engagement } = await loadPair(req);
    if (!engagement) return res.status(404).send('Not found');
    if (engagement.status !== 'draft') {
      return res.status(409).send('This letter has been sent and is frozen. Duplicate it, void the original, and send the new version.');
    }
    let draftPackages = engagement.draftPackages || [];
    if (req.body.packagesJson) {
      try { draftPackages = JSON.parse(req.body.packagesJson); }
      catch { return res.status(400).send('Invalid package JSON'); }
    }
    let termsSections = engagement.termsSections || [];
    if (req.body.termsJson) {
      try { termsSections = normalizeTermSections(JSON.parse(req.body.termsJson)); }
      catch { return res.status(400).send('Invalid terms JSON'); }
    }
    await db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: {
        title: (req.body.title || engagement.title).trim(),
        intro: String(req.body.intro ?? engagement.intro).slice(0, 6000),
        termsSections,
        validUntil: req.body.validUntil ? new Date(req.body.validUntil) : null,
        draftPackages,
        updatedAt: new Date(),
      } }
    );
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?success=Saved`);
  } catch (err) {
    console.error('[engagements] update:', err);
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=1`);
  }
});

// AGENT — drafts the intro or the term clauses from client + package context.
// Output is structured (plain text / JSON clauses), never raw HTML: the letter
// layout is fixed and the agent only feeds it.
clientRouter.post('/:eid/agent', express.json(), async (req, res) => {
  try {
    const { db, client, engagement } = await loadPair(req);
    if (!client || !engagement) return res.status(404).json({ error: 'Not found' });
    if (engagement.status !== 'draft') return res.status(409).json({ error: 'This letter is frozen — duplicate it to redraft.' });

    const { target, instruction, draft } = req.body;
    if (!['intro', 'terms'].includes(target)) return res.status(400).json({ error: 'target must be intro or terms' });

    // Current editor state (unsaved) takes precedence over the stored doc
    const pkgs = Array.isArray(draft?.packages) ? draft.packages : (engagement.draftPackages || []);
    const curIntro = typeof draft?.intro === 'string' ? draft.intro : (engagement.intro || '');
    const curTerms = Array.isArray(draft?.termsSections) ? draft.termsSections : (engagement.termsSections || []);

    const pkgCtx = pkgs.length ? pkgs.map(p =>
      `- ${p.label} (${p.selectMode === 'many' ? 'select any' : 'select one'}):\n` +
      (p.options || []).map(o =>
        `    * ${o.name}${o.recommended ? ' [RECOMMENDED' + (o.recommendedNote ? ': ' + o.recommendedNote : '') + ']' : ''}\n` +
        (o.items || []).map(i => `        · ${i.name} — ${priceLabel(i.pricing)}${i.timeframe && timeframeLabel(i.timeframe) ? ' · ' + timeframeLabel(i.timeframe) : ''}`).join('\n')
      ).join('\n')
    ).join('\n') : 'No packages added yet.';

    const ob = client.onboarding?.data || {};
    const brandCtx = await loadBrandContext(req.tenant, req.db);
    const firstName = client.name?.split(' ')[0] || 'there';

    const baseCtx = `${brandCtx}

--- CLIENT: ${client.name}${client.company ? ` (${client.company})` : ''} ---
${Object.keys(ob).length ? `Business: ${ob.businessType || '—'}; Goals: ${ob.goals || '—'}; Budget: ${ob.budget || '—'}; Timeline: ${ob.timeline || '—'}` : 'No onboarding answers captured.'}
--- LETTER ---
Title: ${engagement.title}
${engagement.validUntil ? `Valid until: ${new Date(engagement.validUntil).toDateString()}` : 'No expiry set.'}
Packages on this letter:
${pkgCtx}`;

    let systemPrompt;
    if (target === 'intro') {
      systemPrompt = `You draft the opening of a letter of engagement (a services agreement a client reads and signs online).

${baseCtx}
${curIntro ? `\n--- CURRENT INTRO (refine if the user asks for edits) ---\n${curIntro}\n--- END ---` : ''}

Your output MUST be a one-line JSON object, then the intro text inside <CONTENT>…</CONTENT> sentinel tags. Nothing else.

EXAMPLE OUTPUT:
{"message":"Drafted a warm intro referencing their goals."}
<CONTENT>
Dear ${firstName},

Thank you for the conversation about your business. This letter lays out exactly what we would build together, what it costs, and when it lands — choose the option that fits and sign when you're ready.

We keep this simple on purpose: the services below are the whole story, and nothing is engaged except what you select.
</CONTENT>

RULES:
- PLAIN TEXT ONLY inside <CONTENT>. No HTML, no markdown. Blank lines separate paragraphs.
- 2-4 short paragraphs, ≈60-140 words. Warm, plain-spoken, specific to this client and these packages. Do not invent facts or prices.
- Do not include a signature block or a "Sincerely" — the layout handles closings.`;
    } else {
      systemPrompt = `You draft the terms sections of a letter of engagement (a services agreement a client reads and signs online).

${baseCtx}
${curTerms.length ? `\n--- CURRENT TERMS (revise these per the user's instruction; keep sections they didn't ask to change) ---\n${JSON.stringify(curTerms)}\n--- END ---` : ''}

Your output MUST be a one-line JSON object, then a STRICT JSON array inside <CONTENT>…</CONTENT> sentinel tags. Nothing else.

EXAMPLE OUTPUT:
{"message":"Tightened the payment clause and added a hosting section."}
<CONTENT>
[{"heading":"Services & Selection","body":"The services engaged are exactly those selected above at the prices shown."},{"heading":"Payment","body":"One-time fees are invoiced on engagement confirmation. Recurring fees are billed monthly and continue until cancelled."}]
</CONTENT>

RULES:
- The <CONTENT> block is a strict JSON array of {"heading","body"} objects. Double quotes only. No markdown, no trailing commas, no comments.
- body is PLAIN TEXT (may contain \\n for line breaks). No HTML.
- 5-10 sections. Plain-language, client-friendly terms grounded in the actual packages above (payment cadence should match the pricing models present). Do not invent prices.
- These are business terms written by the business owner, not legal advice; keep them clear and fair.`;
    }

    const messages = [{ role: 'user', content: String(instruction || (target === 'intro' ? 'Draft the introduction.' : 'Draft the terms.')).slice(0, 2000) }];
    const raw = await callLLM(messages, systemPrompt, 90000, await agentLLMOpts(req.db, req.tenant, 'outreach'));
    const parsed = tryParseAgentResponse(raw);
    const content = (parsed.fill?.content || '').trim();
    if (!content) return res.status(500).json({ error: 'Agent returned no content — try again.' });

    if (target === 'intro') {
      return res.json({ message: parsed.message, fill: { intro: content.slice(0, 6000) } });
    }
    // terms — parse the strict JSON array
    let sections;
    try { sections = normalizeTermSections(JSON.parse(content)); }
    catch { return res.status(500).json({ error: 'Agent returned malformed terms — try again.' }); }
    if (!sections.length) return res.status(500).json({ error: 'Agent returned no usable sections — try again.' });
    res.json({ message: parsed.message, fill: { termsSections: sections } });
  } catch (err) {
    console.error('[engagements] agent:', err);
    res.status(500).json({ error: err.message || 'Agent draft failed' });
  }
});

// SEND — the freeze point. Normalize the letter's own package copies, email the client.
clientRouter.post('/:eid/send', async (req, res) => {
  try {
    const { db, client, engagement } = await loadPair(req);
    if (!client || !engagement) return res.redirect('/admin/clients');
    if (engagement.status !== 'draft') {
      return res.status(409).send('Already sent. Duplicate to make changes.');
    }
    if (!client.email) {
      return res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=Client+has+no+email`);
    }
    const packages = freezeDraftPackages(engagement.draftPackages);
    if (!packages.length) {
      return res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=Add+at+least+one+package+with+options+before+sending`);
    }
    const url = `${req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN}/engage/${engagement.accessToken}`;
    const brandName = req.tenant?.brand?.name || 'us';
    const body = `<p>Hi ${client.name?.split(' ')[0] || 'there'},</p>
<p>Your letter of engagement from <strong>${brandName}</strong> is ready for review.</p>
<p>You can review the services and terms, leave notes or questions, and sign electronically — all from the link below.</p>
<p><a href="${url}" style="display:inline-block;padding:12px 28px;background:#1C2B4A;color:#F5F3EF;text-decoration:none;border-radius:3px;font-weight:600;">Review Engagement Letter</a></p>
<p style="color:#6B7380;font-size:13px;">Or copy this link: ${url}</p>
${engagement.validUntil ? `<p style="color:#6B7380;font-size:13px;">These terms are valid through ${new Date(engagement.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</p>` : ''}
<p style="margin-top:20px;">— ${brandName}</p>`;
    await sendClientEmail(client.email, [], `Letter of Engagement — ${engagement.engagementNumber}`, body, null, req.tenant);
    await db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: { packages, status: 'sent', sentAt: new Date(), sentTo: client.email, updatedAt: new Date() } }
    );
    await logEvent(db, engagement._id, 'sent', req, { to: client.email });
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?success=Sent+to+${encodeURIComponent(client.email)}`);
  } catch (err) {
    console.error('[engagements] send:', err);
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=${encodeURIComponent(err.message || 'Send failed')}`);
  }
});

// Duplicate — the only edit path for a sent letter. Copies are already materialized.
clientRouter.post('/:eid/duplicate', async (req, res) => {
  const { db, engagement } = await loadPair(req);
  if (!engagement) return res.redirect('/admin/clients');
  const engagementNumber = await generateEngagementNumber(db, req.tenant);
  // Prefer the frozen snapshot (it reflects what was actually offered); fall back to draft
  const source = engagement.packages?.length ? engagement.packages : (engagement.draftPackages || []);
  const draftPackages = source.map(p => ({
    key: p.key, label: p.label, selectMode: p.selectMode,
    options: (p.options || []).map(o => ({
      key: o.key, name: o.name, recommended: !!o.recommended, recommendedNote: o.recommendedNote || '',
      items: (o.items || []).map(i => ({
        serviceId: i.serviceId || null, name: i.name, blurb: i.blurb || '',
        deliverables: i.deliverables || [],
        pricing: { model: i.pricing?.model || 'one-time', amount: Number(i.pricing?.amount || 0) },
        timeframe: i.timeframe ? { ...i.timeframe } : null,
      })),
    })),
  }));
  const r = await db.collection('engagements').insertOne({
    clientId: engagement.clientId,
    engagementNumber,
    title: engagement.title,
    status: 'draft',
    accessToken: generateEngagementToken(),
    intro: engagement.intro || '',
    termsSections: (engagement.termsSections || DEFAULT_TERM_SECTIONS).map(s => ({ ...s })),
    validUntil: null,
    draftPackages, packages: [],
    selections: {}, notes: [], declined: null, signature: null,
    acknowledgedAt: null, acknowledgedBy: null,
    w9: { requestedAt: null, requestedBy: null, releasedAt: null, releasedBy: null, fileId: null, revision: null },
    auditLog: [], sentAt: null, sentTo: null, viewedAt: null, viewCount: 0,
    invoiceIds: [],
    duplicatedFrom: engagement._id.toString(),
    createdAt: new Date(), updatedAt: new Date(),
  });
  res.redirect(`/admin/clients/${req.params.id}/engagements/${r.insertedId}?success=Duplicated`);
});

clientRouter.post('/:eid/void', async (req, res) => {
  const { db, engagement } = await loadPair(req);
  if (!engagement) return res.redirect('/admin/clients');
  await db.collection('engagements').updateOne(
    { _id: engagement._id },
    { $set: { status: 'void', updatedAt: new Date() } }
  );
  await logEvent(db, engagement._id, 'voided', req, { by: req.adminUser?.email });
  res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?success=Voided`);
});

clientRouter.post('/:eid/delete', async (req, res) => {
  const { db, engagement } = await loadPair(req);
  if (engagement?.status === 'draft') {
    await db.collection('engagements').deleteOne({ _id: engagement._id });
  }
  res.redirect(`/admin/clients/${req.params.id}/engagements`);
});

// Admin note (default internal; per-note share flag). Shared notes lock.
clientRouter.post('/:eid/notes', async (req, res) => {
  const { db, engagement } = await loadPair(req);
  if (!engagement) return res.redirect('/admin/clients');
  const visibility = req.body.visibility === 'shared' ? 'shared' : 'internal';
  const note = {
    _id: new ObjectId(),
    body: (req.body.body || '').trim(),
    author: 'admin',
    authorName: req.adminUser?.displayName || 'Admin',
    kind: 'note',
    visibility,
    notify: { sent: false, at: null },
    locked: visibility === 'shared',
    resolved: false,
    createdAt: new Date(),
  };
  if (!note.body) return res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}`);
  await db.collection('engagements').updateOne({ _id: engagement._id }, { $push: { notes: note }, $set: { updatedAt: new Date() } });
  if (visibility === 'shared') await logEvent(db, engagement._id, 'note_shared', req, { noteId: note._id.toString() });
  res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?success=Note+added`);
});

// Share an internal note (locks it) and optionally notify by email — manual, per spec
clientRouter.post('/:eid/notes/:nid/share', async (req, res) => {
  const { db, client, engagement } = await loadPair(req);
  if (!engagement) return res.redirect('/admin/clients');
  const nid = req.params.nid;
  const note = (engagement.notes || []).find(n => n._id.toString() === nid);
  if (!note) return res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}`);

  await db.collection('engagements').updateOne(
    { _id: engagement._id, 'notes._id': new ObjectId(nid) },
    { $set: { 'notes.$.visibility': 'shared', 'notes.$.locked': true, updatedAt: new Date() } }
  );
  await logEvent(db, engagement._id, 'note_shared', req, { noteId: nid });

  // notify.sent records that the send SUCCEEDED — never set it before the send lands
  if (req.body.notify === 'on' && client?.email) {
    try {
      const url = `${req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN}/engage/${engagement.accessToken}`;
      await sendClientEmail(client.email, [],
        `New note on your engagement letter — ${engagement.engagementNumber}`,
        `<p>Hi ${client.name?.split(' ')[0] || 'there'},</p><p>A note was added to your engagement letter:</p><blockquote style="border-left:3px solid #C9A848;padding-left:12px;color:#444;">${note.body}</blockquote><p><a href="${url}">View the letter</a></p>`,
        null, req.tenant);
      await db.collection('engagements').updateOne(
        { _id: engagement._id, 'notes._id': new ObjectId(nid) },
        { $set: { 'notes.$.notify': { sent: true, at: new Date() } } }
      );
    } catch (emailErr) {
      console.error('[engagements] note notify failed:', emailErr.message);
      return res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=Note+shared+but+email+FAILED`);
    }
  }
  res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?success=Note+shared`);
});

// ACKNOWLEDGE — confirm receipt + engage services. Signed → acknowledged.
clientRouter.post('/:eid/acknowledge', async (req, res) => {
  try {
    const { db, client, engagement } = await loadPair(req);
    if (!client || !engagement) return res.redirect('/admin/clients');
    if (engagement.status !== 'signed') {
      return res.status(409).send('Only signed letters can be acknowledged.');
    }
    const brandName = req.tenant?.brand?.name || 'us';
    const items = selectedItems(engagement);
    const itemLines = items.map(i => `<li>${i.name} — ${priceLabel(i.pricing)}</li>`).join('');
    const subject = `Engagement confirmed — ${engagement.engagementNumber}`;
    const body = (req.body.body || '').trim() || `<p>Hi ${client.name?.split(' ')[0] || 'there'},</p>
<p>Confirming receipt of your signed engagement letter. We're officially engaged on the following services:</p>
<ul>${itemLines}</ul>
<p>Next step from our side: your welcome package with onboarding and requirements. Watch for it shortly.</p>
<p>Thank you — looking forward to it.</p>
<p>— ${brandName}</p>`;
    const info = await sendClientEmail(client.email, [], subject, body, null, req.tenant);
    const emailDoc = await db.collection('client_emails').insertOne({
      clientId: client._id.toString(),
      direction: 'outbound',
      from: config.ZOHO_USER,
      to: client.email, cc: [],
      subject, baseSubject: subject, body,
      attachments: [],
      messageId: info?.messageId || null,
      source: 'engagement-acknowledgment',
      sentBy: req.adminUser?.displayName || 'admin',
      sentAt: new Date(),
    });
    await db.collection('client_emails').updateOne({ _id: emailDoc.insertedId }, { $set: { threadId: emailDoc.insertedId } });
    await db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: req.adminUser?.email || 'admin', updatedAt: new Date() } }
    );
    await logEvent(db, engagement._id, 'acknowledged', req, { by: req.adminUser?.email });
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?success=Acknowledged+and+client+notified`);
  } catch (err) {
    console.error('[engagements] acknowledge:', err);
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=${encodeURIComponent(err.message || 'Acknowledge failed')}`);
  }
});

// W-9 RELEASE — deliberate, per-client. Upload at release; lands in Files tab.
clientRouter.post('/:eid/w9/release', clientFileUpload.single('w9file'), async (req, res) => {
  try {
    const { db, client, engagement } = await loadPair(req);
    if (!client || !engagement) return res.redirect('/admin/clients');
    if (!['signed', 'acknowledged'].includes(engagement.status)) {
      return res.status(409).send('W-9 releases only to signed clients.');
    }
    if (!req.file?.location) {
      return res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=W-9+upload+failed+(S3+required)`);
    }
    const revision = (req.body.revision || '').trim() || 'unspecified';
    const fileDoc = await db.collection('files').insertOne({
      clientId: client._id.toString(),
      name: req.file.originalname,
      label: `W-9 (${revision})`,
      url: req.file.location,
      bucketKey: req.file.key,
      size: req.file.size,
      type: req.file.mimetype,
      source: 'w9',
      uploadedAt: new Date(),
    });
    await db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: { 'w9.releasedAt': new Date(), 'w9.releasedBy': req.adminUser?.email || 'admin', 'w9.fileId': fileDoc.insertedId.toString(), 'w9.revision': revision, updatedAt: new Date() } }
    );
    await logEvent(db, engagement._id, 'w9_released', req, { revision });
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?success=W-9+released`);
  } catch (err) {
    console.error('[engagements] w9 release:', err);
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=${encodeURIComponent(err.message || 'Release failed')}`);
  }
});

// Draft invoices from the signed selections
clientRouter.post('/:eid/to-invoice', async (req, res) => {
  try {
    const { db, engagement } = await loadPair(req);
    if (!engagement) return res.redirect('/admin/clients');
    if (!['signed', 'acknowledged'].includes(engagement.status)) {
      return res.status(409).send('Invoices generate from signed letters only.');
    }
    if (engagement.invoiceIds?.length) {
      return res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=Invoices+already+drafted+for+this+letter`);
    }
    const ids = await engagementToInvoice(db, engagement, req.tenant, generateInvoiceNumber);
    await db.collection('engagements').updateOne(
      { _id: engagement._id },
      { $set: { invoiceIds: ids.map(String), updatedAt: new Date() } }
    );
    await logEvent(db, engagement._id, 'invoices_drafted', req, { count: ids.length });
    res.redirect(`/admin/clients/${req.params.id}?tab=invoices`);
  } catch (err) {
    console.error('[engagements] to-invoice:', err);
    res.redirect(`/admin/clients/${req.params.id}/engagements/${req.params.eid}?error=${encodeURIComponent(err.message)}`);
  }
});

export { clientRouter };
export default catalogRouter;
