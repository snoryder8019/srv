// /admin/assets/photos — Google Photos import via the Picker API.
//
// Connect flow lives in routes/auth.js (/auth/google/photos*). Google no longer
// allows browsing a user's whole library, so picking happens on Google's own UI:
//   POST /photos/session            → create a picking session (returns pickerUri)
//   GET  /photos/session/:id         → poll until the user finishes (mediaItemsSet)
//   GET  /photos/session/:id/items   → list what they picked (+ thumbnail proxy URLs)
//   GET  /photos/session/:id/thumb/:itemId → proxy a picked item's thumbnail
//   POST /photos/import             → download picked images through the asset pipeline
//   GET  /photos/status  ·  POST /photos/disconnect
//
// Imported files flow through the SAME path as a browser upload (uploadToLinode →
// tryThumb → tryWebVariant → assets insert).
import express from 'express';
import { config } from '../../../config/config.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { bustTenantCache } from '../../../middleware/tenant.js';
import { wouldExceedQuota, getQuotaLabel } from '../../../plugins/storage.js';
import {
  getPhotosAccessToken, clearPhotosAccessToken,
  createPickerSession, getPickerSession, deletePickerSession,
  listPickedItems, downloadPickedBytes, fetchPickedThumb,
  cacheSessionItems, getCachedItem, dropSessionItems,
} from '../../../plugins/googlePhotos.js';
import { uploadToLinode, tryThumb, tryWebVariant } from './shared.js';

const router = express.Router();

// resolveTenant already decrypted the stored refresh token into req.tenant.secrets.
function photosOAuth(req) {
  return {
    clientId: config.GGLCID,
    clientSecret: config.GGLSEC,
    refreshToken: req.tenant?.secrets?.googlePhotosRefreshToken || null,
  };
}

// GET /admin/assets/photos/status
router.get('/photos/status', (req, res) => {
  const oauth = photosOAuth(req);
  res.json({
    connected: !!oauth.refreshToken,
    email: req.tenant?.public?.googlePhotosUser || null,
    configured: !!(config.GGLCID && config.GGLSEC),
  });
});

// POST /admin/assets/photos/session — start a picking session
router.post('/photos/session', express.json(), async (req, res) => {
  try {
    const oauth = photosOAuth(req);
    if (!oauth.refreshToken) return res.status(409).json({ error: 'Google Photos not connected', code: 'NOT_CONNECTED' });
    const token = await getPhotosAccessToken(oauth);
    const session = await createPickerSession(token, { maxItemCount: 50 });
    res.json(session);
  } catch (err) {
    console.error('[photos/session] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/photos/session/:id — poll
router.get('/photos/session/:id', async (req, res) => {
  try {
    const oauth = photosOAuth(req);
    if (!oauth.refreshToken) return res.status(409).json({ error: 'Google Photos not connected', code: 'NOT_CONNECTED' });
    const token = await getPhotosAccessToken(oauth);
    const s = await getPickerSession(token, req.params.id);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/photos/session/:id/items — list picked items (caches baseUrls)
router.get('/photos/session/:id/items', async (req, res) => {
  try {
    const oauth = photosOAuth(req);
    if (!oauth.refreshToken) return res.status(409).json({ error: 'Google Photos not connected', code: 'NOT_CONNECTED' });
    const token = await getPhotosAccessToken(oauth);
    const items = await listPickedItems(token, req.params.id);
    cacheSessionItems(req.params.id, items);
    // Never leak baseUrls to the client; expose a proxied thumb URL instead.
    const view = items.map(i => ({
      id: i.id, filename: i.filename, mimeType: i.mimeType, type: i.type,
      thumb: `/admin/assets/photos/session/${encodeURIComponent(req.params.id)}/thumb/${encodeURIComponent(i.id)}`,
      isImage: (i.mimeType || '').startsWith('image/'),
    }));
    res.json({ items: view });
  } catch (err) {
    console.error('[photos/items] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/photos/session/:id/thumb/:itemId — proxy a picked thumbnail
router.get('/photos/session/:id/thumb/:itemId', async (req, res) => {
  try {
    const oauth = photosOAuth(req);
    if (!oauth.refreshToken) return res.status(409).end();
    let item = getCachedItem(req.params.id, req.params.itemId);
    const token = await getPhotosAccessToken(oauth);
    if (!item) {
      // Cache miss (e.g. after a restart) — re-list to repopulate.
      const items = await listPickedItems(token, req.params.id);
      cacheSessionItems(req.params.id, items);
      item = items.find(i => i.id === req.params.itemId) || null;
    }
    if (!item) return res.status(404).end();
    const thumb = await fetchPickedThumb(token, item.baseUrl);
    if (!thumb) return res.status(404).end();
    res.setHeader('Content-Type', thumb.contentType);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(thumb.buffer);
  } catch (err) {
    res.status(500).end();
  }
});

// POST /admin/assets/photos/import — { sessionId, folder?, folders?, clientId? }
router.post('/photos/import', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const oauth = photosOAuth(req);
    if (!oauth.refreshToken) return res.status(409).json({ error: 'Google Photos not connected', code: 'NOT_CONNECTED' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) return res.status(500).json({ error: 'Object storage not configured' });

    const sessionId = req.body.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    let folders = req.body.folders;
    if (folders && typeof folders === 'string') folders = folders.split(',').map(f => f.trim()).filter(Boolean);
    if (!folders?.length) folders = [req.body.folder || 'general'];
    const folder = folders[0];
    const clientId = req.body.clientId || null;

    const token = await getPhotosAccessToken(oauth);
    // Re-list at import time for fresh, valid baseUrls.
    const items = await listPickedItems(token, sessionId);
    if (!items.length) return res.status(400).json({ error: 'No photos were picked' });

    const imported = [];
    const errors = [];
    for (const item of items) {
      try {
        if (!(item.mimeType || '').startsWith('image/')) {
          errors.push({ id: item.id, name: item.filename, error: 'Not an image (skipped)' });
          continue;
        }
        const { buffer, mimeType } = await downloadPickedBytes(token, item.baseUrl, item.mimeType);
        if (req.tenant && await wouldExceedQuota(db, req.tenant, buffer.length)) {
          errors.push({ id: item.id, name: item.filename, error: `Storage limit reached (${getQuotaLabel(req.tenant)})` });
          break;
        }
        const { key, url, filename } = await uploadToLinode(buffer, folder, item.filename, mimeType, req.tenant?.s3Prefix);
        const { thumbUrl = null, thumbKey = null } = await tryThumb(buffer, key);
        const { webUrl = null, webKey = null, webSize = null } = await tryWebVariant(buffer, key, mimeType);
        const doc = {
          filename,
          originalName: item.filename,
          folders,
          folder: folders[0],
          clientId,
          publicUrl: url,
          bucketKey: key,
          thumbUrl, thumbKey,
          webUrl, webKey, webSize,
          fileType: 'image',
          mimeType,
          size: buffer.length,
          title: item.filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          tags: [],
          source: 'google-photos',
          photosItemId: item.id,
          uploadedAt: new Date(),
        };
        const r = await db.collection('assets').insertOne(doc);
        imported.push({ ...doc, _id: r.insertedId });
      } catch (e) {
        errors.push({ id: item.id, name: item.filename, error: e.message });
      }
    }

    // Best-effort session cleanup.
    dropSessionItems(sessionId);
    deletePickerSession(token, sessionId).catch(() => {});

    res.json({ success: true, imported, errors, importedCount: imported.length });
  } catch (err) {
    console.error('[photos/import] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/photos/disconnect
router.post('/photos/disconnect', express.json(), async (req, res) => {
  try {
    const oauth = photosOAuth(req);
    const tenant = req.tenant;
    const canonicalDomain = tenant?.wildcardDomain || tenant?.domain;
    await getSlabDb().collection('tenants').updateOne(
      { db: tenant?.db },
      {
        $unset: { 'secrets.googlePhotosRefreshToken': '', 'public.googlePhotosUser': '', 'public.googlePhotosConnectedAt': '' },
        $set: { updatedAt: new Date() },
      }
    );
    if (oauth.refreshToken) clearPhotosAccessToken(oauth.refreshToken);
    for (const d of [canonicalDomain, tenant?.domain, tenant?.customDomain, tenant?.meta?.customDomain, req.hostname]) if (d) bustTenantCache(d);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
