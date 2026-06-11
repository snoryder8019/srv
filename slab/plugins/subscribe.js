// Shared lead-capture pipeline — the single entry point for adding an email to a
// tenant's marketing list from any public surface (footer signup bar, hosted form
// page, embed widget, API). Keeps validation, spam-blocklist, dedupe, double
// opt-in, and the welcome autoresponder in one place so every form behaves the same.
//
// Used by:
//   • routes/index.js     POST /api/newsletter   (footer signup bar)
//   • routes/tracking.js  POST /t/subscribe      (hosted form + embed widget)
//   • routes/tracking.js  GET  /t/confirm/:token (double opt-in confirmation)

import { normalizeEmail } from './emailNormalize.js';
import { sendConfirmEmail, sendFormWelcomeEmail } from './mailer.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** URL-safe token encode/decode (kept local to avoid a circular import with tracking.js). */
export function encodeToken(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
export function decodeToken(str) {
  return JSON.parse(Buffer.from(String(str), 'base64url').toString());
}

function tenantDomain(tenant) {
  return tenant?.domain ? `https://${tenant.domain}` : '';
}

/**
 * Capture a lead into the tenant `contacts` collection.
 *
 * @returns {Promise<{ status: 'pending'|'subscribed'|'exists'|'ignored'|'invalid', message: string }>}
 *   - pending    → double opt-in confirm email sent, awaiting click
 *   - subscribed → live on the list (single opt-in, or double-opt-in degraded
 *                  because the tenant has no mailbox configured to send a confirm)
 *   - exists     → already subscribed
 *   - ignored    → on the spam blocklist (reported as success to the visitor)
 *   - invalid    → malformed email
 */
export async function captureLead({
  db, tenant, email, name = '', funnel = 'lead', tags = [], source = 'website',
  formId = null, optIn = 'double', welcome = null,
}) {
  const clean = (email || '').toLowerCase().trim();
  if (!clean || !EMAIL_RE.test(clean)) return { status: 'invalid', message: 'Please enter a valid email address.' };

  const norm = normalizeEmail(clean);

  // Silent blocklist drop — report success so a flagged sender gets no signal.
  const blocked = await db.collection('spam_emails').findOne({ $or: [{ email: clean }, { emailNormalized: norm }] });
  if (blocked) return { status: 'ignored', message: 'Thanks — you are all set.' };

  const baseTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
  const now = new Date();
  const existing = await db.collection('contacts').findOne({ email: clean });

  if (existing && existing.status === 'subscribed') {
    // Already on the list — just enrich tags/source, never re-spam.
    await db.collection('contacts').updateOne(
      { _id: existing._id },
      { $set: { updatedAt: now }, $addToSet: baseTags.length ? { tags: { $each: baseTags } } : { tags: { $each: [] } } }
    );
    return { status: 'exists', message: "You're already subscribed — thanks!" };
  }

  const wantsDouble = optIn !== 'single';
  let confirmToken = null;
  let status = 'subscribed';

  if (wantsDouble) {
    confirmToken = encodeToken({ e: clean, f: formId ? String(formId) : null, t: now.getTime() });
    status = 'pending';
  }

  const set = {
    email: clean, emailNormalized: norm, name: name || existing?.name || '',
    funnel: funnel || 'lead', source: source || 'website',
    status, optIn: wantsDouble ? 'double' : 'single', updatedAt: now,
  };
  if (formId) set.formId = String(formId);
  if (confirmToken) { set.confirmToken = confirmToken; set.confirmSentAt = now; }

  await db.collection('contacts').updateOne(
    { email: clean },
    {
      $set: set,
      $setOnInsert: { createdAt: now },
      ...(baseTags.length ? { $addToSet: { tags: { $each: baseTags } } } : {}),
    },
    { upsert: true }
  );

  // Try to send the confirmation email. If the tenant has no mailbox wired up,
  // degrade gracefully to single opt-in rather than losing the lead.
  if (wantsDouble) {
    try {
      const confirmUrl = `${tenantDomain(tenant)}/t/confirm/${confirmToken}`;
      await sendConfirmEmail({ to: clean, confirmUrl, tenant });
      await bumpFormStat(db, formId, 'signupCount');
      return { status: 'pending', message: 'Almost there — check your inbox to confirm your subscription.' };
    } catch (err) {
      console.warn('[subscribe] confirm send failed, degrading to single opt-in:', err.message);
      await db.collection('contacts').updateOne(
        { email: clean },
        { $set: { status: 'subscribed', optIn: 'single', optInDegraded: true, updatedAt: new Date() } }
      );
      status = 'subscribed';
    }
  }

  // Single opt-in (or degraded): live immediately. Fire welcome best-effort.
  await bumpFormStat(db, formId, 'signupCount');
  await bumpFormStat(db, formId, 'confirmedCount');
  if (welcome?.body) {
    fireWelcome({ db, tenant, email: clean, name, welcome }).catch(() => {});
  }
  return { status: 'subscribed', message: welcome?.successMessage || "You're subscribed — thank you!" };
}

/** Confirm a pending double-opt-in contact from a tokenized link. */
export async function confirmLead({ db, tenant, token }) {
  let data;
  try { data = decodeToken(token); } catch { return { ok: false, message: 'This confirmation link is invalid.' }; }
  const email = (data.e || '').toLowerCase().trim();
  if (!email) return { ok: false, message: 'This confirmation link is invalid.' };

  const contact = await db.collection('contacts').findOne({ email });
  if (!contact) return { ok: false, message: 'We could not find that subscription.' };
  if (contact.status === 'subscribed') return { ok: true, message: "You're confirmed — thanks!", already: true };

  await db.collection('contacts').updateOne(
    { _id: contact._id },
    { $set: { status: 'subscribed', confirmedAt: new Date(), updatedAt: new Date() }, $unset: { confirmToken: '' } }
  );
  await bumpFormStat(db, data.f, 'confirmedCount');

  // Welcome autoresponder, if the originating form defined one.
  if (data.f) {
    try {
      const form = await db.collection('signup_forms').findOne({ _id: await toObjectId(data.f) });
      if (form?.welcomeBody) {
        fireWelcome({
          db, tenant, email, name: contact.name,
          welcome: { subject: form.welcomeSubject, body: form.welcomeBody },
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }
  }

  return { ok: true, message: "You're confirmed! Thanks for subscribing." };
}

async function fireWelcome({ db, tenant, email, name, welcome }) {
  if (!welcome?.body) return;
  await sendFormWelcomeEmail({
    to: email, name, subject: welcome.subject || 'Welcome', body: welcome.body, tenant,
  });
}

async function bumpFormStat(db, formId, field) {
  if (!formId) return;
  try {
    await db.collection('signup_forms').updateOne(
      { _id: await toObjectId(formId) },
      { $inc: { [field]: 1 }, $set: { lastSignupAt: new Date() } }
    );
  } catch { /* form may be a synthetic default with no row */ }
}

async function toObjectId(id) {
  if (!id) return null;
  const { ObjectId } = await import('mongodb');
  return id instanceof ObjectId ? id : new ObjectId(String(id));
}
