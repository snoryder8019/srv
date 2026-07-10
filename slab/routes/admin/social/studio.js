import express from 'express';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';
import { config } from '../../../config/config.js';
import { callLLM, tryParseAgentResponse, hasCJK, stripCJK } from '../../../plugins/agentMcp.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { logActivity } from '../../../plugins/activityLog.js';
import {
  PLATFORMS, PLATFORM_LIST, LIVE_PLATFORMS,
  packCredentials, unpackCredentials, maskAccount, isAccountConfigured,
  publishToPlatform, publishPost, verifyPlatform, discoverInstagramFromPage,
} from '../../../plugins/socialPublish.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { fetchEngagement, postReply, allEngageCaps, engageCaps } from '../../../plugins/socialEngage.js';
import { encrypt, decrypt } from '../../../plugins/crypto.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng } from '../../../plugins/autoSocial.js';
import { uploadBuffer } from '../../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../../plugins/socialDesign.js';
import { suggestSlots } from '../../../plugins/socialSchedule.js';
import { fetchAllFollows, followsAction } from '../../../plugins/socialFollows.js';
import {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseMedia, publishPostBackground, loadAccountMap,
} from './shared.js';

const router = express.Router();

// ── Agent Studio: async batch jobs (prompt → background generation → review) ──
router.post('/agent-studio/run', express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    const jobId = await enqueueJob(req.db, req.tenant, {
      type: 'studio',
      direction: b.direction || '',
      count: b.count,
      platforms: Array.isArray(b.platforms) ? b.platforms : [],
      useTrends: !!b.useTrends,
      critic: b.critic !== false,
      style: b.style,                                   // 'solid' | 'photo' | 'auto'
      mode: 'suggest',                                  // review-first: never auto-posts
      createdBy: req.adminUser?.email || 'admin',
    });
    res.json({ ok: true, jobId });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/agent-studio/jobs', async (req, res) => {
  try { res.json({ ok: true, jobs: await listJobs(req.db, 15) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

router.get('/agent-studio/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(req.db, req.params.id);
    if (!job) return res.json({ ok: false, error: 'Not found' });
    let posts = [];
    if (job.status === 'done' && Array.isArray(job.postIds) && job.postIds.length) {
      posts = await req.db.collection('social_posts').find({ _id: { $in: job.postIds } }).toArray();
    }
    res.json({ ok: true, job, posts });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});



// Follows tab: reply to / like a post from an account you follow
router.post('/follows/:platform/action', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const platform = req.params.platform;
    const account = await db.collection('social_accounts').findOne({ platform });
    const { action, replyRef, text } = req.body || {};
    const r = await followsAction(platform, account, { action, replyRef, text });
    if (r.ok) logActivity({ category: 'social', action: 'follows_' + (action || 'action'), tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success', actor: { email: req.adminUser?.email, role: 'admin' }, details: { platform }, ip: req.ip });
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


// Follows: AI-draft an on-brand reply and send it (agent-assisted outreach)
router.post('/follows/:platform/ai-reply', express.json(), async (req, res) => {
  try {
    const platform = req.params.platform;
    const { replyRef, postText, author } = req.body || {};
    const account = await req.db.collection('social_accounts').findOne({ platform });
    if (!account) return res.json({ ok: false, error: 'Account not connected' });
    const brandCtx = await loadBrandContext(req.tenant, req.db);
    const sys = `You write a short, warm, on-brand reply to someone else's social post to build a genuine connection.
${brandCtx}
Rules: 1-2 sentences, specific to their post, friendly, NOT salesy, no hashtags, no links, under 240 characters. Write in ENGLISH ONLY. Output ONLY the reply text.`;
    const userMsg = `Their post${author ? ' (by ' + author + ')' : ''}: "${String(postText || '').slice(0, 500)}"

Write the reply.`;
    const once = async (extra) => {
      const raw = await callLLM([{ role: 'user', content: userMsg }], sys + (extra || ''), 30000);
      return String(raw || '').trim().replace(/^["']|["']$/g, '').slice(0, 280);
    };
    let draft = await once('');
    // deepseek-r1 sometimes answers in Chinese — retry forcing English, then
    // strip any residual non-Latin characters as a last resort.
    if (hasCJK(draft)) draft = await once('\nThe reply MUST be entirely in English — no Chinese, Japanese, or other non-Latin characters.');
    if (hasCJK(draft)) draft = stripCJK(draft);
    if (!draft || draft.trim().length < 2) return res.json({ ok: false, error: 'Could not draft a clean English reply — try again.' });
    const r = await followsAction(platform, account, { action: 'reply', replyRef, text: draft });
    res.json({ ok: r.ok, text: draft, url: r.url || null, error: r.error || null });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


// Hand a suggestion to the full Asset Generator (loadAgentDesign shape)
router.get('/suggestions/:id/design', async (req, res) => {
  try {
    const post = await req.db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) }, { projection: { design: 1, body: 1, platforms: 1, dims: 1 } });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    res.json({ ok: true, design: post.design || null, body: post.body || '', platform: post.platforms?.[0] || null, dims: post.dims || null });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Save an Asset-Generator edit back onto the draft post. Writes the edited image
// to S3 and updates the post's mediaUrls (and optional design/body) — it does NOT
// create an Assets-library entry, so generator edits stay out of the user's library.
router.post('/suggestions/:id/image', imageUpload.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    const $set = { updatedAt: new Date() };
    if (req.file?.buffer?.length) {
      const up = await uploadPng(req.file.buffer, req.tenant?.s3Prefix, 'gen-edit-' + Date.now());
      $set.mediaUrls = [up.url];
    }
    let design = req.body?.design;
    if (typeof design === 'string') { try { design = JSON.parse(design); } catch { design = null; } }
    if (design && typeof design === 'object') $set.design = design;
    const body = req.body?.body;
    if (body !== undefined) {
      const nb = String(body).slice(0, 2000);
      if (nb.trim() && nb.trim() !== String(post.body || '').trim()) recordCorrection(db, { before: post.body || '', after: nb, source: 'generator-edit' }).catch(() => {});
      $set.body = nb;
    }
    if (!$set.mediaUrls && !$set.design && $set.body === undefined) return res.json({ ok: false, error: 'Nothing to save' });
    await db.collection('social_posts').updateOne({ _id: post._id }, { $set });
    res.json({ ok: true, mediaUrl: $set.mediaUrls ? $set.mediaUrls[0] : null });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});


/* ── DISABLED FOR RELEASE: Activity inbox (reply, mark done, refresh reddit, conversions) ──
// ── Activity inbox: reply, mark done, refresh reddit, send conversion ─────────
router.post('/activity/:id/reply', express.json(), async (req, res) => {
  try {
    const r = await replyToActivity(req.db, req.params.id, (req.body?.text || '').toString());
    res.json(r.ok ? { ok: true } : { ok: false, error: r.error });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/activity/:id/done', express.json(), async (req, res) => {
  try {
    await req.db.collection('social_activity').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { handled: !(req.body?.undo), updatedAt: new Date() } });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/activity/refresh-reddit', async (req, res) => {
  try { const r = await fetchAndStoreReddit(req.db); res.json(r); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// Conversions API — uses dataset id + token from the facebook account secrets
// ({ capiDatasetId, capiToken }) or from the request body for a manual test.
router.post('/conversions/send', express.json(), async (req, res) => {
  try {
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'facebook' });
    const sec = acct?.secrets || {};
    const datasetId = (req.body?.datasetId || sec.capiDatasetId || '').toString();
    const token = (req.body?.token || sec.capiToken || '').toString();
    const r = await sendConversionEvent({
      datasetId, token,
      eventName: req.body?.eventName || 'Lead',
      customData: req.body?.customData || {},
      userData: req.body?.userData || {},
      eventSourceUrl: req.body?.eventSourceUrl,
    });
    res.json(r);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
──────────────────────────────────────────────────────────────────────────── */



/* ── DISABLED FOR RELEASE: Listening (keyword listeners + trend digest) ────────
// ── Listening: keyword listeners + trend digest ───────────────────────────────
router.post('/listen/keywords', express.json(), async (req, res) => {
  try {
    const kw = (req.body?.keyword || '').toString().slice(0, 80);
    const sources = Array.isArray(req.body?.sources) ? req.body.sources : ['web', 'reddit'];
    const doc = await addKeyword(req.db, kw, sources);
    res.json(doc ? { ok: true, keyword: doc } : { ok: false, error: 'Empty keyword' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/listen/keywords/:id/delete', async (req, res) => {
  try { await removeKeyword(req.db, req.params.id); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/listen/run', express.json(), async (req, res) => {
  try { const r = await runListeners(req.db, req.tenant, { keyword: (req.body?.keyword || '').toString().slice(0, 80) || null }); res.json(r); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/digest/add', express.json(), async (req, res) => {
  try {
    await addDigestItem(req.db, {
      source: (req.body?.source || 'note').toString(), keyword: (req.body?.keyword || '').toString().slice(0, 80),
      title: (req.body?.title || '').toString().slice(0, 200), snippet: (req.body?.snippet || '').toString().slice(0, 500),
      url: (req.body?.url || '').toString().slice(0, 500) || undefined,
    });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/digest/:id/delete', async (req, res) => {
  try { await removeDigestItem(req.db, req.params.id); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
──────────────────────────────────────────────────────────────────────────── */


// Quote / spotlight composer — owner, mission, or customer quote → suggestion(s).
router.post('/suggestions/spotlight', express.json(), async (req, res) => {
  try {
    const out = await generateSpotlight(req.tenant, req.db, {
      kind: req.body?.kind, subject: req.body?.subject, role: req.body?.role,
      quote: req.body?.quote, createdBy: req.adminUser?.email || 'admin',
    });
    if (out.error) return res.json({ ok: false, error: out.error });
    res.json({ ok: true, ...out });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});



export default router;
