import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { getNextGenerateDate, generatePaymentToken } from './invoiceHelpers.js';

export const ENGAGEMENT_STATUSES = [
  'draft', 'sent', 'viewed', 'revision_requested',
  'signed', 'acknowledged', 'declined', 'expired', 'void',
];

// States in which the public page renders read-only (no selection, no sign).
export const TERMINAL_STATUSES = ['signed', 'acknowledged', 'declined', 'void'];

// States from which a client may still sign. `expired` is deliberately absent —
// /sign re-checks validUntil directly and rejects, so even a stale status can't
// let a dead offer be accepted (never trust the cron to have run first).
export const SIGNABLE_STATUSES = ['sent', 'viewed', 'revision_requested'];

// Default clause skeletons for a new draft. The letter layout is fixed —
// these feed it. Every new letter starts with the standard set; edit per client.
export const DEFAULT_TERM_SECTIONS = [
  { heading: 'Services & Selection', body: 'The services engaged are exactly those selected above at the prices shown. Options not selected are not included, and can be added later under a separate or amended letter of engagement.' },
  { heading: 'Timeline', body: 'Delivery timeframes are measured as noted per service. Timeframes anchored to receipt of requirements begin when all requested materials and information have been provided — not at signature.' },
  { heading: 'Payment', body: 'One-time fees are invoiced on engagement confirmation. Recurring fees are billed at the stated cadence and continue until cancelled. Invoices are payable on receipt unless the invoice states otherwise.' },
  { heading: 'Revisions & Scope', body: 'The engaged scope includes reasonable refinement within the described deliverables. Work beyond the described deliverables is quoted and approved in writing before any additional billing occurs.' },
  { heading: 'Materials & Content', body: 'Client-provided materials (copy, images, credentials, brand assets) remain the client\u2019s property. Timelines that depend on receiving materials pause while those materials are outstanding.' },
  { heading: 'Term & Termination', body: 'Either party may end this engagement with written notice. Completed work and fees incurred to date remain payable. Prepaid, unused recurring fees for future periods are refunded pro rata.' },
  { heading: 'Electronic Signature', body: 'Both parties agree this letter may be executed electronically. The typed-name signature captured on this page, together with its timestamp and audit record, constitutes a binding signature.' },
];

/** Atomically generate next engagement number: ENG-YYYY-0001 */
export async function generateEngagementNumber(db, tenant = null) {
  const year = new Date().getFullYear();
  const counter = await db.collection('engagement_counter').findOneAndUpdate(
    { _id: `engagement_${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return `ENG-${year}-${String(counter.seq).padStart(4, '0')}`;
}

/** 32-byte access token — longer than invoice tokens because a signature is at stake */
export function generateEngagementToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Human timeframe label: "14 days from receipt of requirements" */
export function timeframeLabel(tf) {
  if (!tf || !tf.value) return tf?.unit === 'ongoing' ? 'Ongoing' : '';
  const unit = tf.value === 1 ? String(tf.unit || '').replace(/s$/, '') : tf.unit;
  const anchor = {
    signature: 'from signature',
    requirements: 'from receipt of requirements',
    golive: 'from go-live',
  }[tf.startsFrom] || '';
  return `${tf.value} ${unit} ${anchor}`.trim();
}

/** Price label for a snapshotted item or service */
export function priceLabel(pricing) {
  if (!pricing) return '';
  const amt = `$${Number(pricing.amount || 0).toFixed(2)}`;
  switch (pricing.model) {
    case 'one-time': return amt;
    case 'monthly':  return `${amt} / month`;
    case 'annual':   return `${amt} / year`;
    case 'hourly':   return `${amt} / hour`;
    case 'quote':    return 'Quoted at scoping';
    default:         return amt;
  }
}

/** Materialize a service doc into a letter item (full editable copy) */
export function serviceToItem(s) {
  return {
    serviceId: s._id.toString(),
    name: s.name,
    blurb: s.blurb || '',
    deliverables: s.deliverables || [],
    pricing: { model: s.pricing?.model || 'one-time', amount: Number(s.pricing?.amount || 0) },
    timeframe: s.timeframe ? { ...s.timeframe } : null,
  };
}

/**
 * Materialize package TEMPLATES (which store serviceIds) into full editable
 * packages using CURRENT catalog data. This runs when a template is offered
 * to the editor — from that moment the letter owns its own copy, and per-letter
 * pricing/name edits touch only that copy.
 */
export async function materializeTemplates(db, templates) {
  const ids = [];
  for (const t of templates || []) {
    for (const opt of t.options || []) {
      for (const sid of opt.serviceIds || []) ids.push(sid);
    }
  }
  const services = ids.length
    ? await db.collection('services').find({ _id: { $in: ids.map(id => new ObjectId(id)) } }).toArray()
    : [];
  const byId = new Map(services.map(s => [s._id.toString(), s]));

  return (templates || []).map(t => ({
    _id: t._id.toString(),
    name: t.name,
    label: t.label || t.name,
    selectMode: t.selectMode || 'one',
    options: (t.options || []).map(opt => ({
      key: opt.key,
      name: opt.name,
      recommended: !!opt.recommended,
      recommendedNote: opt.recommendedNote || '',
      items: (opt.serviceIds || []).map(sid => {
        const s = byId.get(String(sid));
        return s ? serviceToItem(s) : null;
      }).filter(Boolean),
    })),
  }));
}

/** Compute an option's one-time total (recurring items display their own cadence) */
function optionTotal(items) {
  return (items || [])
    .filter(i => i.pricing?.model === 'one-time')
    .reduce((sum, i) => sum + Number(i.pricing.amount || 0), 0);
}

/**
 * FREEZE at send — draftPackages are already materialized (the letter owns its
 * copies, including any per-letter pricing edits). Freezing normalizes keys,
 * recomputes totals, strips empties. After this, nothing external has authority.
 */
export function freezeDraftPackages(draftPackages) {
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (draftPackages || [])
    .map(pkg => ({
      key: pkg.key || slug(pkg.label) || 'pkg',
      label: pkg.label || 'Services',
      selectMode: ['one', 'many', 'required'].includes(pkg.selectMode) ? pkg.selectMode : 'one',
      options: (pkg.options || [])
        .map(opt => {
          const items = (opt.items || []).map(i => ({
            serviceId: i.serviceId || null,
            name: String(i.name || '').slice(0, 300),
            blurb: String(i.blurb || '').slice(0, 500),
            deliverables: Array.isArray(i.deliverables) ? i.deliverables.map(d => String(d).slice(0, 300)) : [],
            pricing: {
              model: ['one-time', 'monthly', 'annual', 'hourly', 'quote'].includes(i.pricing?.model) ? i.pricing.model : 'one-time',
              amount: Number(i.pricing?.amount || 0),
            },
            timeframe: i.timeframe && i.timeframe.value ? {
              value: parseInt(i.timeframe.value) || 0,
              unit: i.timeframe.unit || 'days',
              startsFrom: i.timeframe.startsFrom || 'requirements',
              label: String(i.timeframe.label || '').slice(0, 120),
            } : null,
          })).filter(i => i.name);
          return {
            key: opt.key || slug(opt.name) || 'option',
            name: String(opt.name || '').slice(0, 300),
            recommended: !!opt.recommended,
            recommendedNote: String(opt.recommendedNote || '').slice(0, 500),
            items,
            total: optionTotal(items),
          };
        })
        .filter(opt => opt.name && opt.items.length),
    }))
    .filter(pkg => pkg.options.length);
}

/** Normalize term sections coming from the editor or the agent */
export function normalizeTermSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections
    .map(s => ({
      heading: String(s.heading || '').trim().slice(0, 200),
      body: String(s.body || '').trim().slice(0, 4000),
    }))
    .filter(s => s.heading && s.body)
    .slice(0, 30);
}

/**
 * Canonical document hash. What the client saw + what they selected.
 * Stored at sign time so "the document was frozen" is checkable, not a claim.
 */
export function hashDocument(engagement) {
  const canonical = JSON.stringify({
    title: engagement.title || '',
    intro: engagement.intro || '',
    termsSections: engagement.termsSections || [],
    packages: engagement.packages || [],
    selections: engagement.selections || {},
    validUntil: engagement.validUntil ? new Date(engagement.validUntil).toISOString() : null,
  });
  return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

/** Append an audit event (embedded array, mirrors invoices.payments) */
export async function logEvent(db, engagementId, event, req = null, meta = {}) {
  await db.collection('engagements').updateOne(
    { _id: new ObjectId(engagementId) },
    { $push: { auditLog: {
        event,
        at: new Date(),
        ip: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null,
        meta,
      } } }
  );
}

/** Flatten the client's selections into the frozen items they chose */
export function selectedItems(engagement) {
  const out = [];
  for (const pkg of engagement.packages || []) {
    const chosen = engagement.selections?.[pkg.key] || [];
    for (const opt of pkg.options || []) {
      if (chosen.includes(opt.key)) out.push(...(opt.items || []));
    }
  }
  return out;
}

/** Every required/one group must have a selection before signing */
export function validateSelections(engagement) {
  const missing = [];
  for (const pkg of engagement.packages || []) {
    const chosen = engagement.selections?.[pkg.key] || [];
    if ((pkg.selectMode === 'one' || pkg.selectMode === 'required') && chosen.length === 0) {
      missing.push(pkg.label || pkg.key);
    }
  }
  return missing;
}

/**
 * Signing → DRAFT invoice(s). Never auto-sent.
 * one-time → single draft invoice; monthly/annual → recurring draft;
 * hourly/quote → skipped (bill on use).
 */
export async function engagementToInvoice(db, engagement, tenant, generateInvoiceNumber) {
  const items = selectedItems(engagement);
  const oneTime = items.filter(i => i.pricing?.model === 'one-time');
  const recurring = items.filter(i => ['monthly', 'annual'].includes(i.pricing?.model));
  const created = [];

  if (oneTime.length) {
    const lineItems = oneTime.map(i => ({ description: i.name, quantity: 1, unitPrice: Number(i.pricing.amount || 0) }));
    const amount = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
    const invoiceNumber = await generateInvoiceNumber(db, tenant);
    const r = await db.collection('invoices').insertOne({
      clientId: engagement.clientId,
      invoiceNumber,
      title: `${engagement.title} — Engagement ${engagement.engagementNumber}`,
      lineItems, amount,
      status: 'draft',
      dueDate: null,
      notes: `Generated from signed engagement ${engagement.engagementNumber}.`,
      paymentToken: generatePaymentToken(),
      recurring: { enabled: false, frequency: null, nextGenerateDate: null, autoSend: false },
      payments: [], emailSentAt: null, emailSentTo: null,
      engagementId: engagement._id.toString(),
      createdAt: new Date(),
    });
    created.push(r.insertedId);
  }

  for (const item of recurring) {
    const frequency = item.pricing.model === 'annual' ? 'yearly' : 'monthly';
    const invoiceNumber = await generateInvoiceNumber(db, tenant);
    const r = await db.collection('invoices').insertOne({
      clientId: engagement.clientId,
      invoiceNumber,
      title: item.name,
      lineItems: [{ description: item.name, quantity: 1, unitPrice: Number(item.pricing.amount || 0) }],
      amount: Number(item.pricing.amount || 0),
      status: 'draft',
      dueDate: null,
      notes: `Recurring — from signed engagement ${engagement.engagementNumber}.`,
      paymentToken: generatePaymentToken(),
      recurring: { enabled: true, frequency, nextGenerateDate: getNextGenerateDate(frequency), autoSend: true },
      payments: [], emailSentAt: null, emailSentTo: null,
      engagementId: engagement._id.toString(),
      createdAt: new Date(),
    });
    created.push(r.insertedId);
  }

  return created;
}
