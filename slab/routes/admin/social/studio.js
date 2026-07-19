import express from 'express';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';
import { config } from '../../../config/config.js';
import { callLLM, tryParseAgentResponse, hasCJK, stripCJK } from '../../../plugins/agentMcp.js';
import { agentLLMOpts } from '../../../plugins/agentRegistry.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { logActivity } from '../../../plugins/activityLog.js';
import {
  PLATFORMS, PLATFORM_LIST, LIVE_PLATFORMS,
  packCredentials, unpackCredentials, maskAccount, isAccountConfigured,
  publishToPlatform, publishPost, verifyPlatform, discoverInstagramFromPage,
  platformSupportsFormat,
} from '../../../plugins/socialPublish.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { fetchEngagement, postReply, allEngageCaps, engageCaps } from '../../../plugins/socialEngage.js';
import { encrypt, decrypt } from '../../../plugins/crypto.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { generateForTenant, generateSpotlight, generateStoryFrames, generateSeamlessCarousel, rerenderSeamlessPreview, publishWithRetry, renderLayersToPng, uploadPng } from '../../../plugins/autoSocial.js';
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
      promote: Array.isArray(b.promote) ? b.promote : [],   // follow site content (blog/portfolio/careers)
      leadGen: !!b.leadGen,                                 // drive newsletter signups
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
      const raw = await callLLM([{ role: 'user', content: userMsg }], sys + (extra || ''), 30000, await agentLLMOpts(req.db, req.tenant, 'social'));
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


// Hand a suggestion to the full Asset Generator (loadAgentDesign shape).
// A seamless carousel has no single `design`, so synthesize a wide PANORAMA design
// (size pano-N) — the stored wide background + one scrim/headline/subtitle layer
// stack per tile — so the whole width opens in the canvas editor, fully editable.
router.get('/suggestions/:id/design', async (req, res) => {
  try {
    const post = await req.db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) },
      { projection: { design: 1, body: 1, platforms: 1, dims: 1, format: 1, seamless: 1, bgUrl: 1, slides: 1, bakedBg: 1, noText: 1 } });
    if (!post) return res.json({ ok: false, error: 'Not found' });

    if (post.format === 'carousel' && post.seamless && !post.design) {
      const slides = Array.isArray(post.slides) ? post.slides : [];
      const N = Math.max(2, Math.min(10, slides.length || 2));
      const designRaw = await req.db.collection('design').find({}).toArray();
      const D = {}; for (const d of designRaw) D[d.key] = d.value;
      const accent = D.color_accent || '#C9A848', text = D.color_text || '#FFFFFF', bg = D.color_primary || '#0D0D14';
      const tileW = 1080, tileH = 1350, padX = Math.round(tileW * 0.10);
      const layers = [];
      // Baked (text flattened in) or no-text carousels open as a plain background
      // with NO text layers — the admin edits the whole canvas freely.
      if (!post.bakedBg && !post.noText) {
        for (let i = 0; i < N; i++) {
          const ox = i * tileW; const s = slides[i] || {};
          layers.push({ type: 'rect', x: ox, y: Math.round(tileH * 0.50), w: tileW, h: Math.round(tileH * 0.50), fill: 'rgba(5,5,8,0.45)' });
          layers.push({ type: 'text', text: s.headline || 'Headline', x: ox + padX, y: Math.round(tileH * 0.60), w: tileW - padX * 2, h: Math.round(tileH * 0.20), fontSize: Math.round(tileW * 0.11), color: accent, align: 'center', bold: true });
          if (s.subtitle) layers.push({ type: 'text', text: s.subtitle, x: ox + padX, y: Math.round(tileH * 0.815), w: tileW - padX * 2, h: Math.round(tileH * 0.10), fontSize: Math.round(tileW * 0.045), color: text, align: 'center' });
        }
      }
      const design = { size: 'pano-' + N, bgColor: bg, sdBgUrl: post.bgUrl || null, layers };
      return res.json({ ok: true, design, body: post.body || '', platform: post.platforms?.[0] || null, dims: post.dims || null, seamless: true });
    }

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
    const isCarousel = post.format === 'carousel' && post.seamless;
    const $set = { updatedAt: new Date() };
    if (req.file?.buffer?.length) {
      const up = await uploadPng(req.file.buffer, req.tenant?.s3Prefix, 'gen-edit-' + Date.now());
      // Carousel: the flattened wide canvas becomes the BAKED background (text and
      // all). Publish slices this image directly — no auto-header overlay. mediaUrls
      // holds it as the preview.
      if (isCarousel) { $set.bgUrl = up.url; $set.bakedBg = true; $set.mediaUrls = [up.url]; $set.seamlessMaterialized = false; }
      else $set.mediaUrls = [up.url];
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


// Story Studio — AI-script an Instagram story sequence, render each frame to a
// 1080×1920 PNG, and drop it into the Agent Studio review queue as a story-format
// draft (suggestion). "Keep & Post" then publishes it as an IG story. Stories are
// Instagram-only, so this requires a connected IG account.
router.post('/agent-studio/story', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const ig = await db.collection('social_accounts').findOne({ platform: 'instagram' });
    if (!ig || ig.enabled === false || !isAccountConfigured(ig)) {
      return res.status(400).json({ ok: false, error: 'Connect an Instagram account first — stories publish to Instagram only.' });
    }
    const out = await generateStoryFrames(req.tenant, req.db, {
      count: Math.max(2, Math.min(8, Number(req.body?.count) || 4)),
      direction: (req.body?.direction || '').toString().slice(0, 400),
      sources: Array.isArray(req.body?.promote) ? req.body.promote.map(String) : false,   // false = don't pull site content
      leadGen: !!req.body?.leadGen,
    });
    const frames = out.frames || [];
    if (!frames.length) return res.status(500).json({ ok: false, error: 'No frames were generated' });
    const hook = frames[0];
    const doc = {
      body: hook.headline || 'Story',
      link: '',
      mediaUrls: frames.map(f => f.url),          // ordered frames → IG story sequence
      platforms: ['instagram'],
      format: 'story',
      status: 'draft',
      suggestion: true,
      source: 'story-studio',
      kind: 'story',
      headline: hook.headline || '',
      subtitle: hook.subtitle || '',
      design: frames.map(f => f.design),          // per-frame designs (for later editing)
      storyFrames: frames.map(f => ({ url: f.url, kind: f.kind, headline: f.headline, subtitle: f.subtitle })),
      dims: `${frames.length} frames`,
      scheduledAt: null, publishedAt: null, results: [],
      createdBy: req.adminUser?.email || 'story-studio',
      createdAt: new Date(), updatedAt: new Date(),
    };
    const ins = await db.collection('social_posts').insertOne(doc);
    res.json({ ok: true, post: { ...doc, _id: ins.insertedId } });
  } catch (e) {
    console.error('[social] story build error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// Seamless ("panorama") carousel — AI-draft N slide headers, render them over an
// uploaded wide background, slice into N 1080×1350 tiles, and drop a carousel
// draft into the review queue. Carousels post to Instagram / Threads.
router.post('/agent-studio/carousel', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const db = req.db;
    const accts = await db.collection('social_accounts').find({}).toArray();
    const capable = accts
      .filter(a => a.enabled !== false && isAccountConfigured(a) && platformSupportsFormat(a.platform, 'carousel'))
      .map(a => a.platform);
    if (!capable.length) return res.status(400).json({ ok: false, error: 'Connect an Instagram or Threads account first — carousels post there.' });

    const out = await generateSeamlessCarousel(req.tenant, req.db, {
      count: Math.max(2, Math.min(10, Number(req.body?.count) || 4)),
      direction: (req.body?.direction || '').toString().slice(0, 400),
      bgUrl: (req.body?.bgUrl || '').toString(),
      useSd: !!req.body?.useSd,
      noText: !!req.body?.noText,
    });
    const slides = out.slides || [];
    if (slides.length < 2) return res.status(500).json({ ok: false, error: 'A carousel needs at least 2 slides' });

    // NOTE: not sliced yet — mediaUrls holds the wide PREVIEW; tiles are cut at
    // publish (see suggestions.js seamless materialization).
    const doc = {
      body: slides[0].headline || 'Carousel',
      link: '',
      mediaUrls: [out.previewUrl],              // wide composite preview (sliced on send)
      platforms: capable,
      format: 'carousel',
      status: 'draft',
      suggestion: true,
      source: 'carousel-studio',
      kind: 'carousel',
      seamless: true,
      noText: !!out.noText,                     // background-only (admin's own design carries copy)
      slides,                                   // editable per-slide copy
      bgUrl: out.bgUrl || null,                 // persisted wide background (upload/SD/null=gradient)
      previewUrl: out.previewUrl,
      headline: slides[0].headline || '',
      subtitle: slides[0].subtitle || '',
      dims: `${slides.length} × 1080×1350 pano`,
      scheduledAt: null, publishedAt: null, results: [],
      createdBy: req.adminUser?.email || 'carousel-studio',
      createdAt: new Date(), updatedAt: new Date(),
    };
    const ins = await db.collection('social_posts').insertOne(doc);
    res.json({ ok: true, post: { ...doc, _id: ins.insertedId } });
  } catch (e) {
    console.error('[social] carousel build error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Edit a seamless carousel — apply per-slide copy edits and/or a new background,
// re-render the wide PREVIEW (still unsliced). Slicing happens later at publish.
router.post('/agent-studio/carousel/:id/update', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const db = req.db;
    const post = await db.collection('social_posts').findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.json({ ok: false, error: 'Not found' });
    const slides = Array.isArray(req.body?.slides) ? req.body.slides
      .map(s => ({ headline: String(s?.headline || '').slice(0, 120), subtitle: String(s?.subtitle || '').slice(0, 160) }))
      .filter(s => s.headline || s.subtitle || s.headline === '') : [];
    if (slides.length < 2) return res.json({ ok: false, error: 'A carousel needs at least 2 slides' });

    // Background editor: a newly-uploaded bgUrl or AI toggle overrides the stored one.
    const newBg = (req.body?.bgUrl || '').toString();
    const useSd = !!req.body?.useSd;
    const noText = req.body?.noText !== undefined ? !!req.body.noText : !!post.noText;
    const out = await rerenderSeamlessPreview(req.tenant, req.db, {
      slides,
      bgUrl: newBg || (useSd ? '' : (post.bgUrl || '')),
      useSd, noText,
      direction: post.body || '',
    });

    await db.collection('social_posts').updateOne({ _id: post._id }, {
      $set: {
        mediaUrls: [out.previewUrl], previewUrl: out.previewUrl,
        slides: out.slides, bgUrl: out.bgUrl || null, noText,
        headline: out.slides[0]?.headline || '', body: out.slides[0]?.headline || post.body,
        dims: `${out.slides.length} × 1080×1350 pano`, updatedAt: new Date(),
      },
    });
    res.json({ ok: true, previewUrl: out.previewUrl, slides: out.slides });
  } catch (e) {
    console.error('[social] carousel update error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


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
