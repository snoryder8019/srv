import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../config/config.js';

export const BUCKET = config.LINODE_BUCKET; // 'madladslab'
export const DIR_PREFIX = 'w2marketing';   // all files live under w2marketing/ in the bucket

export const s3Client = new S3Client({
  endpoint: config.LINODE_ENDPOINT,        // https://us-ord-1.linodeobjects.com
  region: config.LINODE_REGION,            // us-ord-1
  credentials: {
    accessKeyId: config.LINODE_KEY,
    secretAccessKey: config.LINODE_SECRET,
  },
  forcePathStyle: false,
});

// Public URL: https://madladslab.us-ord-1.linodeobjects.com/w2marketing/portfolio/xxx.jpg
export function bucketUrl(key) {
  return `https://${BUCKET}.${config.LINODE_REGION}.linodeobjects.com/${key}`;
}
