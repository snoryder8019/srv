import multer from 'multer';
import multerS3 from 'multer-s3';
import { s3Client, BUCKET } from '../plugins/s3.js';
import { config } from '../config/config.js';
import { wouldExceedQuota, formatBytes, getQuotaLabel } from '../plugins/storage.js';

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
    return multer({ storage: multer.memoryStorage(), fileFilter: filter, limits: { fileSize: 20 * 1024 * 1024 } });
  }
  return multer({
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
  });
}

export const portfolioUpload = s3Storage('portfolio', imageFilter);
export const clientFileUpload = s3Storage('clients');
export const sectionUpload = s3Storage('sections', imageFilter);
export const meetingAssetUpload = s3Storage('meetings');
export const brandUpload = s3Storage('brand', imageFilter);

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
