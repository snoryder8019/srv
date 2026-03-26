import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALG = 'aes-256-gcm';

function getKey() {
  const hex = process.env.MASTER_KEY;
  if (!hex || hex.length !== 64) throw new Error('MASTER_KEY must be a 64-char hex string (32 bytes)');
  return Buffer.from(hex, 'hex');
}

export function encrypt(text) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

export function decrypt(blob) {
  const key = getKey();
  const [ivHex, encHex, tagHex] = blob.split(':');
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(encHex, 'hex', 'utf8') + decipher.final('utf8');
}
