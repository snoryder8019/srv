// ── socialActivity.js ─────────────────────────────────────────────────────────
// Inbound social activity: Meta (Facebook/Instagram) webhooks for comments,
// mentions, messages and lead ads; Reddit inbox; plus reply dispatch so the
// admin Activity tab can respond. Events are routed to the correct tenant DB by
// matching the incoming page/IG id against connected accounts.
import crypto from 'crypto';
import { getSlabDb, getTenantDb } from './mongo.js';
import { unpackCredentials, redditAccessToken } from './socialPublish.js';
import { postReply } from './socialEngage.js';

const G = 'https://graph.facebook.com/v21.0';
export const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'slab-meta-verify';
const META_APP_SECRET = process.env.META_APP_SECRET || '';

// Verify X-Hub-Signature-256 over the raw body. If no app secret is configured,
// we allow it through (dev) — set META_APP_SECRET to enforce.
export function verifyMetaSignature(rawBuf, header) {
  if (!META_APP_SECRET) return true;
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(rawBuf).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header)); } catch { return false; }
}

// page/IG id → tenant account (cached briefly to avoid scanning on every event).
const _cache = new Map(); // metaId -> { at, hit }
async function findMetaTenant(metaId) {
  if (!metaId) return null;
  const c = _cache.get(metaId);
  if (c && Date.now() - c.at < 300000) return c.hit;
  let hit = null;
  try {
    const tenants = await getSlabDb().collection('tenants').find({}, { projection: { db: 1 } }).toArray();
    for (const t of tenants) {
      if (!t.db) continue;
      const db = getTenantDb(t.db);
      const accts = await db.collection('social_accounts').find({ platform: { $in: ['facebook', 'instagram'] } }).toArray();
      for (const a of accts) {
        const cr = unpackCredentials(a);
        if (String(cr.pageId) === String(metaId) || String(cr.igUserId) === String(metaId)) {
          hit = { dbName: t.db, db, account: a, platform: a.platform, creds: cr };
          break;
        }
      }
      if (hit) break;
    }
  } catch (e) { /* ignore */ }
  _cache.set(metaId, { at: Date.now(), hit });
  return hit;
}

// Upsert an activity item, deduped by externalId.
export async function recordActivity(db, item) {
  if (!item.externalId) item.externalId = `${item.type}:${item.targetId || Math.random()}`;
  await db.collection('social_activity').updateOne(
    { externalId: item.externalId },
    { $setOnInsert: { handled: false, createdAt: new Date(), ...item }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );
}

async function fetchLeadDetails(leadgenId, token) {
  try {
    const r = await fetch(`${G}/${leadgenId}?fields=field_data,created_time,ad_id,form_id&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (j.error) return null;
    const fields = {};
    (j.field_data || []).forEach(f => { fields[f.name] = (f.values || []).join(', '); });
    return { fields, createdTime: j.created_time, adId: j.ad_id, formId: j.form_id };
  } catch { return null; }
}

// Parse a full Meta webhook payload and store normalized activity per tenant.
export async function handleMetaEvent(body) {
  if (!body || !Array.isArray(body.entry)) return;
  const isIg = body.object === 'instagram';
  for (const entry of body.entry) {
    const metaId = entry.id;
    const ctx = await findMetaTenant(metaId);
    if (!ctx) continue;                       // event for a page/IG we don't manage
    const { db, account, platform, creds } = ctx;
    const token = creds.pageAccessToken || creds.accessToken;

    // Feed/comments/mentions changes
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      if (ch.field === 'leadgen' && v.leadgen_id) {
        const lead = await fetchLeadDetails(v.leadgen_id, token);
        await recordActivity(db, {
          externalId: `lead:${v.leadgen_id}`, type: 'lead', platform, metaId,
          dbName: ctx.dbName, accountId: account._id,
          title: 'New lead', text: lead ? Object.entries(lead.fields).map(([k, val]) => `${k}: ${val}`).join('\n') : 'Lead received',
          fields: lead?.fields || {}, formId: v.form_id || lead?.formId, adId: v.ad_id || lead?.adId,
          occurredAt: new Date((v.created_time || Date.now() / 1000) * 1000),
        });
      } else if (ch.field === 'feed' && (v.item === 'comment' || v.comment_id)) {
        if (v.verb && v.verb !== 'add') continue;
        await recordActivity(db, {
          externalId: `cmt:${v.comment_id}`, type: 'comment', platform, metaId,
          dbName: ctx.dbName, accountId: account._id,
          targetId: v.comment_id, postId: v.post_id, parentId: v.parent_id,
          fromName: v.from?.name, fromId: v.from?.id,
          text: v.message || '', occurredAt: new Date((v.created_time || Date.now() / 1000) * 1000),
        });
      } else if ((ch.field === 'mention' || ch.field === 'mentions') && (v.comment_id || v.media_id)) {
        await recordActivity(db, {
          externalId: `mention:${v.comment_id || v.media_id}`, type: 'mention', platform, metaId,
          dbName: ctx.dbName, accountId: account._id,
          targetId: v.comment_id || v.media_id, fromId: v.from?.id, fromName: v.from?.name,
          text: v.message || '(tagged you)', occurredAt: new Date(),
        });
      } else if (ch.field === 'comments' && v.id) {       // IG comments
        await recordActivity(db, {
          externalId: `igcmt:${v.id}`, type: 'comment', platform, metaId,
          dbName: ctx.dbName, accountId: account._id,
          targetId: v.id, postId: v.media?.id, fromName: v.from?.username, fromId: v.from?.id,
          text: v.text || '', occurredAt: new Date(),
        });
      }
    }

    // Messenger / IG direct messages
    for (const m of entry.messaging || []) {
      if (!m.message || m.message.is_echo) continue;
      await recordActivity(db, {
        externalId: `msg:${m.message.mid}`, type: 'message', platform, metaId,
        dbName: ctx.dbName, accountId: account._id,
        targetId: m.sender?.id, senderId: m.sender?.id,
        text: m.message.text || '(non-text message)', occurredAt: new Date((m.timestamp) || Date.now()),
      });
    }
  }
}

// ── Reddit inbox (unread comment replies / mentions / PMs) ───────────────────
export async function fetchAndStoreReddit(db) {
  const account = await db.collection('social_accounts').findOne({ platform: 'reddit', enabled: { $ne: false } });
  if (!account) return { ok: false, error: 'No Reddit account connected' };
  try {
    const creds = unpackCredentials(account);
    const { token, ua } = await redditAccessToken(creds);
    const r = await fetch('https://oauth.reddit.com/message/unread?limit=25', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua }, signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    let n = 0;
    for (const ch of j?.data?.children || []) {
      const d = ch.data || {};
      await recordActivity(db, {
        externalId: `reddit:${d.name}`, type: d.was_comment ? 'comment' : 'message', platform: 'reddit',
        dbName: db.databaseName, accountId: account._id,
        targetId: d.name, fromName: d.author, postId: d.parent_id,
        title: d.subject || (d.was_comment ? 'Comment reply' : 'Message'),
        text: d.body || '', occurredAt: new Date((d.created_utc || Date.now() / 1000) * 1000),
      });
      n++;
    }
    return { ok: true, count: n };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Reply dispatch ───────────────────────────────────────────────────────────
export async function replyToActivity(db, activityId, text) {
  const { ObjectId } = await import('mongodb');
  const act = await db.collection('social_activity').findOne({ _id: new ObjectId(activityId) });
  if (!act) return { ok: false, error: 'Activity not found' };
  if (!text?.trim()) return { ok: false, error: 'Empty reply' };
  const account = await db.collection('social_accounts').findOne({ _id: act.accountId });
  if (!account) return { ok: false, error: 'Connected account not found' };

  let result;
  try {
    if (act.platform === 'reddit') {
      const creds = unpackCredentials(account);
      const { token, ua } = await redditAccessToken(creds);
      const r = await fetch('https://oauth.reddit.com/api/comment', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ api_type: 'json', thing_id: act.targetId, text: text.trim() }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      const errs = j?.json?.errors || [];
      result = errs.length ? { ok: false, error: errs[0].join(' ') } : { ok: true };
    } else if (act.type === 'message') {
      const creds = unpackCredentials(account);
      const token = creds.pageAccessToken || creds.accessToken;
      const url = act.platform === 'instagram'
        ? `${G}/${creds.igUserId}/messages?access_token=${encodeURIComponent(token)}`
        : `${G}/me/messages?access_token=${encodeURIComponent(token)}`;
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: act.senderId }, message: { text: text.trim() }, messaging_type: 'RESPONSE' }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      result = j.error ? { ok: false, error: j.error.message } : { ok: true, id: j.message_id };
    } else {
      // comment / mention → reuse engage reply plumbing
      result = await postReply(act.platform, account, { targetId: act.targetId, kind: 'comment', text: text.trim() });
    }
  } catch (e) { result = { ok: false, error: e.message }; }

  if (result.ok) {
    await db.collection('social_activity').updateOne({ _id: act._id }, { $set: { handled: true, repliedAt: new Date(), replyText: text.trim() } });
  }
  return result;
}

// ── Conversions API (server-side events) ─────────────────────────────────────
// Needs a dataset (pixel) id + access token — pass explicitly or store on the
// facebook account secrets as { capiDatasetId, capiToken }.
export async function sendConversionEvent({ datasetId, token, eventName, eventTime, userData = {}, customData = {}, eventSourceUrl }) {
  if (!datasetId || !token) return { ok: false, error: 'Missing dataset id or access token' };
  try {
    const r = await fetch(`${G}/${datasetId}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [{ event_name: eventName || 'Lead', event_time: eventTime || Math.floor(Date.now() / 1000), action_source: 'website', event_source_url: eventSourceUrl, user_data: userData, custom_data: customData }] }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    return j.error ? { ok: false, error: j.error.message } : { ok: true, received: j.events_received };
  } catch (e) { return { ok: false, error: e.message }; }
}
