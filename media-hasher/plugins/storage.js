// Linode Object Storage (S3-compatible). Used to host the Electron installer
// and to mint short-lived signed download URLs for license holders.
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/config.js';

export const BUCKET = config.LINODE_BUCKET;
export const PREFIX = config.LINODE_PREFIX;

export const s3 = new S3Client({
  endpoint: config.LINODE_ENDPOINT,
  region: config.LINODE_REGION,
  credentials: {
    accessKeyId: config.LINODE_KEY,
    secretAccessKey: config.LINODE_SECRET,
  },
  forcePathStyle: false,
});

/** List installer objects under the prefix (e.g. mediahasher/installers/). */
export async function listInstallers() {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX + '/' }));
  return (out.Contents || []).map(o => ({
    key: o.Key,
    size: o.Size,
    lastModified: o.LastModified,
  }));
}

/** Get a presigned download URL for a specific installer key. */
export async function presignInstaller(key, expiresInSeconds = 60 * 10) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}
