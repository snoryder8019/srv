import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getDb } from './mongo.js';
import { config } from '../config/config.js';
import cron from 'node-cron';

let lastPollTime = null;

/** Strip Re:/Fwd:/FW: prefixes to get the base subject for threading */
export function normalizeSubject(subject) {
  return (subject || '').replace(/^(re|fwd?|fw)\s*:\s*/gi, '').trim().toLowerCase();
}

async function getImapClient() {
  const client = new ImapFlow({
    host: 'imappro.zoho.com',
    port: 993,
    secure: true,
    auth: { user: config.ZOHO_USER, pass: config.ZOHO_PASS },
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

/** Poll for new emails and store client replies */
async function pollInbox() {
  if (!config.ZOHO_USER || !config.ZOHO_PASS) return;

  let client;
  try {
    client = await getImapClient();
    await client.mailboxOpen('INBOX');

    const since = lastPollTime || new Date(Date.now() - 10 * 60 * 1000);
    const messages = await client.search({ since, seen: false }, { uid: true });

    if (!messages.length) {
      lastPollTime = new Date();
      await client.logout();
      return;
    }

    const db = getDb();

    for (const uid of messages) {
      try {
        const raw = await client.download(uid.toString(), undefined, { uid: true });
        const parsed = await simpleParser(raw.content);

        const from = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
        if (from === config.ZOHO_USER?.toLowerCase()) continue;

        const subject = parsed.subject || '(no subject)';
        const messageId = parsed.messageId || '';

        const existing = await db.collection('client_emails').findOne({ messageId });
        if (existing) continue;

        const body = parsed.html || parsed.textAsHtml || parsed.text || '';
        const to = parsed.to?.value?.map(a => a.address).join(', ') || '';
        const cc = parsed.cc?.value?.map(a => a.address) || [];
        const inReplyTo = parsed.inReplyTo || null;

        const clientDoc = await db.collection('clients').findOne({ email: from });
        const clientId = clientDoc ? clientDoc._id.toString() : null;

        // Resolve thread
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

        // If thread found, update the thread's lastReplyAt
        if (threadId) {
          await db.collection('client_emails').updateOne(
            { _id: threadId },
            { $set: { lastReplyAt: new Date() } }
          );
        }

        console.log(`[IMAP] ${from}${clientDoc ? ' (' + clientDoc.name + ')' : ''} — ${subject}${threadId ? ' [threaded]' : ''}`);
      } catch (msgErr) {
        console.error('[IMAP] Error processing message:', msgErr.message);
      }
    }

    lastPollTime = new Date();
    await client.logout();
  } catch (err) {
    console.error('[IMAP] Poll error:', err.message);
    if (client) try { await client.logout(); } catch {}
  }
}

export function startImapPoller() {
  if (!config.ZOHO_USER || !config.ZOHO_PASS) {
    console.log('[IMAP] Zoho credentials not set, skipping poller');
    return;
  }

  setTimeout(() => pollInbox(), 10000);

  cron.schedule('*/2 * * * *', () => {
    pollInbox();
  });

  console.log('[IMAP] Email poller started (every 2 minutes)');
}
