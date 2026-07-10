import multer from 'multer';
import multerS3 from 'multer-s3';
import { s3Client, BUCKET, bucketUrl } from '../plugins/s3.js';
import { config } from '../config/config.js';
import { wouldExceedQuota, formatBytes, getQuotaLabel } from '../plugins/storage.js';

// multer-s3 sets `file.location` to the raw S3 endpoint URL. On MinIO
// (path-style, internal endpoint) that is e.g. http://winhost:9000/madladslab/<key>
// — an internal host that must never reach the browser. Rewrite `.location` to
// the public CDN URL (bucketUrl(key)) so every consumer that persists
// `req.file.location` stores the correct https://cdn.<host>/<key> form.
function normalizeUploadLocations(req) {
  const fix = (f) => { if (f && f.key) f.location = bucketUrl(f.key); };
  if (req.file) fix(req.file);
  const fs = req.files;
  if (Array.isArray(fs)) fs.forEach(fix);
  else if (fs && typeof fs === 'object') {
    for (const k in fs) if (Array.isArray(fs[k])) fs[k].forEach(fix);
  }
}

// Wrap a multer instance so its file-producing methods run
// normalizeUploadLocations after the upload completes. Returns plain middleware
// (drop-in — same call signature the routes already use).
function withLocationFix(m) {
  const wrap = (name) => (...args) => {
    const mw = m[name](...args);
    return (req, res, next) => mw(req, res, (err) => {
      if (err) return next(err);
      try { normalizeUploadLocations(req); } catch (e) { /* non-fatal */ }
      next();
    });
  };
  return { single: wrap('single'), array: wrap('array'), fields: wrap('fields'), any: wrap('any'), none: (...a) => m.none(...a) };
}

/**
 * Middleware: check storage quota before upload.
 * Attach after tenant resolution. Use before any multer middleware.
 * `estimateBytes` can be a number or a function(req) → number.
 */
export function checkStorageQuota(estimateBytes = 20 * 1024 * 1024) {
  return async (req, res, next) => {
    if (!req.db || !req.tenant) return next();
    try {
      const size = typeof estimateBytes === 'function' ? estimateBytes(req) : estimateBytes;
      const exceeded = await wouldExceedQuota(req.db, req.tenant, size);
      if (exceeded) {
        const label = getQuotaLabel(req.tenant);
        return res.status(413).json({
          error: `Storage limit reached (${label}). Delete files or upgrade your plan for more space.`,
          code: 'STORAGE_QUOTA_EXCEEDED',
        });
      }
      next();
    } catch (err) {
      console.error('[storage-check] Error:', err.message);
      next(); // fail open — don't block uploads on aggregation errors
    }
  };
}

const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Images only'), false);
};

const anyFileFilter = (req, file, cb) => cb(null, true);

function s3Storage(subdir, filter = anyFileFilter) {
  if (!config.LINODE_KEY || !config.LINODE_SECRET || !config.LINODE_BUCKET) {
    // S3 not configured — memory storage fallback
    return withLocationFix(multer({ storage: multer.memoryStorage(), fileFilter: filter, limits: { fileSize: 20 * 1024 * 1024 } }));
  }
  return withLocationFix(multer({
    storage: multerS3({
      s3: s3Client,
      bucket: BUCKET,
      acl: 'public-read',
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => {
        const prefix = req.tenant?.s3Prefix || 'default';
        const ts = Date.now();
        const safe = file.originalname.replace(/\s+/g, '_');
        cb(null, `${prefix}/${subdir}/${ts}-${safe}`);
      },
    }),
    fileFilter: filter,
    limits: { fileSize: 20 * 1024 * 1024 },
  }));
}

export const portfolioUpload = s3Storage('portfolio', imageFilter);
export const clientFileUpload = s3Storage('clients');
export const sectionUpload = s3Storage('sections', imageFilter);
export const meetingAssetUpload = s3Storage('meetings');
export const brandUpload = s3Storage('brand', imageFilter);

// Large-file uploader for meeting recordings (webm/mp4). Limit 500 MB.
function s3LargeStorage(subdir, maxBytes) {
  if (!config.LINODE_KEY || !config.LINODE_SECRET || !config.LINODE_BUCKET) {
    return withLocationFix(multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } }));
  }
  return withLocationFix(multer({
    storage: multerS3({
      s3: s3Client,
      bucket: BUCKET,
      acl: 'public-read',
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => {
        const prefix = req.tenant?.s3Prefix || 'default';
        const ts = Date.now();
        const safe = file.originalname.replace(/\s+/g, '_');
        cb(null, `${prefix}/${subdir}/${ts}-${safe}`);
      },
    }),
    limits: { fileSize: maxBytes },
  }));
}

export const meetingRecordingUpload = s3LargeStorage('meeting-recordings', 500 * 1024 * 1024);

const modelFilter = (req, file, cb) => {
  const allowed = [
    'model/gltf-binary', 'model/gltf+json',
    'application/octet-stream', 'application/json',
  ];
  const ext = file.originalname.toLowerCase();
  if (allowed.includes(file.mimetype) || ext.endsWith('.glb') || ext.endsWith('.gltf'))
    cb(null, true);
  else cb(new Error('Only .glb or .gltf files allowed'), false);
};

export const modelUpload = s3Storage('models', modelFilter);
export const ticketUpload = s3Storage('tickets');
