import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getSlabDb, getTenantDb } from './mongo.js';
import { decrypt } from './crypto.js';
import { resolveSmtp } from './mailer.js';
import { getEmailAccessToken } from './emailOAuth.js';
import { scheduleIntervalJob } from './cronSafe.js';

/* ──────────────────────────────────────────────────────────────────
 * MULTI-TENANT INBOUND POLLER
 *
 * Each tenant has its own mailbox (resolved from its stored email provider +
 * credentials, the same config `resolveSmtp()` uses for sending). On every tick
 * we poll each configured tenant's INBOX and file new replies into THAT tenant's
 * `client_emails` collection — matched to a client and threaded where possible.
 *
 * Tenants with no email configured (no user/pass, or an unfinished OAuth setup)
 * are skipped without ever opening a connection. Errors are isolated per tenant
 * so one bad mailbox never stops the others.
 * ────────────────────────────────────────────────────────────────── */

// IMAP host per provider. Sending hosts live in mailer's SMTP_PRESETS; these are
// their IMAP counterparts (all implicit-TLS on 993).
const IMAP_PRESETS = {
  zoho:    { host: 'imappro.zoho.com',      port: 993, secure: true },
  gmail:   { host: 'imap.gmail.com',        port: 993, secure: true },
  outlook: { host: 'outlook.office365.com', port: 993, secure: true },
};

// Per-tenant high-water mark, keyed by tenant db name.
const lastPollByTenant = new Map();

// Per-tenant failure backoff, keyed by tenant db name → { until, reason }.
// A mailbox that rejects us (bad password, IMAP-not-enabled, expired OAuth) is
// parked for BACKOFF_MS so we log it once instead of hammering the provider's
// auth endpoint every tick — repeated auth failures can get an account locked.
const failBackoff = new Map();
const BACKOFF_MS = 30 * 60 * 1000;

/** Strip Re:/Fwd:/FW: prefixes to get the base subject for threading */
export function normalizeSubject(subject) {
  return (subject || '').replace(/^(re|fwd?|fw)\s*:\s*/gi, '').trim().toLowerCase();
}

/** Decrypt all values in a secrets object (mirrors middleware/tenant.js). */
function decryptSecrets(secrets) {
  if (!secrets) return {};
  const out = {};
  for (const [k, v] of Object.entries(secrets)) {
    try { out[k] = decrypt(v); } catch { out[k] = null; }
  }
  return out;
}

/** Load every active tenant with its decrypted secrets, ready for resolveSmtp(). */
async function loadEmailTenants() {
  const slab = getSlabDb();
  const docs = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] } })
    .project({ db: 1, brand: 1, public: 1, secrets: 1 })
    .toArray();
  return docs.map(doc => ({
    _id: doc._id,
    db: doc.db,
    brand: doc.brand || {},
    public: doc.public || {},
    secrets: decryptSecrets(doc.secrets),
  }));
}

/** Resolve a tenant's IMAP connection config, reusing the SMTP credential logic. */
function resolveImap(tenant) {
  const cfg = resolveSmtp(tenant); // { provider, authMode, user, pass, oauth, ... }
  let host, port = 993, secure = true;
  if (cfg.provider === 'custom') {
    host = tenant?.public?.imapHost || '';
    port = Number(tenant?.public?.imapPort) || 993;
    secure = tenant?.public?.imapSecure !== false;
  } else {
    const preset = IMAP_PRESETS[cfg.provider] || IMAP_PRESETS.zoho;
    ({ host, port, secure } = preset);
  }
  return { ...cfg, imapHost: host, imapPort: port, imapSecure: secure };
}

/** True when we have enough to authenticate this tenant's mailbox. */
function imapReady(imap) {
  if (!imap.imapHost || !imap.user) return false;
  return imap.authMode === 'oauth' ? true : !!imap.pass;
}

async function getImapClient(imap) {
  // OAuth (gmail full-mail scope works for IMAP; outlook needs IMAP.AccessAsUser
  // scope and will surface a scope error here if only SMTP.Send was granted).
  const auth = imap.authMode === 'oauth'
    ? { user: imap.user, accessToken: await getEmailAccessToken(imap.oauth) }
    : { user: imap.user, pass: imap.pass };
  const client = new ImapFlow({
    host: imap.imapHost,
    port: imap.imapPort,
    secure: imap.imapSecure,
    auth,
    logger: false,
  });
  await client.connect();
  return client;
}

/** Find or create a threadId for an email based on subject + client */
async function resolveThread(db, clientId, subject, inReplyTo) {
  const baseSubject = normalizeSubject(subject);
  if (!clientId || !baseSubject) return null;

  // Try to match by In-Reply-To messageId first
  if (inReplyTo) {
    const parent = await db.collection('client_emails').findOne({ messageId: inReplyTo, clientId });
    if (parent?.threadId) return parent.threadId;
  }

  // Fall back to matching by normalized subject + client
  const match = await db.collection('client_emails').findOne(
    { clientId, baseSubject, threadId: { $exists: true, $ne: null } },
    { sort: { sentAt: -1 } }
  );
  if (match?.threadId) return match.threadId;

  return null;
}

/** Poll a single tenant's INBOX and file new replies into its database. */
async function pollTenantInbox(tenant) {
  const key = tenant.db;
  const imap = resolveImap(tenant);
  if (!imapReady(imap)) return; // not configured — skip silently, no connection

  // Honor an active backoff from a recent auth/config failure.
  const parked = failBackoff.get(key);
  if (parked && parked.until > Date.now()) return;

  let client;
  try {
    client = await getImapClient(imap);
    await client.mailboxOpen('INBOX');
    failBackoff.delete(key); // connection + auth succeeded — clear any backoff

    const since = lastPollByTenant.get(key) || new Date(Date.now() - 10 * 60 * 1000);
    const messages = await client.search({ since, seen: false }, { uid: true });

    if (!messages.length) {
      lastPollByTenant.set(key, new Date());
      await client.logout();
      return;
    }

    const db = getTenantDb(tenant.db);
    const selfAddr = imap.user?.toLowerCase();
    let stored = 0;

    for (const uid of messages) {
      try {
        const raw = await client.download(uid.toString(), undefined, { uid: true });
        const parsed = await simpleParser(raw.content);

        const from = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
        if (!from || from === selfAddr) continue; // ignore our own sent copies

        const messageId = parsed.messageId || '';
        if (messageId) {
          const existing = await db.collection('client_emails').findOne({ messageId });
          if (existing) continue;
        }

        const subject = parsed.subject || '(no subject)';
        const body = parsed.html || parsed.textAsHtml || parsed.text || '';
        const to = parsed.to?.value?.map(a => a.address).join(', ') || '';
        const cc = parsed.cc?.value?.map(a => a.address) || [];
        const inReplyTo = parsed.inReplyTo || null;

        const clientDoc = await db.collection('clients').findOne({ email: from });
        const clientId = clientDoc ? clientDoc._id.toString() : null;

        const threadId = await resolveThread(db, clientId, subject, inReplyTo);

        await db.collection('client_emails').insertOne({
          clientId,
          direction: 'inbound',
          from,
          to,
          cc,
          subject,
          baseSubject: normalizeSubject(subject),
          body,
          messageId,
          inReplyTo,
          threadId,
          source: 'direct',
          receivedAt: parsed.date || new Date(),
          sentAt: parsed.date || new Date(),
        });

        if (threadId) {
          await db.collection('client_emails').updateOne(
            { _id: threadId },
            { $set: { lastReplyAt: new Date() } }
          );
        }
        stored++;
        console.log(`[IMAP] ${tenant.db}: ${from}${clientDoc ? ' (' + clientDoc.name + ')' : ''} — ${subject}${threadId ? ' [threaded]' : ''}`);
      } catch (msgErr) {
        console.error(`[IMAP] ${tenant.db}: error processing message:`, msgErr.message);
      }
    }

    lastPollByTenant.set(key, new Date());
    await client.logout();
    if (stored) console.log(`[IMAP] ${tenant.db}: stored ${stored} inbound message(s)`);
  } catch (err) {
    // Surface the provider's own explanation (e.g. "enable IMAP", bad password)
    // and park the tenant so we don't retry — or get rate-limited — every tick.
    const detail = err.responseText || err.serverResponseCode || err.message;
    const alreadyParked = failBackoff.get(key)?.until > Date.now();
    failBackoff.set(key, { until: Date.now() + BACKOFF_MS, reason: detail });
    if (!alreadyParked) {
      console.warn(`[IMAP] ${tenant.db}: mailbox unavailable — ${detail}. Pausing this tenant for ${BACKOFF_MS / 60000} min.`);
    }
    if (client) try { await client.logout(); } catch { /* already gone */ }
  }
}

/** Poll every configured tenant in sequence (gentle on the host + co-tenants). */
async function pollAllTenants() {
  let tenants;
  try {
    tenants = await loadEmailTenants();
  } catch (err) {
    console.error('[IMAP] tenant load failed:', err.message);
    return;
  }
  for (const t of tenants) {
    await pollTenantInbox(t).catch(err => console.error(`[IMAP] ${t.db}:`, err.message));
  }
}

export function startImapPoller() {
  // Every 2 min, WSL-jitter-tolerant (node-cron skips ticks on this host). The
  // reentrancy guard also prevents a slow poll from overlapping the next tick.
  scheduleIntervalJob('imap-poller', 2 * 60 * 1000, pollAllTenants, { label: 'Multi-tenant email poller', bootDelayMs: 10000 });
}
