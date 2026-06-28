import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/config.js';

export const BUCKET = config.LINODE_BUCKET; // 'madladslab'
// DIR_PREFIX removed — now comes from req.tenant.s3Prefix per tenant

export const s3Client = new S3Client({
  endpoint: config.LINODE_ENDPOINT,        // https://us-ord-1.linodeobjects.com
  region: config.LINODE_REGION,            // us-ord-1
  credentials: {
    accessKeyId: config.LINODE_KEY,
    secretAccessKey: config.LINODE_SECRET,
  },
  forcePathStyle: config.S3_FORCE_PATH_STYLE, // true for MinIO, false for Linode
});

// Public URL for a stored object. With CDN_BASE set (MinIO cutover) this is
// https://cdn.madladslab.com/{key}; otherwise the legacy Linode virtual-host URL.
// Keys are identical across both, so this is a pure host swap.
export function bucketUrl(key) {
  if (config.CDN_BASE) return `${config.CDN_BASE.replace(/\/$/, '')}/${key}`;
  return `https://${BUCKET}.${config.LINODE_REGION}.linodeobjects.com/${key}`;
}

// Sanitize a filename into a safe S3 key segment.
function safeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
}

// Generic public upload of an arbitrary buffer (images, video, etc.).
// Returns { key, url }. Caller supplies the tenant s3Prefix, a folder, the
// original filename (for extension/readability) and the content type.
export async function uploadBuffer(buffer, { prefix, folder = 'uploads', name, contentType } = {}) {
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${prefix || 'default'}/${folder}/${Date.now()}-${rand}-${safeName(name)}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer,
    ContentType: contentType || 'application/octet-stream', ACL: 'public-read',
  }), { abortSignal: AbortSignal.timeout(180000) });
  return { key, url: bucketUrl(key) };
}
