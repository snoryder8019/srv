// Shared helpers, upload/thumbnail/web-variant utilities, canvas layer renderer,
// resource-view builders, and asset-description helpers for the /admin/assets
// route modules. Extracted verbatim from the original single-file assets.js.
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


// multer memory storage — large files (images + videos up to 200MB)
const assetMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
    ok ? cb(null, true) : cb(new Error('Images and videos only'));
  },
});

async function uploadToLinode(buffer, folder, originalName, mimeType, s3Prefix) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const safe = originalName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  const filename = `${ts}-${rand}-${safe}`;
  const prefix = s3Prefix || 'default';
  const key = `${prefix}/assets/${folder}/${filename}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    ACL: 'public-read',
  }), { abortSignal: AbortSignal.timeout(60000) });

  return { key, url: bucketUrl(key), filename };
}

// Generate a thumbnail from an image buffer and upload it next to the original.
// Returns { thumbKey, thumbUrl } or null (non-raster, generation/upload failure).
async function uploadThumbnail(imageBuffer, bucketKey) {
  const thumb = await generateThumbnail(imageBuffer);
  if (!thumb) return null;
  const thumbKey = deriveThumbKey(bucketKey);
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: thumbKey,
    Body: thumb.buffer,
    ContentType: thumb.contentType,
    ACL: 'public-read',
  }), { abortSignal: AbortSignal.timeout(60000) });
  return { thumbKey, thumbUrl: bucketUrl(thumbKey) };
}

// Best-effort: generate+upload a thumbnail, swallowing errors so a thumb
// failure never blocks an upload. Returns { thumbUrl, thumbKey } | {}.
async function tryThumb(imageBuffer, bucketKey) {
  try {
    const t = await uploadThumbnail(imageBuffer, bucketKey);
    if (t) return t;
  } catch (e) {
    console.warn('Thumbnail generation failed for', bucketKey, '-', e.message);
  }
  return {};
}

// Delete an asset's thumbnail from S3 if present (best-effort).
async function deleteThumb(asset) {
  const key = asset?.thumbKey;
  if (!key || !config.LINODE_KEY) return;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    console.warn('S3 thumb delete warning:', e.message);
  }
}

// Generate a WebP web variant from an image buffer and upload it next to the
// original (sibling `web/` prefix). Returns { webKey, webUrl, webSize } or null
// (non-raster/animated/SVG, generation/upload failure).
async function uploadWebVariant(imageBuffer, bucketKey, mimeType) {
  const web = await generateWebVariant(imageBuffer, { mimeType });
  if (!web) return null;
  const webKey = deriveWebKey(bucketKey);
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: webKey,
    Body: web.buffer,
    ContentType: web.contentType,
    ACL: 'public-read',
  }), { abortSignal: AbortSignal.timeout(60000) });
  return { webKey, webUrl: bucketUrl(webKey), webSize: web.buffer.length };
}

// Best-effort web variant — swallow errors so an optimization failure never
// blocks an upload. Returns { webUrl, webKey, webSize } | {}.
async function tryWebVariant(imageBuffer, bucketKey, mimeType) {
  try {
    const w = await uploadWebVariant(imageBuffer, bucketKey, mimeType);
    if (w) return w;
  } catch (e) {
    console.warn('Web variant generation failed for', bucketKey, '-', e.message);
  }
  return {};
}

// Delete an asset's web variant from S3 if present (best-effort).
async function deleteWebVariant(asset) {
  const key = asset?.webKey;
  if (!key || !config.LINODE_KEY) return;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    console.warn('S3 web variant delete warning:', e.message);
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// GET /admin/assets
const _packIndexCache = new Map(); // packId → { items: [{name}], fetchedAt }
const PACK_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function fetchPackIndex(pack) {
  const cached = _packIndexCache.get(pack.id);
  if (cached && (Date.now() - cached.fetchedAt) < PACK_CACHE_TTL_MS) return cached.items;

  let r = await fetch(listingUrl(pack), { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`jsDelivr returned ${r.status}`);
  let data = await r.json();
  // jsDelivr's listing API rejects "latest" (returns package metadata with a
  // `tags` map instead of a `files` array). When that happens, resolve to the
  // concrete latest version and re-fetch the file listing.
  if (!Array.isArray(data.files) && data.tags?.latest) {
    r = await fetch(listingUrl(pack, data.tags.latest), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`jsDelivr returned ${r.status}`);
    data = await r.json();
  }
  const files = Array.isArray(data.files) ? data.files : [];
  // Filter to this pack's path prefix + extension; strip prefix to get bare name
  const items = files
    .filter(f => f.name.startsWith('/' + pack.pathPrefix) && f.name.endsWith(pack.extension))
    .map(f => f.name.slice(1 + pack.pathPrefix.length, -pack.extension.length))
    .sort();
  _packIndexCache.set(pack.id, { items, fetchedAt: Date.now() });
  return items;
}

// GET /admin/assets/packs — render the packs browser
const SIZE_PRESETS = {
  'ig-post': [1080, 1080], 'ig-story': [1080, 1920], 'fb-post': [1200, 630],
  'fb-cover': [1640, 624], 'twitter': [1600, 900], 'pinterest': [1000, 1500],
  'yt-thumb': [1280, 720], 'linkedin': [1200, 627], 'ig-portrait': [1080, 1350],
};

// Server-side render layers → PNG buffer (async for SD background support)
async function renderLayersToPng(design) {
  const sizeKey = design.size || 'ig-post';
  const [w, h] = SIZE_PRESETS[sizeKey] || SIZE_PRESETS['ig-post'];
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Background — SD-generated or flat color
  ctx.fillStyle = design.bgColor || '#F5F3EF';
  ctx.fillRect(0, 0, w, h);

  if (design.sdBackground) {
    // sdBackground is a PNG buffer from Stable Diffusion
    try {
      const bgImg = await loadImage(design.sdBackground);
      ctx.drawImage(bgImg, 0, 0, w, h);
    } catch (e) {
      console.error('[renderLayersToPng] Failed to load SD background:', e.message);
      // falls back to bgColor already drawn
    }
  }

  const layers = design.layers || [];
  for (const layer of layers) {
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;

    // Rotation — rotate around the layer's centre (matches the client editor)
    if (layer.rotation) {
      const cx = (layer.x || 0) + (layer.w || 0) / 2;
      const cy = (layer.y || 0) + (layer.h || 0) / 2;
      ctx.translate(cx, cy);
      ctx.rotate(layer.rotation * Math.PI / 180);
      ctx.translate(-cx, -cy);
    }

    if (layer.type === 'rect') {
      const r = layer.radius || 0;
      if (layer.fill) {
        ctx.fillStyle = layer.fill;
        if (r) {
          ctx.beginPath();
          ctx.roundRect(layer.x || 0, layer.y || 0, layer.w || 100, layer.h || 100, r);
          ctx.fill();
        } else {
          ctx.fillRect(layer.x || 0, layer.y || 0, layer.w || 100, layer.h || 100);
        }
      }
      if (layer.stroke) {
        ctx.strokeStyle = layer.stroke;
        ctx.lineWidth = layer.strokeWidth || 2;
        ctx.strokeRect(layer.x || 0, layer.y || 0, layer.w || 100, layer.h || 100);
      }
    } else if (layer.type === 'circle') {
      const cx = (layer.x || 0) + (layer.w || 100) / 2;
      const cy = (layer.y || 0) + (layer.h || 100) / 2;
      const rx = (layer.w || 100) / 2;
      const ry = (layer.h || 100) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (layer.fill) { ctx.fillStyle = layer.fill; ctx.fill(); }
      if (layer.stroke) { ctx.strokeStyle = layer.stroke; ctx.lineWidth = layer.strokeWidth || 2; ctx.stroke(); }
    } else if (layer.type === 'text' && layer.text) {
      const fontSize = layer.fontSize || 48;
      const family = layer.fontFamily === 'serif' ? 'serif' : 'sans-serif';
      const bold = layer.bold ? 'bold ' : '';
      const italic = layer.italic ? 'italic ' : '';
      ctx.font = `${italic}${bold}${fontSize}px ${family}`;
      ctx.fillStyle = layer.color || '#1C2B4A';
      ctx.textAlign = layer.align || 'center';
      ctx.textBaseline = 'top';

      // Word-wrap
      const maxW = layer.w || w - 40;
      const lines = [];
      const words = layer.text.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      let drawX = layer.x || 0;
      if (ctx.textAlign === 'center') drawX += maxW / 2;
      else if (ctx.textAlign === 'right') drawX += maxW;

      const lineH = fontSize * 1.3;
      lines.forEach((ln, i) => {
        ctx.fillText(ln, drawX, (layer.y || 0) + i * lineH);
      });
    }
    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}

// POST /admin/assets/agent — asset agent chat endpoint
function normaliseFolders(doc) {
  if (doc.folders && Array.isArray(doc.folders)) return doc;
  if (doc.folder) {
    doc.folders = [doc.folder];
  } else {
    doc.folders = ['general'];
  }
  return doc;
}

// GET /admin/assets/export — export asset list as JSON (API-ready)
async function buildResourceView(db) {
  const [accounts, assignments] = await Promise.all([
    db.collection('social_accounts').find({}).toArray(),
    db.collection('social_resources').find({}).toArray(),
  ]);
  const acctByPlatform = {};
  for (const a of accounts) acctByPlatform[a.platform] = a;
  const assignByKey = {};
  for (const r of assignments) assignByKey[`${r.platform}:${r.slot}`] = r;

  const platforms = [];
  for (const p of PLATFORM_LIST) {
    const slots = resourceSlotsFor(p.key);
    if (!slots.length) continue;
    const acct = acctByPlatform[p.key];
    const connected = !!acct && isAccountConfigured(acct);
    platforms.push({
      key: p.key, name: p.name, icon: p.icon, color: p.color,
      connected, comingSoon: !!p.comingSoon,
      slots: slots.map(s => {
        const a = assignByKey[`${p.key}:${s.key}`];
        return {
          key: s.key, label: s.label, w: s.w, h: s.h, shape: s.shape || 'square',
          push: !!s.push,
          assignment: a ? {
            assetId: String(a.assetId), assetUrl: a.assetUrl, assetTitle: a.assetTitle || null,
            updatedAt: a.updatedAt, lastPush: a.lastPush || null,
          } : null,
        };
      }),
    });
  }
  // Connected platforms first, then coming-soon last.
  platforms.sort((a, b) => (b.connected - a.connected) || (a.comingSoon - b.comingSoon));
  return platforms;
}

// GET /admin/assets/resources — render the Account Resources page
async function tryPushResource(db, platform, slot, asset) {
  if (!slotSupportsPush(platform, slot)) return null;
  try {
    const account = await db.collection('social_accounts').findOne({ platform });
    if (!account || !isAccountConfigured(account)) throw new Error('Connect this platform first');
    const creds = unpackCredentials(account);
    const out = await pushResource({ platform, slot, imageUrl: asset.publicUrl, creds });
    return { at: new Date(), ok: true, note: out?.note || 'Pushed' };
  } catch (err) {
    return { at: new Date(), ok: false, error: err.message };
  }
}

// POST /admin/assets/resources/assign — assign an asset to a platform slot.
// Body: { platform, slot, assetId, push?:bool }. When push=true and the slot is
// push-capable, also applies it live via the platform API.
const NEEDS_THUMB_CLAUSE = {
  thumbSkipped: { $ne: true },
  $or: [{ thumbUrl: { $exists: false } }, { thumbUrl: null }],
};
const NEEDS_WEB_CLAUSE = {
  webSkipped: { $ne: true },
  mimeType: { $ne: 'image/svg+xml' },
  $or: [{ webUrl: { $exists: false } }, { webUrl: null }],
};
// Image assets that need at least one derivative regenerated.
const NEEDS_OPTIMIZE = {
  fileType: 'image',
  bucketKey: { $exists: true, $ne: null },
  $or: [NEEDS_THUMB_CLAUSE, NEEDS_WEB_CLAUSE],
};

// GET /admin/assets/thumbnails/status — how many images still need optimizing
// (thumbnail and/or WebP web variant). Kept at this path for the existing UI.
const wantsThumb = (a) => !a.thumbSkipped && !a.thumbUrl;
// Does this asset still need its WebP web variant?
const wantsWeb = (a) => !a.webSkipped && !a.webUrl && a.mimeType !== 'image/svg+xml';

// POST /admin/assets/thumbnails/backfill — generate missing thumbnails AND WebP
// web variants for a batch of existing images. Each image is fetched from S3
// once and both derivatives are produced. Client calls repeatedly until
// `remaining` reaches 0.
async function describeAssetDoc(asset) {
  const ctx = [
    asset.title && `Title: ${asset.title}`,
    asset.originalName && `File: ${asset.originalName}`,
    asset.folder && `Folder: ${asset.folder}`,
    (asset.tags || []).length && `Tags: ${(asset.tags || []).join(', ')}`,
    asset.generatedFrom?.prompt && `Image prompt: ${asset.generatedFrom.prompt}`,
    asset.generatedFrom?.seed && `Seed: ${asset.generatedFrom.seed}`,
    asset.generatedFrom?.caption && `Caption: ${asset.generatedFrom.caption}`,
    asset.description && `Existing note: ${asset.description}`,
  ].filter(Boolean).join('\n');
  const sys = 'You write concise internal metadata for a design asset library so an AI agent can find the right image later. From the context, output ONLY minified JSON: {"title": "<=6 word label","description":"1-2 sentence description of what the image likely shows and its mood/palette","tags":["lowercase","keywords","mood","palette","subject"]}. No prose, no code fences.';
  const raw = await callLLM([{ role: 'user', content: ctx || 'No context; generic design asset.' }], sys, 30000);
  let meta = {};
  try { meta = JSON.parse((raw.match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch { meta = {}; }
  const tags = Array.from(new Set([...(asset.tags || []), ...((meta.tags || []).map(t => String(t).toLowerCase()))])).slice(0, 20);
  return {
    metaTitle: (meta.title || asset.title || '').toString().slice(0, 80),
    description: (meta.description || asset.description || '').toString().slice(0, 400),
    tags,
  };
}

// Describe a single asset
async function visionDescribeAsset(asset, imageBuffer) {
  const hint = [
    asset.title && `It may be titled "${asset.title}".`,
    asset.folder && `It is used in the "${asset.folder}" area.`,
  ].filter(Boolean).join(' ');
  const visionPrompt = `Describe this image factually in 2-3 sentences for website accessibility text. State the main subject, the setting/background, the dominant colors, and transcribe any visible text exactly. Do not guess beyond what is visible. ${hint}`.trim();

  const visionDesc = await callVisionLLM(imageBuffer, visionPrompt, 120000);

  const sys = 'You convert a raw image description into website image metadata. Output ONLY minified JSON, no prose, no code fences: {"altText":"concise factual alt text under 120 chars, no \\"image of\\"/\\"photo of\\" prefix","caption":"one polished sentence suitable to display under the image","tags":["lowercase","keyword","subject","color"]}';
  let parsed = {};
  try {
    const raw = await callLLM([{ role: 'user', content: `Image description:\n${visionDesc}` }], sys, 30000);
    parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || ['{}'])[0]);
  } catch { parsed = {}; }

  const altText = String(parsed.altText || visionDesc)
    .replace(/^(an?\s+)?(image|photo|picture|illustration|graphic)\s+(of|showing|depicting)\s+/i, '')
    .trim().slice(0, 250);
  const caption = String(parsed.caption || '').trim().slice(0, 500);
  const tags = Array.from(new Set([
    ...(asset.tags || []),
    ...((parsed.tags || []).map(t => String(t).toLowerCase().trim()).filter(Boolean)),
  ])).slice(0, 20);

  return { altText, caption, description: String(visionDesc).slice(0, 400), tags };
}

// Pull the raster bytes for an asset, preferring the (smaller, faster) thumbnail.
async function loadAssetImageBuffer(asset) {
  const key = asset.thumbKey || asset.bucketKey;
  if (key && config.LINODE_KEY) {
    const obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return streamToBuffer(obj.Body);
  }
  const url = asset.thumbUrl || asset.publicUrl;
  if (url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`image fetch ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error('no image source');
}

// POST /admin/assets/:id/vision-describe — fill altText + caption from a vision model

export {
  assetMem, uploadToLinode, uploadThumbnail, tryThumb, deleteThumb,
  uploadWebVariant, tryWebVariant, deleteWebVariant, streamToBuffer,
  _packIndexCache, PACK_CACHE_TTL_MS, fetchPackIndex,
  SIZE_PRESETS, renderLayersToPng, normaliseFolders,
  buildResourceView, tryPushResource,
  NEEDS_THUMB_CLAUSE, NEEDS_WEB_CLAUSE, NEEDS_OPTIMIZE, wantsThumb, wantsWeb,
  describeAssetDoc, visionDescribeAsset, loadAssetImageBuffer,
};
