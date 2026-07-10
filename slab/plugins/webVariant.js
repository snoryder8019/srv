/**
 * Web-optimized image variants ("internet-safe" front-end images).
 *
 * Front-end tenant pages should never serve a multi-MB PNG straight from the
 * asset library. On upload (and via backfill) we generate a WebP variant that
 * is capped in dimension and byte size, stored under a sibling `web/` prefix and
 * referenced via `webUrl` on the asset doc. The full-resolution original
 * (`publicUrl`) is untouched — the editor, downloads and re-editing still use it.
 *
 * Uses `sharp` (added as a dependency for this — node-canvas can't encode WebP).
 * Videos, SVGs and animated GIFs return null (caller keeps the original).
 */
import sharp from 'sharp';

export const WEB_MAX_EDGE = 1600;      // longest edge in px for front-end delivery
export const WEB_MAX_BYTES = 1024 * 1024; // hard ceiling — "smaller than a meg"
export const WEB_QUALITY_LADDER = [82, 74, 66, 58, 50, 42]; // step down until under the ceiling

// Mime types we deliberately pass through untouched (keep the original URL).
const SKIP_MIME = /^image\/svg\+xml$/i;

/**
 * Generate a WebP web variant from an image buffer.
 * Downscales to WEB_MAX_EDGE longest-edge, then walks the quality ladder until
 * the encoded buffer is under WEB_MAX_BYTES (or the ladder bottoms out).
 *
 * @param {Buffer} buffer  raw source image bytes
 * @param {object} [opts]
 * @param {string} [opts.mimeType]  source mime — used to skip vector/animated
 * @returns {Promise<{buffer: Buffer, contentType: string, width: number, height: number} | null>}
 *          null when the source can't/shouldn't be converted (SVG, animated, decode failure).
 */
export async function generateWebVariant(buffer, { mimeType = '' } = {}) {
  if (SKIP_MIME.test(mimeType)) return null;

  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    return null; // not a raster image sharp can decode
  }
  if (!meta.width || !meta.height) return null;
  // Animated images (multi-frame GIF/WebP) — leave the original alone rather
  // than flatten to a single frame.
  if (meta.pages && meta.pages > 1) return null;

  const base = sharp(buffer, { failOn: 'none' })
    .rotate() // honour EXIF orientation before we drop the metadata
    .resize({
      width: WEB_MAX_EDGE,
      height: WEB_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });

  let out = null;
  for (const quality of WEB_QUALITY_LADDER) {
    out = await base.clone().webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (out.data.length <= WEB_MAX_BYTES) break;
  }
  if (!out) return null;

  return {
    buffer: out.data,
    contentType: 'image/webp',
    width: out.info.width,
    height: out.info.height,
  };
}

/**
 * Derive the web-variant S3 key from an asset's original bucket key.
 * `prefix/assets/folder/123-abc-name.png` → `prefix/assets/folder/web/123-abc-name.png.webp`
 */
export function deriveWebKey(bucketKey) {
  const idx = bucketKey.lastIndexOf('/');
  const dir = bucketKey.slice(0, idx);
  const name = bucketKey.slice(idx + 1);
  return `${dir}/web/${name}.webp`;
}
