const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.LINODE_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.LINODE_ACCESS,
    secretAccessKey: process.env.LINODE_SECRET
  },
  forcePathStyle: false,
  // Disable checksum headers — Linode Object Storage doesn't support them
  // and will abort the TLS connection when present (AWS SDK v3.500+)
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
});

const imageUpload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.LINODE_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const name = `greealitytv/images/${Date.now()}-${path.basename(file.originalname).replace(/\s+/g, '-')}`;
      cb(null, name);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Images only (jpg, png, gif, webp)'));
  }
});

const videoUpload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.LINODE_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const name = `greealitytv/videos/${Date.now()}-${path.basename(file.originalname).replace(/\s+/g, '-')}`;
      cb(null, name);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowed = /mp4|mov|avi|webm|mkv/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (ext) return cb(null, true);
    cb(new Error('Video files only (mp4, mov, avi, webm, mkv)'));
  }
});

// For video upload page: handles both video + thumbnail fields together
const videoFields = multer({
  storage: multerS3({
    s3,
    bucket: process.env.LINODE_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const folder = file.fieldname === 'video' ? 'videos' : 'thumbnails';
      const name = `greealitytv/${folder}/${Date.now()}-${path.basename(file.originalname).replace(/\s+/g, '-')}`;
      cb(null, name);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

module.exports = { imageUpload, videoUpload, videoFields };
