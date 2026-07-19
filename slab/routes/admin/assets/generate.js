import express from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { createCanvas, loadImage } from 'canvas';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../../plugins/mongo.js';
import { s3Client, BUCKET, bucketUrl } from '../../../plugins/s3.js';
import { config } from '../../../config/config.js';
import { callLLM, callVisionLLM, webSearch, tryParseAgentResponse, runTool, generateSdImage, recordTrainingCandidate, buildBrandedSdPrompt } from '../../../plugins/agentMcp.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { buildAssetReferenceIndex, annotateAssets } from '../../../plugins/usageMap.js';
import { wouldExceedQuota, getQuotaLabel } from '../../../plugins/storage.js';
import { PACKS, getPack, fileUrl, listingUrl } from '../../../data/asset-packs.js';
import { generateThumbnail, deriveThumbKey } from '../../../plugins/thumbnails.js';
import { generateWebVariant, deriveWebKey } from '../../../plugins/webVariant.js';
import {
  PLATFORM_LIST, unpackCredentials, isAccountConfigured,
  resourceSlotsFor, findResourceSlot, slotSupportsPush, pushResource,
} from '../../../plugins/socialPublish.js';
import {
  generateGridMural, sliceGridImage, buildMuralPosts, setGridLock,
  GRID_CELLS, MURAL_SPACING_DEFAULT, MURAL_SPACING_MIN, MURAL_DAILY_CAP, cellLabel,
} from '../../../plugins/socialGrid.js';
import {
  assetMem, uploadToLinode, uploadThumbnail, tryThumb, deleteThumb,
  uploadWebVariant, tryWebVariant, deleteWebVariant, streamToBuffer,
  fetchPackIndex, SIZE_PRESETS, renderLayersToPng, normaliseFolders,
  buildResourceView, tryPushResource, NEEDS_THUMB_CLAUSE, NEEDS_WEB_CLAUSE,
  NEEDS_OPTIMIZE, wantsThumb, wantsWeb, describeAssetDoc, visionDescribeAsset,
  loadAssetImageBuffer,
} from './shared.js';

const router = express.Router();

// Resolve a canvas size preset to a GPU-safe SD generation size ("WxH").
// Named presets keep their tuned small sizes; panorama presets ('pano-N') and
// very wide/large customs are capped to a ≤768px long edge (the SD box is
// TDR-prone) with the aspect preserved — the editor cover-fits/upscales the
// result across the full canvas, so a wide-but-moderate SD image fills it.
function sdSizeFor(sizePreset) {
  const SD_MAP = {
    'ig-post': '512x512', 'ig-story': '384x640', 'ig-portrait': '384x512',
    'fb-post': '640x384', 'fb-cover': '640x256', 'twitter': '640x384',
    'pinterest': '384x576', 'yt-thumb': '640x384', 'linkedin': '640x384',
  };
  if (SD_MAP[sizePreset]) return SD_MAP[sizePreset];
  let W = 0, H = 0;
  const pano = /^pano-(\d+)$/.exec(String(sizePreset || ''));
  const wxh = /^(\d+)x(\d+)$/.exec(String(sizePreset || ''));
  if (pano) { const n = Math.max(2, Math.min(10, +pano[1])); W = 1080 * n; H = 1350; }
  else if (wxh) { W = +wxh[1]; H = +wxh[2]; }
  if (!W || !H) return '512x512';
  const aspect = W / H;
  const q = (v) => Math.max(256, Math.min(768, Math.round(v / 64) * 64));
  const w2 = aspect >= 1 ? 768 : q(768 * aspect);
  const h2 = aspect >= 1 ? q(768 / aspect) : 768;
  return `${w2}x${h2}`;
}

router.post('/generate-bg', express.json(), async (req, res) => {
  try {
    const { prompt, negative_prompt, sizePreset, enrich = true } = req.body;
    const presetKey = sizePreset || 'ig-post';
    const sdSize = sdSizeFor(presetKey);   // GPU-safe (handles pano-N / wide customs)

    let finalPrompt = (prompt || '').trim();
    let finalNeg = (negative_prompt || '').trim();
    let promptSource = 'raw';

    if (enrich) {
      const brandContext = await loadBrandContext(req.tenant, req.db);
      const branded = await buildBrandedSdPrompt(finalPrompt, brandContext, { sizePreset: presetKey });
      finalPrompt = branded.prompt;
      if (!finalNeg) finalNeg = branded.negative;
      promptSource = branded.source;
    }

    if (!finalPrompt) return res.status(400).json({ error: 'prompt required' });
    if (!finalNeg) finalNeg = 'text, words, letters, numbers, watermark, blurry, low quality, deformed, ugly';

    const pngBuffer = await generateSdImage(finalPrompt, finalNeg, sdSize);
    const { key, url } = await uploadToLinode(pngBuffer, 'ai-backgrounds', `sd-bg-${Date.now()}.png`, 'image/png', req.tenant?.s3Prefix);

    recordTrainingCandidate({
      prompt: finalPrompt,
      seedPrompt: prompt || null,
      negativePrompt: finalNeg,
      sizePreset: presetKey,
      bucketKey: key, publicUrl: url, byteSize: pngBuffer.length,
      source: `generate-bg:${promptSource}`,
      tenant: { db: req.tenant?.db, name: req.tenant?.brand?.name, prefix: req.tenant?.s3Prefix },
      userEmail: req.adminUser?.email || null,
    });

    res.json({ success: true, url, size: pngBuffer.length, finalPrompt, seedPrompt: prompt || null, promptSource });
  } catch (err) {
    console.error('[generate-bg] error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/suggest-sd-prompt — return a brand-flavored SD prompt
// without generating an image. Lets the UI populate the prompt field and let
// the user review before paying for the 15–45s SD round trip.
router.post('/suggest-sd-prompt', express.json(), async (req, res) => {
  try {
    const { seed, sizePreset } = req.body || {};
    const brandContext = await loadBrandContext(req.tenant, req.db);
    const branded = await buildBrandedSdPrompt(seed || '', brandContext, { sizePreset: sizePreset || 'ig-post' });
    res.json({ success: true, ...branded });
  } catch (err) {
    console.error('[suggest-sd-prompt] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ASSET AGENT ──────────────────────────────────────────────────────────────

router.post('/agent', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { messages, mode } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'messages required' });

    const lastMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Determine if this is a social image generation or asset management request
    const isImageRequest = /\b(create|make|design|generate|build)\b.*\b(image|graphic|post|social|banner|story|cover|thumbnail)\b/i.test(lastMsg) || mode === 'generate';

    if (isImageRequest) {
      // Step 1: Get LLM to design the image (now may include sd_prompt)
      const brandContext = await loadBrandContext(req.tenant, req.db);
      const result = await runTool('generate_social_image', { prompt: lastMsg, brandContext }, { db: req.db, tenant: req.tenant });
      const fill = result.fill || {};
      const sizeKey = fill.size || 'ig-post';
      const title = fill.title || 'Social Asset';
      const folder = req.body.folder || 'clients';
      const clientId = req.body.clientId || null;
      const db = req.db;

      // Build base design (shared across variations)
      const baseDesign = {
        size: sizeKey,
        bgColor: fill.bgColor || '#F5F3EF',
        layers: fill.layers || [],
      };

      // Step 2: Guarantee an SD background. The agent's design call already had
      // full brand context, so if it produced an sd_prompt we trust it and skip
      // the second LLM round-trip (saves 10-30s and prevents Apache proxy
      // timeouts). Only fabricate via buildBrandedSdPrompt when the agent left
      // sd_prompt empty. Caller can opt out with sdDisable: true.
      let sdNeg = fill.sd_negative_prompt || 'text, words, letters, watermark, blurry, low quality';
      const sdDisabled = req.body.sdDisable === true;
      const agentSdPrompt = fill.sd_prompt && String(fill.sd_prompt).trim();
      if (!sdDisabled && !agentSdPrompt) {
        const branded = await buildBrandedSdPrompt(lastMsg, brandContext, { sizePreset: sizeKey });
        fill.sd_prompt = branded.prompt;
        if (!fill.sd_negative_prompt && branded.negative) sdNeg = branded.negative;
      }

      // Generate SD background variations. Default to 2 (restored 2026-07-02 after the
      // winhost cluster was warmed + crash-hardened — SD now returns ~6-7s warm, so 2
      // parallel images land well under the 90s abort). Caller can override via
      // req.body.variations (clamped 1-2); only applies when an SD prompt exists.
      const requestedVariations = Math.min(2, Math.max(1, parseInt(req.body.variations, 10) || 2));
      const variationCount = fill.sd_prompt ? requestedVariations : 1;
      const variations = [];

      const sdPromises = [];
      for (let i = 0; i < variationCount; i++) {
        if (fill.sd_prompt) {
          sdPromises.push(
            generateSdImage(fill.sd_prompt, sdNeg, sizeKey)
              .catch(err => { console.error(`[asset-agent] SD variation ${i} failed:`, err.message); return null; })
          );
        } else {
          sdPromises.push(Promise.resolve(null));
        }
      }
      const sdBuffers = await Promise.all(sdPromises);

      // Step 3: Render + upload each variation
      for (let i = 0; i < sdBuffers.length; i++) {
        const design = { ...baseDesign, sdBackground: sdBuffers[i] };
        const pngBuffer = await renderLayersToPng(design);

        // Upload SD bg separately so frontend can use it as a layer
        let sdBgUrl = null;
        if (sdBuffers[i]) {
          const sdUpload = await uploadToLinode(sdBuffers[i], 'ai-backgrounds', `sd-bg-${Date.now()}-${i}.png`, 'image/png', req.tenant?.s3Prefix);
          sdBgUrl = sdUpload.url;

          recordTrainingCandidate({
            prompt: fill.sd_prompt, negativePrompt: sdNeg, sizePreset: sizeKey,
            bucketKey: sdUpload.key, publicUrl: sdUpload.url, byteSize: sdBuffers[i].length,
            source: 'asset-agent',
            tenant: { db: req.tenant?.db, name: req.tenant?.brand?.name, prefix: req.tenant?.s3Prefix },
            userEmail: req.adminUser?.email || null,
          });
        }

        // Upload composite preview
        const suffix = variationCount > 1 ? `-v${i + 1}` : '';
        const { key, url, filename } = await uploadToLinode(pngBuffer, folder, `${title.replace(/\s+/g, '-')}${suffix}.png`, 'image/png', req.tenant?.s3Prefix);

        // Save to DB
        const doc = {
          filename, originalName: `${title}${suffix}.png`,
          folders: [folder], folder, clientId,
          publicUrl: url, bucketKey: key,
          fileType: 'image', mimeType: 'image/png', size: pngBuffer.length,
          title: `${title}${suffix}`,
          tags: ['social', 'ai-generated'],
          generatedFrom: { prompt: lastMsg, design: baseDesign, createdAt: new Date() },
          uploadedAt: new Date(),
        };
        const inserted = await db.collection('assets').insertOne(doc);

        variations.push({
          assetId: inserted.insertedId.toString(),
          publicUrl: url,
          sdBgUrl,
          title: doc.title,
        });
      }

      // Return design data so frontend can load editable layers
      res.json({
        message: result.message || `Created "${title}" — ${variations.length > 1 ? 'pick a variation!' : 'saved to library.'}`,
        fill,
        variations,
        design: {
          size: sizeKey,
          bgColor: baseDesign.bgColor,
          layers: baseDesign.layers,
          sdBgUrl: variations[0]?.sdBgUrl || null,
        },
      });
    } else {
      // Asset management chat — use manage_assets tool
      const result = await runTool('manage_assets', { action: lastMsg, query: lastMsg, brandContext: await loadBrandContext(req.tenant, req.db) }, { db: req.db, tenant: req.tenant });
      const planned = result.fill || {};

      // Execute the planned action
      const db = req.db;
      let actionResult = '';

      if (planned.action === 'list' || planned.action === 'search') {
        const query = {};
        if (planned.folder && planned.folder !== 'all') {
          query.$or = [{ folders: planned.folder }, { folder: planned.folder }];
        }
        if (planned.query) {
          const sq = { $or: [
            { title: { $regex: planned.query, $options: 'i' } },
            { tags: { $elemMatch: { $regex: planned.query, $options: 'i' } } },
          ]};
          if (query.$or) query.$and = [{ $or: query.$or }, sq];
          else Object.assign(query, sq);
        }
        const assets = await db.collection('assets').find(query).sort({ uploadedAt: -1 }).limit(20).toArray();
        actionResult = `Found ${assets.length} asset${assets.length !== 1 ? 's' : ''}`;
        result.assets = assets.map(a => ({ _id: a._id, title: a.title, folder: a.folder, folders: a.folders, publicUrl: a.publicUrl, fileType: a.fileType }));

      } else if (planned.action === 'create_folder') {
        const name = planned.folder || planned.query;
        if (name) {
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const existing = await db.collection('asset_folders').findOne({ slug });
          if (!existing) {
            await db.collection('asset_folders').insertOne({ name, slug, createdAt: new Date() });
            actionResult = `Created folder "${name}"`;
          } else {
            actionResult = `Folder "${name}" already exists`;
          }
        }
      }

      res.json({
        message: result.message || actionResult || 'Done.',
        fill: planned,
        actionResult,
        assets: result.assets || null,
      });
    }
  } catch (err) {
    console.error('[asset-agent] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 9-GRID MURAL ──────────────────────────────────────────────────────────────
// One square 3240×3240 design → 9 feed-post tiles, published in reverse reading
// order so Instagram's profile grid reassembles them into a single image. See
// plugins/socialGrid.js for the slice + reverse-schedule math.

// Draft AI copy for a mural: a full cover caption + one short line per cell.
router.post('/grid-mural/copy', express.json(), async (req, res) => {
  try {
    const out = await generateGridMural(req.tenant, req.db, {
      direction: (req.body?.direction || '').toString().slice(0, 400),
      bgUrl: (req.body?.bgUrl || '').toString(),
      useSd: false,                 // copy pass only — background is designed in the editor
      noText: !!req.body?.noText,
      aiCopy: true,
    });
    res.json({ ok: true, cover: out.cover, cells: out.cells });
  } catch (e) {
    console.error('[grid-mural] copy error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Schedule a mural: take the flattened 3240×3240 canvas (baked design, text and
// all), slice it into 9 tiles, and create 9 reverse-ordered scheduled single-post
// rows that the per-minute scheduler cron publishes. Bottom-right fires first;
// top-left (the cover, full caption) fires last. Instagram only — the grid trick
// is an IG profile-grid effect.
router.post('/grid-mural/schedule', assetMem.single('image'), async (req, res) => {
  try {
    const db = req.db;
    // Instagram must be connected — the mural is an IG profile-grid effect.
    const ig = await db.collection('social_accounts').findOne({ platform: 'instagram' });
    if (!ig || ig.enabled === false || !isAccountConfigured(ig)) {
      return res.status(400).json({ ok: false, error: 'Connect an Instagram account first — the 9-grid mural is an Instagram profile-grid effect.' });
    }

    // ── Daily cap: 4 murals per rolling 24h ──────────────────────────────────
    // Each mural is NINE feed posts, so 4 murals already = 36 posts/day. Instagram's
    // hard limit is 100 API posts/24h, but sustained high-volume posting — and
    // especially many near-identical grid tiles in a short window — trips its spam/
    // shadowban heuristics well BELOW that hard cap. There's also no display upside:
    // only one mural can occupy the top of the grid at a time; a new one pushes the
    // previous down and knocks it out of alignment. So 4/day is both spam-safety and
    // simply the point past which extra murals do nothing but add risk.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentMurals = await db.collection('social_posts')
      .distinct('muralId', { source: 'grid-mural', muralId: { $ne: null }, createdAt: { $gte: since } });
    if (recentMurals.length >= MURAL_DAILY_CAP) {
      return res.status(429).json({ ok: false, error: `Daily mural limit reached (${MURAL_DAILY_CAP} per 24h). Each mural is 9 posts — more than this in a day risks Instagram's spam/shadowban filters and can't all sit aligned on your grid anyway. Try again later.` });
    }

    // Source image: the uploaded flattened canvas, or a previously-stored bgUrl.
    let srcUrl = (req.body?.bgUrl || '').toString();
    if (req.file?.buffer?.length) {
      const up = await uploadToLinode(req.file.buffer, 'mural', `mural-${Date.now()}.png`, 'image/png', req.tenant?.s3Prefix);
      srcUrl = up.url;
    }
    if (!srcUrl) return res.status(400).json({ ok: false, error: 'No mural image — design the 3240×3240 grid and try again.' });

    // Cut into 9 tiles in reading order (top-left → bottom-right).
    const tiles = await sliceGridImage(srcUrl, req.tenant?.s3Prefix);
    if (tiles.length !== GRID_CELLS) return res.status(500).json({ ok: false, error: 'Could not slice the mural into 9 tiles — try re-saving the design.' });

    // Captions: cover (top-left, publishes last) + one short line per cell.
    let cells = req.body?.cells;
    if (typeof cells === 'string') { try { cells = JSON.parse(cells); } catch { cells = []; } }
    if (!Array.isArray(cells)) cells = [];
    const cover = (req.body?.cover || '').toString().slice(0, 2000);

    // Timing: start now-ish (or a caller-supplied start), spacing ≥60s (cron floor).
    const spacingSec = Math.max(MURAL_SPACING_MIN, parseInt(req.body?.spacingSec, 10) || MURAL_SPACING_DEFAULT);
    const startAt = req.body?.startAt ? new Date(req.body.startAt) : new Date(Date.now() + 60 * 1000); // first tile ~next cron tick
    const muralId = new ObjectId().toString();

    const base = {
      source: 'grid-mural',
      kind: 'mural',
      muralImageUrl: srcUrl,
      dims: `9 × 1080×1080 grid`,
      createdBy: req.adminUser?.email || 'grid-mural',
    };
    const posts = buildMuralPosts(base, tiles, {
      startAt, spacingSec, cover, cells, platforms: ['instagram'], muralId,
    });

    await db.collection('social_posts').insertMany(posts);

    // Deploying a mural auto-arms grid-lock: from now on, non-mural IG feed posts are
    // sandbagged and released in rows of 3 so this mural stays aligned (until the
    // admin turns protection off). See socialCron.runDuePosts + socialGrid.
    await setGridLock(db, true, muralId);

    // Report the human-readable plan back (publish order = reverse reading order).
    const plan = posts.map(p => ({
      cell: p.muralCell, order: p.muralOrder, readIndex: p.muralIndex,
      scheduledAt: p.scheduledAt, cover: p.muralCover,
    }));
    res.json({
      ok: true, muralId, count: posts.length, spacingSec,
      firstAt: posts[0]?.scheduledAt || null,
      lastAt: posts[posts.length - 1]?.scheduledAt || null,
      plan,
    });
  } catch (e) {
    console.error('[grid-mural] schedule error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
