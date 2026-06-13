import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { pushEmailToPitch } from './socket.js';

// Which pitch the inbound mail feeds, and which sender domain to watch.
// Configurable via env so the listener isn't tied to any one client; defaults
// to the seeded Meridian example (no real inbox is watched without these set).
const SLUG = process.env.PITCH_MAIL_SLUG || 'meridian';
const TARGET_DOMAIN = process.env.PITCH_MAIL_DOMAIN || '@meridian.example';

const TASK_KEYWORDS = [
  { rx: /\b(loi|engagement letter)\b/i, taskId: 't-loi-1' },
  { rx: /\b(kickoff|kick[- ]?off)\b/i, taskId: 't-kick-1' },
  { rx: /\b(data ?room|data ?room|invite)\b/i, taskId: 't-dr-1' },
  { rx: /\b(q ?of ?r|quality of revenue|cohort)\b/i, taskId: 't-qor-1' },
  { rx: /\b(nwc|net working capital|peg)\b/i, taskId: 't-nwc-1' },
  { rx: /\b(verification|cell[- ]?sign[- ]?off|tie[- ]?out)\b/i, taskId: 't-ver-1' },
  { rx: /\b(ic memo|close|deliver)/i, taskId: 't-del-1' },
];

function tagForBody(text) {
  if (!text) return null;
  for (const k of TASK_KEYWORDS) {
    if (k.rx.test(text)) return k.taskId;
  }
  return null;
}

function fromEmailAddress(parsed) {
  const a = parsed?.from?.value?.[0];
  return a?.address || '';
}

async function pollOnce(io, client) {
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24);
    const uids = await client.search({ since });
    if (!uids?.length) return 0;

    let pushed = 0;
    for await (const msg of client.fetch(uids, { source: true, envelope: true, internalDate: true })) {
      const parsed = await simpleParser(msg.source);
      const fromAddr = fromEmailAddress(parsed).toLowerCase();
      if (!fromAddr.endsWith(TARGET_DOMAIN)) continue;

      const subject = parsed.subject || '(no subject)';
      const body = (parsed.text || parsed.html || '').slice(0, 1200);
      const taskId = tagForBody(`${subject}\n${body}`);
      const email = {
        id: parsed.messageId || `${msg.uid}-${Date.now()}`,
        from: fromAddr,
        to: (parsed.to?.value || []).map((a) => a.address).join(', '),
        subject,
        snippet: (parsed.text || '').replace(/\s+/g, ' ').slice(0, 280),
        receivedAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
        taskId,
        tag: taskId ? 'matched' : 'unmatched',
        source: 'zoho-imap',
      };
      pushEmailToPitch(io, SLUG, email);
      pushed++;
    }
    return pushed;
  } finally {
    lock.release();
  }
}

export async function startPitchMailListener(io) {
  const user = process.env.ZOHO_USER;
  const pass = process.env.ZOHO_PASS;
  if (!user || !pass) {
    console.warn('[pitch-mail] ZOHO_USER / ZOHO_PASS not set — listener idle');
    return;
  }

  const client = new ImapFlow({
    host: process.env.ZOHO_IMAP_HOST || 'imap.zoho.com',
    port: parseInt(process.env.ZOHO_IMAP_PORT || '993', 10),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    console.warn('[pitch-mail] could not connect to Zoho IMAP:', err.message);
    return;
  }

  console.log('[pitch-mail] Zoho IMAP connected, watching for', TARGET_DOMAIN);
  try {
    await pollOnce(io, client);
  } catch (err) {
    console.warn('[pitch-mail] initial poll failed:', err.message);
  }

  const interval = setInterval(() => {
    pollOnce(io, client).catch((e) => console.warn('[pitch-mail] poll error:', e.message));
  }, 60_000);

  client.on('close', () => {
    clearInterval(interval);
    console.warn('[pitch-mail] IMAP connection closed');
  });
}
