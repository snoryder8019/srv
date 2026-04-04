import express from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { createCanvas, loadImage } from 'canvas';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../plugins/mongo.js';
import { s3Client, BUCKET, bucketUrl } from '../../plugins/s3.js';
import { config } from '../../config/config.js';
import { callLLM, webSearch, tryParseAgentResponse, runTool, generateSdImage } from '../../plugins/agentMcp.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { wouldExceedQuota, getQuotaLabel } from '../../plugins/storage.js';

const router = express.Router();

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
  }));

  return { key, url: bucketUrl(key), filename };
}

// GET /admin/assets
router.get('/', (req, res) => {
  res.render('admin/assets/index', { user: req.adminUser, page: 'assets' });
});

// GET /admin/assets/social — social media asset generator
router.get('/social', (req, res) => {
  res.render('admin/assets/social', { user: req.adminUser, page: 'assets' });
});

// GET /admin/assets/trim
router.get('/trim', (req, res) => {
  res.render('admin/assets/trim', { user: req.adminUser, page: 'assets' });
});

// ── SD BACKGROUND GENERATION (for social generator frontend) ─────────────────

router.post('/generate-bg', express.json(), async (req, res) => {
  try {
    const { prompt, negative_prompt, sizePreset } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const negPrompt = negative_prompt || 'text, words, letters, numbers, watermark, blurry, low quality, deformed, ugly';
    const pngBuffer = await generateSdImage(prompt, negPrompt, sizePreset || 'ig-post');

    // Upload to S3 so the frontend can use it as an image layer
    const { key, url } = await uploadToLinode(pngBuffer, 'ai-backgrounds', `sd-bg-${Date.now()}.png`, 'image/png', req.tenant?.s3Prefix);

    res.json({ success: true, url, size: pngBuffer.length });
  } catch (err) {
    console.error('[generate-bg] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ASSET AGENT ──────────────────────────────────────────────────────────────

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
router.post('/agent', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { messages, mode } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'messages required' });

    const lastMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Determine if this is a social image generation or asset management request
    const isImageRequest = /\b(create|make|design|generate|build)\b.*\b(image|graphic|post|social|banner|story|cover|thumbnail)\b/i.test(lastMsg) || mode === 'generate';

    if (isImageRequest) {
      // Step 1: Get LLM to design the image (now may include sd_prompt)
      const result = await runTool('generate_social_image', { prompt: lastMsg, brandContext: await loadBrandContext(req.tenant, req.db) });
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

      // Step 2: Generate SD background variations (2 if SD requested, 1 if flat)
      const variationCount = fill.sd_prompt ? 2 : 1;
      const sdNeg = fill.sd_negative_prompt || 'text, words, letters, watermark, blurry, low quality';
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
router.get('/export', async (req, res) => {
  try {
    const db = req.db;
    const { folder, clientId, type } = req.query;
    const query = {};
    if (folder && folder !== 'all') {
      query.$or = [{ folders: folder }, { folder: folder }];
    }
    if (clientId) query.clientId = clientId;
    if (type && type !== 'all') query.fileType = type;
    const assets = await db.collection('assets').find(query).sort({ uploadedAt: -1 }).toArray();
    const exported = assets.map(a => {
      normaliseFolders(a);
      return {
        id: a._id,
        title: a.title,
        url: a.publicUrl,
        type: a.fileType,
        folders: a.folders,
        folder: a.folders[0],
        tags: a.tags || [],
        size: a.size,
        clientId: a.clientId || null,
        uploadedAt: a.uploadedAt,
      };
    });
    res.json({ count: exported.length, assets: exported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/clients — lightweight client list for dropdowns (includes brand colors/fonts + status)
router.get('/clients', async (req, res) => {
  try {
    const db = req.db;
    const clients = await db.collection('clients')
      .find({}, { projection: { name: 1, company: 1, brandColors: 1, brandFonts: 1, status: 1 } })
      .sort({ name: 1 }).toArray();
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/brand-kit/:type/:id — unified brand kit for tenant or client
// type = "tenant" (id ignored) or "client" (id = client _id)
router.get('/brand-kit/:type/:id?', async (req, res) => {
  try {
    const db = req.db;
    const { type } = req.params;

    if (type === 'tenant') {
      // Load tenant design settings
      const rawDesign = await db.collection('design').find({}).toArray();
      const design = {};
      for (const item of rawDesign) design[item.key] = item.value;
      const brand = req.tenant?.brand || {};

      // Build palette from design colors
      const colors = [
        design.color_primary || '#1C2B4A',
        design.color_accent || '#C9A848',
        design.color_bg || '#F5F3EF',
        design.color_primary_deep || '#0F1B30',
        design.color_primary_mid || '#2E4270',
        design.color_accent_light || '#E8D08A',
      ].filter(Boolean);

      // Load brand images for logo
      const brandImages = await db.collection('brand_images').find({}).toArray();
      const logo = brandImages.find(b => b.slot === 'logo_primary')?.url || null;

      // Load presets tagged to tenant (no clientId)
      const presets = await db.collection('social_presets')
        .find({ $or: [{ clientId: null }, { clientId: '' }, { clientId: { $exists: false } }, { brandTarget: 'tenant' }] })
        .sort({ updatedAt: -1 }).toArray();

      res.json({
        type: 'tenant',
        name: brand.name || 'My Brand',
        colors,
        fonts: {
          heading: design.font_heading || 'Cormorant Garamond',
          body: design.font_body || 'Jost',
        },
        logo,
        presets,
      });
    } else if (type === 'client') {
      const clientId = req.params.id;
      if (!clientId) return res.status(400).json({ error: 'Client ID required' });
      const client = await db.collection('clients').findOne({ _id: new ObjectId(clientId) });
      if (!client) return res.status(404).json({ error: 'Client not found' });

      const presets = await db.collection('social_presets')
        .find({ $or: [{ clientId }, { brandTarget: clientId }] })
        .sort({ updatedAt: -1 }).toArray();

      res.json({
        type: 'client',
        _id: client._id,
        name: client.company || client.name,
        colors: client.brandColors || [],
        fonts: client.brandFonts || { heading: '', body: '' },
        presets,
      });
    } else {
      res.status(400).json({ error: 'Type must be "tenant" or "client"' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/brand-kit/:type/:id? — save brand colors/fonts back
router.put('/brand-kit/:type/:id?', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { type } = req.params;
    const { colors, fonts } = req.body;

    if (type === 'tenant') {
      // Update design color settings
      if (colors?.length >= 3) {
        const colorKeys = ['color_primary', 'color_accent', 'color_bg', 'color_primary_deep', 'color_primary_mid', 'color_accent_light'];
        const ops = colors.slice(0, 6).map((val, i) =>
          db.collection('design').updateOne(
            { key: colorKeys[i] },
            { $set: { key: colorKeys[i], value: val, updatedAt: new Date() } },
            { upsert: true }
          )
        );
        await Promise.all(ops);
      }
      if (fonts) {
        const fontOps = [];
        if (fonts.heading) fontOps.push(db.collection('design').updateOne({ key: 'font_heading' }, { $set: { key: 'font_heading', value: fonts.heading, updatedAt: new Date() } }, { upsert: true }));
        if (fonts.body) fontOps.push(db.collection('design').updateOne({ key: 'font_body' }, { $set: { key: 'font_body', value: fonts.body, updatedAt: new Date() } }, { upsert: true }));
        if (fontOps.length) await Promise.all(fontOps);
      }
      res.json({ success: true });
    } else if (type === 'client') {
      const clientId = req.params.id;
      if (!clientId) return res.status(400).json({ error: 'Client ID required' });
      const $set = { updatedAt: new Date() };
      if (colors) $set.brandColors = colors;
      if (fonts) $set.brandFonts = fonts;
      await db.collection('clients').updateOne({ _id: new ObjectId(clientId) }, { $set });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Type must be "tenant" or "client"' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CUSTOM FOLDERS ──

// GET /admin/assets/folders — list custom folders
router.get('/folders', async (req, res) => {
  try {
    const db = req.db;
    const folders = await db.collection('asset_folders').find({}).sort({ name: 1 }).toArray();
    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/folders — create a custom folder
router.post('/folders', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    // Slug: lowercase, alphanumeric + dashes
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid folder name' });
    // Don't collide with built-in folders
    const builtIn = ['all', 'general', 'sections', 'portfolio', 'blog', 'pages', 'clients'];
    if (builtIn.includes(slug)) return res.status(400).json({ error: 'That folder name is reserved' });
    // Don't allow duplicates
    const existing = await db.collection('asset_folders').findOne({ slug });
    if (existing) return res.status(400).json({ error: 'Folder already exists' });
    const doc = { name, slug, createdAt: new Date() };
    const r = await db.collection('asset_folders').insertOne(doc);
    res.json({ success: true, folder: { ...doc, _id: r.insertedId } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/folders/:id — rename a custom folder
router.put('/folders/:id', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const folder = await db.collection('asset_folders').findOne({ _id: new ObjectId(req.params.id) });
    if (!folder) return res.status(404).json({ error: 'Not found' });
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    const newSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!newSlug) return res.status(400).json({ error: 'Invalid folder name' });
    const builtIn = ['all', 'general', 'sections', 'portfolio', 'blog', 'pages', 'clients'];
    if (builtIn.includes(newSlug)) return res.status(400).json({ error: 'That folder name is reserved' });
    // Check for duplicate slug (excluding self)
    const dup = await db.collection('asset_folders').findOne({ slug: newSlug, _id: { $ne: folder._id } });
    if (dup) return res.status(400).json({ error: 'A folder with that name already exists' });
    const oldSlug = folder.slug;
    await db.collection('asset_folders').updateOne({ _id: folder._id }, { $set: { name, slug: newSlug, updatedAt: new Date() } });
    // Update all assets that reference the old slug
    if (oldSlug !== newSlug) {
      // Update `folders` array entries
      await db.collection('assets').updateMany(
        { folders: oldSlug },
        { $set: { 'folders.$': newSlug } }
      );
      // Update legacy `folder` field
      await db.collection('assets').updateMany(
        { folder: oldSlug },
        { $set: { folder: newSlug } }
      );
    }
    res.json({ success: true, folder: { _id: folder._id, name, slug: newSlug } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/folders/:id — delete a custom folder
// Assets with ONLY this folder → fully deleted (incl. S3 file)
// Assets with multiple folders → just remove this folder tag
router.delete('/folders/:id', async (req, res) => {
  try {
    const db = req.db;
    const folder = await db.collection('asset_folders').findOne({ _id: new ObjectId(req.params.id) });
    if (!folder) return res.status(404).json({ error: 'Not found' });

    const slug = folder.slug;

    // Find assets that have ONLY this folder (delete them fully)
    const soloAssets = await db.collection('assets').find({
      $or: [
        { folders: [slug] },                             // folders array is exactly [slug]
        { folders: slug, $expr: { $eq: [{ $size: '$folders' }, 1] } },
      ]
    }).toArray();
    // Also catch legacy assets with folder=slug and no folders array
    const legacySolo = await db.collection('assets').find({
      folder: slug,
      $or: [{ folders: { $exists: false } }, { folders: null }, { folders: { $size: 0 } }]
    }).toArray();
    const allSoloAssets = [...soloAssets, ...legacySolo];

    // Delete solo assets from S3
    let s3Deleted = 0;
    for (const asset of allSoloAssets) {
      if (asset.bucketKey && config.LINODE_KEY) {
        try {
          await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: asset.bucketKey }));
          s3Deleted++;
        } catch (s3Err) {
          console.warn('S3 folder-delete warning:', s3Err.message);
        }
      }
    }
    // Delete solo assets from DB
    const soloIds = allSoloAssets.map(a => a._id);
    if (soloIds.length) {
      await db.collection('assets').deleteMany({ _id: { $in: soloIds } });
    }

    // For multi-folder assets, just pull this slug
    await db.collection('assets').updateMany(
      { folders: slug },
      { $pull: { folders: slug } }
    );
    // Fix legacy field if it pointed to this folder
    await db.collection('assets').updateMany(
      { folder: slug },
      [{ $set: { folder: { $ifNull: [{ $arrayElemAt: ['$folders', 0] }, 'general'] } } }]
    );

    // Remove the folder record
    await db.collection('asset_folders').deleteOne({ _id: folder._id });

    res.json({ success: true, assetsDeleted: soloIds.length, s3Deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SOCIAL PRESETS ──

// GET /admin/assets/social/presets — list all saved presets
router.get('/social/presets', async (req, res) => {
  try {
    const db = req.db;
    const query = {};
    if (req.query.clientId) query.clientId = req.query.clientId;
    const presets = await db.collection('social_presets')
      .find(query).sort({ updatedAt: -1 }).toArray();
    res.json({ presets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/social/presets — save a new preset
router.post('/social/presets', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const db = req.db;
    const { name, canvasW, canvasH, sizePreset, bgColor, palette, layers, clientId, folder, brandTarget } = req.body;
    const doc = {
      name: name || 'Untitled',
      canvasW: canvasW || 1080,
      canvasH: canvasH || 1080,
      sizePreset: sizePreset || 'ig-post',
      bgColor: bgColor || '#F5F3EF',
      palette: palette || [],
      layers: layers || [],
      clientId: clientId || null,
      brandTarget: brandTarget || 'tenant',
      folder: folder || 'clients',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const r = await db.collection('social_presets').insertOne(doc);
    res.json({ success: true, preset: { ...doc, _id: r.insertedId } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/social/presets/:id
router.get('/social/presets/:id', async (req, res) => {
  try {
    const db = req.db;
    const preset = await db.collection('social_presets').findOne({ _id: new ObjectId(req.params.id) });
    if (!preset) return res.status(404).json({ error: 'Not found' });
    res.json({ preset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/social/presets/:id — update existing preset
router.put('/social/presets/:id', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const db = req.db;
    const { name, canvasW, canvasH, sizePreset, bgColor, palette, layers, clientId, folder, brandTarget } = req.body;
    const $set = { updatedAt: new Date() };
    if (name !== undefined) $set.name = name;
    if (canvasW !== undefined) $set.canvasW = canvasW;
    if (canvasH !== undefined) $set.canvasH = canvasH;
    if (sizePreset !== undefined) $set.sizePreset = sizePreset;
    if (bgColor !== undefined) $set.bgColor = bgColor;
    if (palette !== undefined) $set.palette = palette;
    if (layers !== undefined) $set.layers = layers;
    if (clientId !== undefined) $set.clientId = clientId || null;
    if (brandTarget !== undefined) $set.brandTarget = brandTarget || 'tenant';
    if (folder !== undefined) $set.folder = folder;
    await db.collection('social_presets').updateOne({ _id: new ObjectId(req.params.id) }, { $set });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/social/presets/:id
router.delete('/social/presets/:id', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('social_presets').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/list — JSON API with filtering
router.get('/list', async (req, res) => {
  try {
    const db = req.db;
    const { folder, type, search, clientId, sort: sortParam, limit = 100, skip = 0 } = req.query;
    const query = {};
    const andClauses = [];
    if (folder && folder !== 'all') {
      // Support both legacy `folder` string and new `folders` array
      andClauses.push({ $or: [{ folders: folder }, { folder: folder }] });
    }
    if (type && type !== 'all') query.fileType = type;
    if (clientId) query.clientId = clientId;
    if (search) {
      andClauses.push({ $or: [
        { title: { $regex: search, $options: 'i' } },
        { originalName: { $regex: search, $options: 'i' } },
        { tags: { $elemMatch: { $regex: search, $options: 'i' } } },
      ]});
    }
    if (andClauses.length) query.$and = andClauses;

    // Sorting
    let sortObj = { uploadedAt: -1 };
    if (sortParam === 'name') sortObj = { title: 1 };
    else if (sortParam === 'size') sortObj = { size: -1 };
    else if (sortParam === 'oldest') sortObj = { uploadedAt: 1 };

    const [assets, total] = await Promise.all([
      db.collection('assets').find(query).sort(sortObj).skip(Number(skip)).limit(Number(limit)).toArray(),
      db.collection('assets').countDocuments(query),
    ]);
    res.json({ assets, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/upload — multi-file upload
router.post('/upload', assetMem.array('files', 20), async (req, res) => {
  try {
    const db = req.db;
    // Support both `folders` (array/CSV) and legacy `folder` (string)
    let folders = req.body.folders;
    if (folders && typeof folders === 'string') folders = folders.split(',').map(f => f.trim()).filter(Boolean);
    if (!folders?.length) folders = [req.body.folder || 'general'];
    const folder = folders[0]; // primary folder for S3 path
    const clientId = req.body.clientId || null;
    if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });

    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }

    // Storage quota check
    const totalUploadSize = req.files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (req.tenant && await wouldExceedQuota(db, req.tenant, totalUploadSize)) {
      const label = getQuotaLabel(req.tenant);
      return res.status(413).json({ error: `Storage limit reached (${label}). Delete files or upgrade your plan.`, code: 'STORAGE_QUOTA_EXCEEDED' });
    }

    const results = [];
    for (const file of req.files) {
      const fileType = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const { key, url, filename } = await uploadToLinode(file.buffer, folder, file.originalname, file.mimetype, req.tenant?.s3Prefix);
      const doc = {
        filename,
        originalName: file.originalname,
        folders,
        folder: folders[0], // legacy compat
        clientId,
        publicUrl: url,
        bucketKey: key,
        fileType,
        mimeType: file.mimetype,
        size: file.size,
        title: file.originalname.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        tags: [],
        uploadedAt: new Date(),
      };
      const r = await db.collection('assets').insertOne(doc);
      results.push({ ...doc, _id: r.insertedId });
    }
    res.json({ success: true, assets: results });
  } catch (err) {
    console.error('Asset upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/trim-upload — upload a pre-trimmed video from client-side MediaRecorder
router.post('/trim-upload', assetMem.single('video'), async (req, res) => {
  try {
    const db = req.db;
    const { folder = 'general', filename: customName, startTime, endTime } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }
    if (req.tenant && await wouldExceedQuota(db, req.tenant, req.file.size || 0)) {
      return res.status(413).json({ error: `Storage limit reached (${getQuotaLabel(req.tenant)}). Delete files or upgrade.`, code: 'STORAGE_QUOTA_EXCEEDED' });
    }

    const name = customName || req.file.originalname;
    const { key, url, filename } = await uploadToLinode(req.file.buffer, folder, name, req.file.mimetype, req.tenant?.s3Prefix);
    const doc = {
      filename,
      originalName: name,
      folders: [folder],
      folder,
      publicUrl: url,
      bucketKey: key,
      fileType: 'video',
      mimeType: req.file.mimetype,
      size: req.file.size,
      title: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      tags: ['trimmed'],
      trimmedFrom: { startTime: parseFloat(startTime) || 0, endTime: parseFloat(endTime) || 0 },
      uploadedAt: new Date(),
    };
    const r = await db.collection('assets').insertOne(doc);
    res.json({ success: true, asset: { ...doc, _id: r.insertedId } });
  } catch (err) {
    console.error('Trim upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/assets/:id — update metadata
router.put('/:id', async (req, res) => {
  try {
    const db = req.db;
    const { title, tags, folders, folder, clientId } = req.body;
    const $set = { updatedAt: new Date() };
    if (title !== undefined) $set.title = title;
    // Support `folders` array or legacy `folder` string
    if (folders !== undefined) {
      const arr = Array.isArray(folders) ? folders : folders.split(',').map(f => f.trim()).filter(Boolean);
      $set.folders = arr.length ? arr : ['general'];
      $set.folder = $set.folders[0]; // legacy compat
    } else if (folder !== undefined) {
      $set.folder = folder;
      $set.folders = [folder];
    }
    if (clientId !== undefined) $set.clientId = clientId || null;
    if (tags !== undefined) {
      $set.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    await db.collection('assets').updateOne({ _id: new ObjectId(req.params.id) }, { $set });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/social-upload — upload a generated social media image
router.post('/social-upload', assetMem.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const { folder = 'clients', title, preset, clientId } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'S3 storage not configured' });
    }
    if (req.tenant && await wouldExceedQuota(db, req.tenant, req.file.size || 0)) {
      return res.status(413).json({ error: `Storage limit reached (${getQuotaLabel(req.tenant)}). Delete files or upgrade.`, code: 'STORAGE_QUOTA_EXCEEDED' });
    }

    const name = title ? `${title.replace(/\s+/g, '-')}-${preset || 'social'}.png` : req.file.originalname;
    const { key, url, filename } = await uploadToLinode(req.file.buffer, folder, name, 'image/png', req.tenant?.s3Prefix);
    const doc = {
      filename,
      originalName: name,
      folders: [folder],
      folder,
      clientId: clientId || null,
      publicUrl: url,
      bucketKey: key,
      fileType: 'image',
      mimeType: 'image/png',
      size: req.file.size,
      title: title || name.replace(/\.[^.]+$/, ''),
      tags: ['social', preset || 'generated'].filter(Boolean),
      generatedFrom: { preset, createdAt: new Date() },
      uploadedAt: new Date(),
    };
    const r = await db.collection('assets').insertOne(doc);
    res.json({ success: true, asset: { ...doc, _id: r.insertedId } });
  } catch (err) {
    console.error('Social upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/bulk-delete — delete multiple assets
router.post('/bulk-delete', async (req, res) => {
  try {
    const db = req.db;
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

    const objectIds = ids.map(id => new ObjectId(id));
    const assets = await db.collection('assets').find({ _id: { $in: objectIds } }).toArray();

    // Delete from S3
    for (const asset of assets) {
      if (asset.bucketKey && config.LINODE_KEY) {
        try {
          await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: asset.bucketKey }));
        } catch (s3Err) {
          console.warn('S3 bulk delete warning:', s3Err.message);
        }
      }
    }

    await db.collection('assets').deleteMany({ _id: { $in: objectIds } });
    res.json({ success: true, deleted: assets.length });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/bulk-move — move multiple assets to a folder/client
router.post('/bulk-move', async (req, res) => {
  try {
    const db = req.db;
    const { ids, folder, folders, clientId } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

    const objectIds = ids.map(id => new ObjectId(id));
    const $set = { updatedAt: new Date() };
    if (folders && Array.isArray(folders) && folders.length) {
      $set.folders = folders;
      $set.folder = folders[0];
    } else if (folder) {
      $set.folder = folder;
      $set.folders = [folder];
    }
    if (clientId !== undefined) $set.clientId = clientId || null;

    await db.collection('assets').updateMany({ _id: { $in: objectIds } }, { $set });
    res.json({ success: true, updated: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/:id
router.delete('/:id', async (req, res) => {
  try {
    const db = req.db;
    const asset = await db.collection('assets').findOne({ _id: new ObjectId(req.params.id) });
    if (!asset) return res.status(404).json({ error: 'Not found' });

    if (asset.bucketKey && config.LINODE_KEY) {
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: asset.bucketKey }));
      } catch (s3Err) {
        console.warn('S3 delete warning:', s3Err.message);
      }
    }

    await db.collection('assets').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error('Asset delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── SHARE / API ──

// POST /admin/assets/:id/share — generate a public share token
router.post('/:id/share', async (req, res) => {
  try {
    const db = req.db;
    const asset = await db.collection('assets').findOne({ _id: new ObjectId(req.params.id) });
    if (!asset) return res.status(404).json({ error: 'Not found' });
    // If already shared, return existing token
    if (asset.shareToken) return res.json({ success: true, shareToken: asset.shareToken, shareUrl: `/assets/share/${asset.shareToken}` });
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await db.collection('assets').updateOne({ _id: asset._id }, { $set: { shareToken: token, sharedAt: new Date() } });
    res.json({ success: true, shareToken: token, shareUrl: `/assets/share/${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/assets/:id/share — revoke share
router.delete('/:id/share', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('assets').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $unset: { shareToken: '', sharedAt: '' } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
