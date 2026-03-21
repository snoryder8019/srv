import multer from 'multer';
import multerS3 from 'multer-s3';
import { s3Client, BUCKET, DIR_PREFIX } from '../plugins/s3.js';
import { config } from '../config/config.js';

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
        const ts = Date.now();
        const safe = file.originalname.replace(/\s+/g, '_');
        // e.g. w2marketing/portfolio/1710000000000-logo.png
        cb(null, `${DIR_PREFIX}/${subdir}/${ts}-${safe}`);
      },
    }),
    fileFilter: filter,
    limits: { fileSize: 20 * 1024 * 1024 },
  });
}

export const portfolioUpload = s3Storage('portfolio', imageFilter);
export const clientFileUpload = s3Storage('clients');
export const sectionUpload = s3Storage('sections', imageFilter);
