/**
 * GLTF asset upload endpoint.
 * Accepts .gltf/.glb, validates size and extension, stores in /uploads.
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../../../config/index.js';

const router = express.Router();

if (!fs.existsSync(config.paths.uploads)) {
  fs.mkdirSync(config.paths.uploads, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.paths.uploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = path.basename(file.originalname, ext)
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();
    const stamp = Date.now();
    cb(null, `${safeName}_${stamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxSizeMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (config.upload.allowedExt.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type. Allowed: ${config.upload.allowedExt.join(', ')}`));
  },
});

router.post('/gltf', upload.single('model'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded (field name: model)' });
  }
  const url = `/assets/gltf/uploads/${req.file.filename}`;
  res.status(201).json({
    success: true,
    url,
    filename: req.file.filename,
    sizeBytes: req.file.size,
  });
});

export default router;
