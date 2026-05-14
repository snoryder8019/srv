const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const FRAMES_DIR = path.join(__dirname, '..', 'data', 'frames');
const FRAMES_URL_PREFIX = '/frames';

try { fs.mkdirSync(FRAMES_DIR, { recursive: true }); } catch (_) {}

const MIN_BYTES = 1024;          // sanity floor — anything smaller isn't a real JPEG
const MAX_BYTES = 5 * 1024 * 1024;

// Persist a base64 (or data URL) frame to disk, deduped by SHA-256.
// Returns { frameSha256, frameUrl, frameBytes } or null on bad input.
function saveFrameBase64(base64OrDataUrl) {
  if (!base64OrDataUrl || typeof base64OrDataUrl !== 'string') return null;
  const cleaned = base64OrDataUrl.replace(/^data:[^,]+,/, '');
  let buf;
  try { buf = Buffer.from(cleaned, 'base64'); }
  catch { return null; }
  if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;

  const frameSha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const filePath    = path.join(FRAMES_DIR, `${frameSha256}.jpg`);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, buf);
  }
  return {
    frameSha256,
    frameUrl:   `${FRAMES_URL_PREFIX}/${frameSha256}.jpg`,
    frameBytes: buf.length
  };
}

function frameExists(sha256) {
  if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) return false;
  return fs.existsSync(path.join(FRAMES_DIR, `${sha256}.jpg`));
}

function frameDirStats() {
  try {
    const files = fs.readdirSync(FRAMES_DIR).filter(f => /^[a-f0-9]{64}\.jpg$/.test(f));
    let bytes = 0;
    files.forEach(f => { try { bytes += fs.statSync(path.join(FRAMES_DIR, f)).size; } catch (_) {} });
    return { count: files.length, bytes };
  } catch (_) { return { count: 0, bytes: 0 }; }
}

module.exports = { saveFrameBase64, frameExists, frameDirStats, FRAMES_DIR, FRAMES_URL_PREFIX };
