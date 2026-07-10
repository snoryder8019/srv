// Global (cross-tenant) spam filter.
//
// Per-tenant blocklists live in each tenant DB (`spam_emails`, see inquiries.js)
// and *silently drop* submissions. This module is the platform-wide layer:
//
//   • Each time a tenant flags an inquiry as spam, a vote is recorded here.
//   • When GLOBAL_SPAM_THRESHOLD distinct tenants flag the same sender (or the
//     same normalized message/subject), it is promoted to the global filter.
//   • A superadmin flagging anything promotes it instantly (no vote needed).
//   • Submissions matching the global filter are still saved (as status 'spam')
//     so each tenant reviews/deletes them in their own Spam tab — they are NOT
//     dropped. That's the difference from the per-tenant blocklist.
//
// Collections (in the slab registry DB):
//   spam_reports  — one row per (type, key, tenantId): the votes
//   global_spam   — promoted entries the /contact handler checks against

import { getSlabDb } from './mongo.js';
import { normalizeEmail } from './emailNormalize.js';

export const GLOBAL_SPAM_THRESHOLD = Number(process.env.SLAB_GLOBAL_SPAM_THRESHOLD) || 3;

// Collapse free-text (service + message) into a stable comparison key.
// The raw body is a large, variable object; this strips it to a normalized,
// length-capped fingerprint so identical spam blasts collapse to one key.
export function normalizeSubject(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w ]+/g, '')
    .trim()
    .slice(0, 280);
}

// Build the subject fingerprint for an inquiry-like object.
export function subjectKeyFor({ service, message } = {}) {
  return normalizeSubject([service, message].filter(Boolean).join(' '));
}

// ── Content keyword filter ───────────────────────────────────────────────────
// Distinct from the `subject` fingerprint above: those match a whole promoted
// message. Keywords fire on a single spammy term appearing ANYWHERE in the
// subject+body (e.g. "JACKPOT"), so varying the wording or sender doesn't dodge
// them. Built-ins are terms that essentially never occur in a real inquiry;
// superadmins add more via type:'keyword' global_spam rows.
export const DEFAULT_SPAM_KEYWORDS = [
  'jackpot', 'casino', 'viagra', 'cialis', 'lottery winner', 'you have won',
  'claim your prize', 'bitcoin doubler', 'crypto giveaway', 'forex signals',
  'guaranteed roi', 'get rich', 'work from home', 'buy backlinks',
];

// Lowercased, whitespace-collapsed FULL text for keyword scanning. Unlike
// normalizeSubject this keeps punctuation and the whole body (no 280-char cap)
// so a keyword buried deep in a long message still matches.
export function keywordHaystack(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Does `haystack` contain `kw` as a standalone run? Word-boundary-ish guard so
// e.g. 'cialis' doesn't match inside 'specialist'.
export function containsKeyword(haystack, kw) {
  if (!kw) return false;
  const isWordChar = c => !!c && /[a-z0-9]/.test(c);
  let from = 0;
  while (true) {
    const i = haystack.indexOf(kw, from);
    if (i === -1) return false;
    if (!isWordChar(haystack[i - 1]) && !isWordChar(haystack[i + kw.length])) return true;
    from = i + 1;
  }
}

// Normalize a keyword for storage: lowercase, collapse whitespace, cap length.
export function normalizeKeyword(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Scan combined subject+body against the built-in list plus any admin-added
// type:'keyword' entries. Returns the first matching keyword, or null.
async function matchKeywords(sdb, text) {
  const haystack = keywordHaystack(text);
  if (!haystack) return null;
  for (const kw of DEFAULT_SPAM_KEYWORDS) {
    if (containsKeyword(haystack, kw)) return kw;
  }
  const rows = await sdb.collection('global_spam')
    .find({ active: true, type: 'keyword' }).project({ key: 1 }).limit(1000).toArray();
  for (const r of rows) {
    if (containsKeyword(haystack, r.key)) return r.key;
  }
  return null;
}

let indexed = false;
async function ensureIndexes(sdb) {
  if (indexed) return;
  indexed = true;
  await Promise.all([
    sdb.collection('spam_reports').createIndex({ type: 1, key: 1, tenantId: 1 }, { unique: true }).catch(() => {}),
    sdb.collection('global_spam').createIndex({ type: 1, key: 1 }, { unique: true }).catch(() => {}),
    sdb.collection('global_spam').createIndex({ active: 1, type: 1 }).catch(() => {}),
  ]);
}

async function promote(sdb, type, key, source, addedBy, now, count = 0) {
  await sdb.collection('global_spam').updateOne(
    { type, key },
    {
      $set: { active: true, updatedAt: now, lastSource: source },
      $max: { reportCount: count },
      $setOnInsert: { type, key, source, addedBy: addedBy || '', createdAt: now },
    },
    { upsert: true }
  );
}

/**
 * Record spam reports from a tenant (or a superadmin).
 * @param {object} o
 * @param {string[]} [o.emails]    sender addresses being flagged
 * @param {string[]} [o.subjects]  free-text service/message strings being flagged
 * @param {*}        [o.tenantId]  reporting tenant id (counts one vote)
 * @param {string}   [o.tenantDomain]
 * @param {string}   [o.reportedBy] admin email
 * @param {boolean}  [o.isSuper]   true → promote immediately, no vote
 * @returns {Promise<Array<{type:string,key:string,count?:number}>>} newly/again promoted entries
 */
export async function reportSpam({ emails = [], subjects = [], tenantId, tenantDomain, reportedBy, isSuper = false } = {}) {
  const sdb = getSlabDb();
  await ensureIndexes(sdb);
  const now = new Date();

  const entries = [];
  for (const e of emails) {
    const key = normalizeEmail(e);
    if (key) entries.push({ type: 'email', key });
  }
  for (const s of subjects) {
    const key = normalizeSubject(s);
    if (key && key.length >= 8) entries.push({ type: 'subject', key });
  }

  const promoted = [];
  for (const { type, key } of entries) {
    if (isSuper) {
      await promote(sdb, type, key, 'superadmin', reportedBy, now);
      promoted.push({ type, key });
      continue;
    }
    if (!tenantId) continue;

    await sdb.collection('spam_reports').updateOne(
      { type, key, tenantId: String(tenantId) },
      { $setOnInsert: { type, key, tenantId: String(tenantId), tenantDomain: tenantDomain || '', reportedBy: reportedBy || '', createdAt: now } },
      { upsert: true }
    );

    const count = await sdb.collection('spam_reports').countDocuments({ type, key });
    if (count >= GLOBAL_SPAM_THRESHOLD) {
      await promote(sdb, type, key, 'threshold', reportedBy, now, count);
      promoted.push({ type, key, count });
    }
  }
  return promoted;
}

/**
 * Does an incoming submission match the global filter?
 * @returns {Promise<{hit:boolean, type?:string, key?:string}>}
 */
export async function checkGlobalSpam({ email, message, service } = {}) {
  const sdb = getSlabDb();
  const emailNorm = normalizeEmail(email || '');
  const emailLower = (email || '').toLowerCase().trim();

  const emailKeys = [...new Set([emailNorm, emailLower].filter(Boolean))];
  if (emailKeys.length) {
    const emailHit = await sdb.collection('global_spam').findOne({ active: true, type: 'email', key: { $in: emailKeys } });
    if (emailHit) return { hit: true, type: 'email', key: emailHit.key };
  }

  // Content keyword scan — a single spammy term (e.g. "JACKPOT") anywhere in the
  // subject/body flags it, regardless of sender or exact wording.
  const kwHit = await matchKeywords(sdb, [service, message].filter(Boolean).join(' '));
  if (kwHit) return { hit: true, type: 'keyword', key: kwHit };

  const subjKey = subjectKeyFor({ service, message });
  if (subjKey) {
    const patterns = await sdb.collection('global_spam')
      .find({ active: true, type: 'subject' }).project({ key: 1 }).limit(1000).toArray();
    for (const p of patterns) {
      if (p.key && subjKey.includes(p.key)) return { hit: true, type: 'subject', key: p.key };
    }
  }
  return { hit: false };
}

// ── Superadmin management surface ───────────────────────────────────────────
export async function listGlobalSpam(limit = 500) {
  const sdb = getSlabDb();
  return sdb.collection('global_spam').find({}).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).toArray();
}

export async function removeGlobalSpam(type, key) {
  const sdb = getSlabDb();
  await sdb.collection('global_spam').deleteOne({ type, key });
  // also clear the votes so it doesn't immediately re-promote on the next flag
  await sdb.collection('spam_reports').deleteMany({ type, key });
}

export async function addGlobalSpam({ type, key, addedBy }) {
  const sdb = getSlabDb();
  await ensureIndexes(sdb);
  const cleanKey = type === 'subject' ? normalizeSubject(key)
    : type === 'keyword' ? normalizeKeyword(key)
    : normalizeEmail(key);
  if (!cleanKey) throw new Error('Invalid key');
  if (type === 'keyword' && cleanKey.length < 3) throw new Error('Keyword too short');
  await promote(sdb, type, cleanKey, 'superadmin', addedBy, new Date());
  return cleanKey;
}
