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
  assetMem, uploadToLinode, uploadThumbnail, tryThumb, deleteThumb,
  uploadWebVariant, tryWebVariant, deleteWebVariant, streamToBuffer,
  fetchPackIndex, SIZE_PRESETS, renderLayersToPng, normaliseFolders,
  buildResourceView, tryPushResource, NEEDS_THUMB_CLAUSE, NEEDS_WEB_CLAUSE,
  NEEDS_OPTIMIZE, wantsThumb, wantsWeb, describeAssetDoc, visionDescribeAsset,
  loadAssetImageBuffer,
} from './shared.js';

const router = express.Router();

router.post('/generate-bg', express.json(), async (req, res) => {
  try {
    const { prompt, negative_prompt, sizePreset, enrich = true } = req.body;
    const presetKey = sizePreset || 'ig-post';

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

    const pngBuffer = await generateSdImage(finalPrompt, finalNeg, presetKey);
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
      const result = await runTool('generate_social_image', { prompt: lastMsg, brandContext });
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
      const result = await runTool('manage_assets', { action: lastMsg, query: lastMsg, brandContext: await loadBrandContext(req.tenant, req.db) });
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

// Helper: normalise legacy folder (string) → folders (array)

export default router;
