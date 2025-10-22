/**
 * Multer configuration for file uploads
 */
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads/assets');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: userId_timestamp_fieldname_originalname
    const userId = req.user?._id || 'anon';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    const sanitized = basename.replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${userId}_${timestamp}_${file.fieldname}_${sanitized}${ext}`);
  }
});

// File filter - only allow images
const fileFilter = function (req, file, cb) {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
  }
};

// Multer configuration
export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

// Field configuration for asset uploads
export const assetUploadFields = upload.fields([
  { name: 'pixelArt', maxCount: 1 },
  { name: 'fullscreen', maxCount: 1 },
  { name: 'indexCard', maxCount: 1 }
]);

export default {
  upload,
  assetUploadFields
};
