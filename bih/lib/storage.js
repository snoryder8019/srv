const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');

const REGION = 'us-ord-1';
const BUCKET = process.env.LINODE_BUCKET;
const BIH_DIR = 'BIH';

function getClient() {
  return new S3Client({
    endpoint: `https://${REGION}.linodeobjects.com`,
    region: REGION,
    credentials: {
      accessKeyId: process.env.LINODE_ACCESS,
      secretAccessKey: process.env.LINODE_SECRET,
    },
  });
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml',
  };
  return types[ext] || 'application/octet-stream';
}

async function uploadAvatar(fileBuffer, originalFilename) {
  const ext = path.extname(originalFilename).toLowerCase();
  const unique = crypto.randomBytes(8).toString('hex');
  const filename = `${Date.now()}-${unique}${ext}`;
  const key = `${BIH_DIR}/avatars/${filename}`;

  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: fileBuffer,
    ACL: 'public-read',
    ContentType: getMimeType(originalFilename),
  }));

  return `https://${BUCKET}.${REGION}.linodeobjects.com/${key}`;
}

module.exports = { uploadAvatar };
