// Newsletter + subscriber storage backed by Mongo.
// Issues are threadable: a root issue has parentId=null; replies (admin
// follow-ups or community discussion threads) point at the root's _id.
// Subscribers are keyed by lowercased email. Tokens are random hex used
// for unsubscribe links so we don't need to authenticate the GET.
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const mailer = require('./mailer');

let db;
let _issues, _subs;

async function init(database) {
  db = database;
  _issues = db.collection('newsletter_issues');
  _subs = db.collection('newsletter_subscribers');
  await _issues.createIndex({ publishedAt: -1 });
  await _issues.createIndex({ parentId: 1, publishedAt: 1 });
  await _subs.createIndex({ email: 1 }, { unique: true });
  await _subs.createIndex({ token: 1 });
}

function _token() { return crypto.randomBytes(16).toString('hex'); }

// Fire-and-forget welcome email. Caller doesn't await Zoho — a slow SMTP
// hop must never block the subscribe response. Failures are logged so the
// admin can chase them, but the subscriber row is already saved.
function _sendWelcomeAsync(email, token) {
  setImmediate(() => {
    mailer.sendWelcome({ to: email, token })
      .then(() => console.log('[newsletter] welcome sent to', email))
      .catch(err => console.error('[newsletter] welcome FAILED for', email, '—', err.message));
  });
}

async function subscribe({ email, source = 'landing', userId = null }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('invalid email');
  const lc = String(email).toLowerCase().trim();
  const now = new Date();
  // Re-subscribe path: if they previously unsubscribed, clear the flag.
  const existing = await _subs.findOne({ email: lc });
  if (existing) {
    if (existing.unsubscribedAt) {
      await _subs.updateOne({ _id: existing._id }, { $set: { unsubscribedAt: null, resubscribedAt: now } });
      _sendWelcomeAsync(lc, existing.token);
      return { ok: true, status: 'resubscribed', token: existing.token };
    }
    return { ok: true, status: 'already_subscribed', token: existing.token };
  }
  const doc = {
    email: lc,
    userId: userId ? String(userId) : null,
    source: String(source).slice(0, 40),
    token: _token(),
    subscribedAt: now,
    unsubscribedAt: null,
  };
  await _subs.insertOne(doc);
  _sendWelcomeAsync(lc, doc.token);
  return { ok: true, status: 'subscribed', token: doc.token };
}

async function unsubscribe(token) {
  if (!token) throw new Error('token required');
  const doc = await _subs.findOne({ token: String(token) });
  if (!doc) return { ok: false, status: 'not_found' };
  if (doc.unsubscribedAt) return { ok: true, status: 'already_unsubscribed' };
  await _subs.updateOne({ _id: doc._id }, { $set: { unsubscribedAt: new Date() } });
  return { ok: true, status: 'unsubscribed' };
}

async function subscriberCount() {
  return _subs.countDocuments({ unsubscribedAt: null });
}

async function listSubscribers({ limit = 200 } = {}) {
  return _subs.find({ unsubscribedAt: null }).sort({ subscribedAt: -1 }).limit(limit).toArray();
}

async function createDraft({ subject, body, kind = 'news', tone = 'info', thumbnailUrl = null, author = '', parentId = null }) {
  if (!subject || !String(subject).trim()) throw new Error('subject required');
  if (!body || !String(body).trim()) throw new Error('body required');
  const doc = {
    subject: String(subject).slice(0, 200),
    body: String(body).slice(0, 8000),
    kind: String(kind || 'news').slice(0, 20),
    tone: String(tone || 'info').slice(0, 20),
    thumbnailUrl: thumbnailUrl ? String(thumbnailUrl).slice(0, 400) : null,
    author: String(author || '').slice(0, 120),
    parentId: parentId ? new ObjectId(String(parentId)) : null,
    status: 'draft',
    createdAt: new Date(),
    publishedAt: null,
  };
  const r = await _issues.insertOne(doc);
  return Object.assign({ _id: r.insertedId }, doc);
}

async function publish(id) {
  const _id = new ObjectId(String(id));
  await _issues.updateOne({ _id }, { $set: { status: 'published', publishedAt: new Date() } });
  const issue = await _issues.findOne({ _id });
  // Reply posts in a thread don't blast — only the root issue. Replies are
  // discussion follow-ups and should stay on the web view, not in inboxes.
  if (issue && !issue.parentId) {
    _sendIssueToAllAsync(issue);
  }
  return issue;
}

// Best-effort fan-out. Sequential with a small per-mail delay to keep Zoho
// happy (free tier is ~250/day, paid is higher but still rate-limited per
// minute). Records the sent count + failures on the issue doc for the admin
// UI. Non-blocking — caller doesn't wait.
function _sendIssueToAllAsync(issue) {
  setImmediate(async () => {
    try {
      const subs = await _subs.find({ unsubscribedAt: null }).toArray();
      if (!subs.length) {
        console.log('[newsletter] publish', issue._id.toString(), '— no subscribers');
        return;
      }
      console.log('[newsletter] publishing', issue._id.toString(), 'to', subs.length, 'subscribers');
      let sent = 0, failed = 0;
      for (const s of subs) {
        try {
          await mailer.sendIssue({
            to: s.email,
            token: s.token,
            subject: issue.subject,
            bodyText: issue.body,
            kind: issue.kind,
            thumbnailUrl: issue.thumbnailUrl,
          });
          sent++;
          // 250ms pacing keeps us well under any sane SMTP rate ceiling.
          await new Promise(r => setTimeout(r, 250));
        } catch (e) {
          failed++;
          console.error('[newsletter] send failed for', s.email, '—', e.message);
        }
      }
      await _issues.updateOne(
        { _id: issue._id },
        { $set: { mailSentAt: new Date(), mailSentCount: sent, mailFailedCount: failed } }
      );
      console.log('[newsletter] publish', issue._id.toString(), 'complete:', sent, 'sent /', failed, 'failed');
    } catch (e) {
      console.error('[newsletter] fan-out crashed:', e.message);
    }
  });
}

async function updateDraft(id, patch) {
  const _id = new ObjectId(String(id));
  const set = {};
  if (patch.subject !== undefined) set.subject = String(patch.subject).slice(0, 200);
  if (patch.body !== undefined) set.body = String(patch.body).slice(0, 8000);
  if (patch.kind !== undefined) set.kind = String(patch.kind).slice(0, 20);
  if (patch.tone !== undefined) set.tone = String(patch.tone).slice(0, 20);
  if (patch.thumbnailUrl !== undefined) set.thumbnailUrl = patch.thumbnailUrl ? String(patch.thumbnailUrl).slice(0, 400) : null;
  if (!Object.keys(set).length) return _issues.findOne({ _id });
  await _issues.updateOne({ _id }, { $set: set });
  return _issues.findOne({ _id });
}

async function remove(id) {
  const _id = new ObjectId(String(id));
  // Also nuke replies pointed at this root so we don't orphan a thread.
  await _issues.deleteMany({ parentId: _id });
  await _issues.deleteOne({ _id });
  return { ok: true };
}

async function listThreads({ limit = 30, includeDrafts = false } = {}) {
  const q = includeDrafts ? { parentId: null } : { parentId: null, status: 'published' };
  const roots = await _issues.find(q).sort({ publishedAt: -1, createdAt: -1 }).limit(limit).toArray();
  if (!roots.length) return [];
  const rootIds = roots.map(r => r._id);
  const replies = await _issues.find({ parentId: { $in: rootIds }, status: 'published' })
    .sort({ publishedAt: 1, createdAt: 1 }).toArray();
  const byRoot = {};
  for (const r of replies) {
    const k = String(r.parentId);
    (byRoot[k] = byRoot[k] || []).push(r);
  }
  return roots.map(r => Object.assign({}, r, { replies: byRoot[String(r._id)] || [] }));
}

async function getThread(id) {
  const _id = new ObjectId(String(id));
  const root = await _issues.findOne({ _id });
  if (!root) return null;
  const replies = await _issues.find({ parentId: _id, status: 'published' })
    .sort({ publishedAt: 1, createdAt: 1 }).toArray();
  return Object.assign({}, root, { replies });
}

// Manual resend used by the admin UI when a welcome bounced or got eaten by
// spam. Looks up the active subscriber by email and re-sends.
async function resendWelcome(email) {
  const lc = String(email || '').toLowerCase().trim();
  const sub = await _subs.findOne({ email: lc, unsubscribedAt: null });
  if (!sub) return { ok: false, error: 'No active subscription for ' + lc };
  await mailer.sendWelcome({ to: sub.email, token: sub.token });
  return { ok: true, sent: sub.email };
}

module.exports = {
  init, subscribe, unsubscribe, subscriberCount, listSubscribers,
  createDraft, publish, updateDraft, remove, listThreads, getThread,
  resendWelcome,
};
