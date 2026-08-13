// ─────────────────────────────────────────────────────────────────────────────
// campaignSchedule.js — put email campaigns on the calendar and send them when
// their time comes, the same way blog posts publish and social posts fire.
//
// Status model on the `campaigns` collection:
//   draft      → no date, nothing happens
//   scheduled  → scheduledAt in the future; this sender flips it to sent
//   sending    → claimed by a run, delivery in progress (stuck ones get reaped)
//   sent       → sentAt/sentCount stamped; terminal
//   failed     → the run couldn't deliver (no audience, SMTP down); sendError says why
//
// Sending email is irreversible, so this is deliberately stricter than the blog
// publisher: a schedule in the past is refused at the door rather than quietly
// firing, and every send is claimed atomically so two overlapping runs (or a
// run racing a manual "Send now") can never double-deliver to the list.
//
// An interval job, never node-cron — this host drops cron ticks (see cronSafe).
// ─────────────────────────────────────────────────────────────────────────────

import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from './mongo.js';
import { decrypt } from './crypto.js';
import { scheduleIntervalJob } from './cronSafe.js';
import { sendCampaignEmail } from './mailer.js';

// A campaign claimed for sending but never finished (process restart mid-send).
const STUCK_MS = 30 * 60 * 1000;

/**
 * Read schedule fields off a posted form and turn them into the status pair the
 * campaign document stores. Accepts either the split `scheduledDate` +
 * `scheduledTime` pair (composer) or a single `scheduledAt` datetime-local
 * value (the inline control on a campaign card).
 *
 * Blank → draft. That's what makes clearing the date on an existing scheduled
 * campaign pull it back off the calendar.
 */
export function resolveCampaignSchedule(body = {}) {
  const raw = String(body.scheduledAt || '').trim();
  const date = String(body.scheduledDate || '').trim();
  const time = String(body.scheduledTime || '').trim();

  let when = null;
  if (raw) when = new Date(raw);
  else if (date) when = new Date(`${date}T${time || '09:00'}`);

  if (!when) return { status: 'draft', scheduledAt: null };
  if (Number.isNaN(when.getTime())) {
    throw Object.assign(new Error('That send date could not be read'), { status: 400 });
  }
  // A minute of slack absorbs the round-trip between picking "in 30 seconds"
  // and the form landing; anything genuinely past is a typo, and a typo must
  // not turn into an immediate blast to the whole list.
  if (when.getTime() < Date.now() - 60 * 1000) {
    throw Object.assign(new Error('Schedule a send time in the future'), { status: 400 });
  }
  return { status: 'scheduled', scheduledAt: when };
}

/** Put a campaign on the calendar (or move it). Drafts only — sent is history. */
export async function scheduleCampaign(db, id, at) {
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) {
    throw Object.assign(new Error('That send date could not be read'), { status: 400 });
  }
  if (when.getTime() < Date.now() - 60 * 1000) {
    throw Object.assign(new Error('Schedule a send time in the future'), { status: 400 });
  }
  const r = await db.collection('campaigns').updateOne(
    { _id: new ObjectId(String(id)), status: { $in: ['draft', 'scheduled', 'failed'] } },
    { $set: { status: 'scheduled', scheduledAt: when, sendError: null, updatedAt: new Date() } },
  );
  if (!r.matchedCount) {
    throw Object.assign(new Error('Only unsent campaigns can be scheduled'), { status: 400 });
  }
  return when;
}

/** Pull a campaign back off the calendar. */
export async function unscheduleCampaign(db, id) {
  await db.collection('campaigns').updateOne(
    { _id: new ObjectId(String(id)), status: { $in: ['scheduled', 'failed'] } },
    { $set: { status: 'draft', scheduledAt: null, sendError: null, updatedAt: new Date() } },
  );
}

/**
 * Who this campaign goes to. Follow-ups carry explicit contact IDs (the segment
 * they were built from); everything else resolves funnel + tag targeting live,
 * so a list that grew since scheduling is included.
 */
export async function resolveCampaignContacts(db, campaign) {
  if (campaign.targetContactIds?.length) {
    return db.collection('contacts').find({
      _id: { $in: campaign.targetContactIds.map(id => (id instanceof ObjectId ? id : new ObjectId(id))) },
      status: 'subscribed',
    }).toArray();
  }
  const filter = { status: 'subscribed' };
  if (campaign.targetFunnel && campaign.targetFunnel !== 'all') filter.funnel = campaign.targetFunnel;
  if (campaign.targetTags?.length) filter.tags = { $in: campaign.targetTags };
  return db.collection('contacts').find(filter).toArray();
}

/**
 * Deliver a campaign to its audience and write the outcome back.
 *
 * Shared by the manual "Send now" button and the scheduler so both paths behave
 * identically. Claims the campaign atomically first — the claim is what makes a
 * scheduled send and an impatient admin clicking Send safe to race.
 *
 * Returns { ok, sent, failed, error }. `ok:false` with sent:0 means nothing went
 * out; the campaign is left in `failed` with the reason on it.
 */
export async function deliverCampaign(db, campaign, tenant) {
  const campaigns = db.collection('campaigns');
  const claim = await campaigns.updateOne(
    { _id: campaign._id, status: { $in: ['draft', 'scheduled', 'failed'] } },
    { $set: { status: 'sending', updatedAt: new Date() } },
  );
  if (claim.modifiedCount !== 1) {
    return { ok: false, sent: 0, failed: 0, error: 'Campaign is already sending or sent', claimed: false };
  }

  let contacts;
  try {
    contacts = await resolveCampaignContacts(db, campaign);
  } catch (err) {
    await campaigns.updateOne({ _id: campaign._id },
      { $set: { status: 'failed', sendError: err.message, updatedAt: new Date() } });
    return { ok: false, sent: 0, failed: 0, error: err.message, claimed: true };
  }

  if (!contacts.length) {
    await campaigns.updateOne({ _id: campaign._id }, {
      $set: { status: 'failed', sendError: 'No matching contacts', updatedAt: new Date() },
    });
    return { ok: false, sent: 0, failed: 0, error: 'No matching contacts', claimed: true };
  }

  let sent = 0, failed = 0, fatal = null;
  for (const contact of contacts) {
    try {
      await sendCampaignEmail(
        contact.email, contact.name, campaign.subject, campaign.preheader, campaign.body,
        campaign._id, contact._id, tenant,
      );
      sent++;
    } catch (err) {
      failed++;
      console.error(`[Campaign] Failed to send to ${contact.email}:`, err.message);
      // A configuration failure (no mailbox, bad credentials) fails identically
      // for every contact — stop rather than grinding through the whole list.
      if (!sent && /not configured|not connected|Invalid login|EAUTH/i.test(err.message)) {
        fatal = err.message;
        break;
      }
    }
  }

  const now = new Date();
  if (!sent) {
    const error = fatal || 'Every delivery failed';
    await campaigns.updateOne({ _id: campaign._id }, {
      $set: { status: 'failed', failedCount: failed, sendError: error, updatedAt: now },
    });
    return { ok: false, sent: 0, failed, error, claimed: true };
  }

  await campaigns.updateOne({ _id: campaign._id }, {
    $set: { status: 'sent', sentCount: sent, failedCount: failed, sentAt: now, sendError: null, updatedAt: now },
  });
  return { ok: true, sent, failed, error: null, claimed: true };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

/** Decrypt a tenant's secrets blob (mirrors middleware/tenant.js). */
function decryptSecrets(secrets) {
  if (!secrets) return {};
  const out = {};
  for (const [k, v] of Object.entries(secrets)) {
    try { out[k] = decrypt(v); } catch { out[k] = null; }
  }
  return out;
}

/**
 * Every sendable tenant, hydrated into the shape the mailer expects — decrypted
 * secrets for SMTP, and the public domain (custom domain wins) so tracking
 * pixels and click-through links point at the same host the recipient knows.
 */
async function loadSendingTenants() {
  const slab = getSlabDb();
  const docs = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] } })
    .project({ db: 1, dbHost: 1, domain: 1, brand: 1, public: 1, secrets: 1, meta: 1 })
    .toArray();
  return docs
    .filter(d => d.db)
    .map(d => ({
      _id: d._id,
      db: d.db,
      dbHost: d.dbHost || 'atlas',
      domain: d.meta?.customDomain || d.public?.customDomain || d.domain,
      brand: d.brand || {},
      public: d.public || {},
      secrets: decryptSecrets(d.secrets),
    }));
}

/**
 * Send every campaign that has come due, across every tenant. Idempotent and
 * catch-up safe: it takes everything with scheduledAt <= now, so a run that was
 * late (or a host that was asleep) simply delivers on the next tick.
 */
export async function runDueCampaigns() {
  const now = new Date();
  let total = 0;

  let tenants;
  try { tenants = await loadSendingTenants(); }
  catch (err) { console.error('[CampaignCron] tenant load failed:', err.message); return 0; }

  for (const tenant of tenants) {
    let db;
    try { db = getTenantDb(tenant.db, tenant.dbHost); } catch { continue; }

    // Reap sends interrupted by a restart so they stop looking in-flight forever.
    try {
      await db.collection('campaigns').updateMany(
        { status: 'sending', updatedAt: { $lt: new Date(now.getTime() - STUCK_MS) } },
        { $set: { status: 'failed', sendError: 'Send interrupted — check the list and resend', updatedAt: now } },
      );
    } catch { /* nothing due here matters more than continuing */ }

    let due;
    try {
      due = await db.collection('campaigns')
        .find({ status: 'scheduled', scheduledAt: { $lte: now } })
        .sort({ scheduledAt: 1 }).toArray();
    } catch { continue; }
    if (!due.length) continue;

    for (const campaign of due) {
      try {
        const out = await deliverCampaign(db, campaign, tenant);
        if (!out.claimed) continue;                  // another run got it
        if (out.ok) {
          total++;
          console.log(`[CampaignCron] ${tenant.db}: sent "${campaign.subject}" to ${out.sent} contacts (${out.failed} failed)`);
        } else {
          console.warn(`[CampaignCron] ${tenant.db}: "${campaign.subject}" failed — ${out.error}`);
        }
      } catch (err) {
        console.error(`[CampaignCron] ${tenant.db}: campaign ${campaign._id} threw:`, err.message);
        try {
          await db.collection('campaigns').updateOne({ _id: campaign._id, status: 'sending' },
            { $set: { status: 'failed', sendError: err.message, updatedAt: new Date() } });
        } catch { /* ignore */ }
      }
    }
  }
  return total;
}

export function startCampaignScheduler() {
  scheduleIntervalJob('campaign-send', 60 * 1000, runDueCampaigns, { label: 'Scheduled campaign sender' });
}
