// /admin/assets/drive — Google Drive import.
//
// Connect flow lives in routes/auth.js (/auth/google/drive*) because its callback
// must land on the shared platform domain, outside the /admin auth guard. These
// endpoints run on the tenant domain (req.tenant + req.db available) and cover:
//   GET  /drive/status        → is Drive connected, and as whom
//   GET  /drive/list          → browse the tenant's Drive images/folders
//   GET  /drive/thumb/:id      → proxy a Drive thumbnail (needs the OAuth token)
//   POST /drive/import        → pull selected files through the normal asset pipeline
//   POST /drive/disconnect    → forget the stored refresh token
//
// Imported files flow through the SAME path as a browser upload (uploadToLinode →
// tryThumb → tryWebVariant → assets insert), so they behave identically everywhere.
import express from 'express';
import { config } from '../../../config/config.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { bustTenantCache } from '../../../middleware/tenant.js';
import { wouldExceedQuota, getQuotaLabel } from '../../../plugins/storage.js';
import {
  getDriveAccessToken, clearDriveAccessToken,
  listDriveImages, downloadDriveFile, fetchDriveThumbnail,
} from '../../../plugins/googleDrive.js';
import { uploadToLinode, tryThumb, tryWebVariant } from './shared.js';

const router = express.Router();

// Resolve the tenant's Drive OAuth context. resolveTenant already decrypted the
// stored refresh token into req.tenant.secrets.
function driveOAuth(req) {
  return {
    clientId: config.GGLCID,
    clientSecret: config.GGLSEC,
    refreshToken: req.tenant?.secrets?.googleDriveRefreshToken || null,
  };
}

// GET /admin/assets/drive/status
router.get('/drive/status', (req, res) => {
  const oauth = driveOAuth(req);
  res.json({
    connected: !!oauth.refreshToken,
    email: req.tenant?.public?.googleDriveUser || null,
    configured: !!(config.GGLCID && config.GGLSEC),
  });
});

// GET /admin/assets/drive/list?folderId=&search=&pageToken=
router.get('/drive/list', async (req, res) => {
  try {
    const oauth = driveOAuth(req);
    if (!oauth.refreshToken) return res.status(409).json({ error: 'Google Drive not connected', code: 'NOT_CONNECTED' });
    const token = await getDriveAccessToken(oauth);
    const { folderId, search, pageToken } = req.query;
    const out = await listDriveImages(token, {
      folderId: folderId || undefined,
      search: (search || '').trim() || undefined,
      pageToken: pageToken || undefined,
    });
    res.json(out);
  } catch (err) {
    console.error('[drive/list] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/assets/drive/thumb/:id — proxy a Drive thumbnail
router.get('/drive/thumb/:id', async (req, res) => {
  try {
    const oauth = driveOAuth(req);
    if (!oauth.refreshToken) return res.status(409).end();
    const token = await getDriveAccessToken(oauth);
    const thumb = await fetchDriveThumbnail(token, req.params.id);
    if (!thumb) return res.status(404).end();
    res.setHeader('Content-Type', thumb.contentType);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(thumb.buffer);
  } catch (err) {
    res.status(500).end();
  }
});

// POST /admin/assets/drive/import — { fileIds:[], folders?, folder?, clientId? }
router.post('/drive/import', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const oauth = driveOAuth(req);
    if (!oauth.refreshToken) return res.status(409).json({ error: 'Google Drive not connected', code: 'NOT_CONNECTED' });
    if (!config.LINODE_KEY || !config.LINODE_SECRET) {
      return res.status(500).json({ error: 'Object storage not configured' });
    }

    const fileIds = Array.isArray(req.body.fileIds) ? req.body.fileIds.filter(Boolean) : [];
    if (!fileIds.length) return res.status(400).json({ error: 'No files selected' });
    if (fileIds.length > 50) return res.status(400).json({ error: 'Import up to 50 files at a time' });

    let folders = req.body.folders;
    if (folders && typeof folders === 'string') folders = folders.split(',').map(f => f.trim()).filter(Boolean);
    if (!folders?.length) folders = [req.body.folder || 'general'];
    const folder = folders[0];
    const clientId = req.body.clientId || null;

    const token = await getDriveAccessToken(oauth);
    const imported = [];
    const errors = [];

    for (const fileId of fileIds) {
      try {
        const { buffer, mimeType, name } = await downloadDriveFile(token, fileId);
        if (!mimeType.startsWith('image/')) {
          errors.push({ fileId, name, error: 'Not an image' });
          continue;
        }
        if (req.tenant && await wouldExceedQuota(db, req.tenant, buffer.length)) {
          errors.push({ fileId, name, error: `Storage limit reached (${getQuotaLabel(req.tenant)})` });
          break; // no point continuing once full
        }
        const { key, url, filename } = await uploadToLinode(buffer, folder, name, mimeType, req.tenant?.s3Prefix);
        const { thumbUrl = null, thumbKey = null } = await tryThumb(buffer, key);
        const { webUrl = null, webKey = null, webSize = null } = await tryWebVariant(buffer, key, mimeType);
        const doc = {
          filename,
          originalName: name,
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
          title: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          tags: [],
          source: 'google-drive',
          driveFileId: fileId,
          uploadedAt: new Date(),
        };
        const r = await db.collection('assets').insertOne(doc);
        imported.push({ ...doc, _id: r.insertedId });
      } catch (e) {
        errors.push({ fileId, error: e.message });
      }
    }

    res.json({ success: true, imported, errors, importedCount: imported.length });
  } catch (err) {
    console.error('[drive/import] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/assets/drive/disconnect — forget the stored refresh token
router.post('/drive/disconnect', express.json(), async (req, res) => {
  try {
    const oauth = driveOAuth(req);
    const tenant = req.tenant;
    const canonicalDomain = tenant?.wildcardDomain || tenant?.domain;
    await getSlabDb().collection('tenants').updateOne(
      { db: tenant?.db },
      {
        $unset: { 'secrets.googleDriveRefreshToken': '', 'public.googleDriveUser': '', 'public.googleDriveConnectedAt': '' },
        $set: { updatedAt: new Date() },
      }
    );
    if (oauth.refreshToken) clearDriveAccessToken(oauth.refreshToken);
    for (const d of [canonicalDomain, tenant?.domain, tenant?.customDomain, tenant?.meta?.customDomain, req.hostname]) if (d) bustTenantCache(d);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
