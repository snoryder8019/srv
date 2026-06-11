/**
 * Thumbnail generation for asset images.
 *
 * Uses the `canvas` package (already a slab dependency — no new install) to
 * downscale raster images to a small JPEG suitable for grid display. Originals
 * (full-resolution `publicUrl`) are untouched; thumbnails are stored under a
 * sibling `thumbs/` prefix and referenced via `thumbUrl` on the asset doc.
 *
 * Videos and vector/SVG assets return null (caller falls back to the original).
 */
import { createCanvas, loadImage } from 'canvas';

export const THUMB_MAX = 320; // longest-edge px
export const THUMB_QUALITY = 0.72;

/**
 * Generate a downscaled JPEG thumbnail from an image buffer.
 * @returns {Promise<{buffer: Buffer, contentType: string, width: number, height: number} | null>}
 *          null when the buffer can't be rasterised (e.g. SVG without librsvg, corrupt file).
 */
export async function generateThumbnail(buffer, { max = THUMB_MAX, quality = THUMB_QUALITY } = {}) {
  let img;
  try {
    img = await loadImage(buffer);
  } catch {
    return null; // not a raster image canvas can decode
  }
  if (!img.width || !img.height) return null;

  const ratio = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  // Flatten any transparency onto white so the JPEG matches the card background.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  return { buffer: canvas.toBuffer('image/jpeg', { quality }), contentType: 'image/jpeg', width: w, height: h };
}

/**
 * Derive the thumbnail S3 key from an asset's original bucket key.
 * `prefix/assets/folder/123-abc-name.png` → `prefix/assets/folder/thumbs/123-abc-name.png.jpg`
 */
export function deriveThumbKey(bucketKey) {
  const idx = bucketKey.lastIndexOf('/');
  const dir = bucketKey.slice(0, idx);
  const name = bucketKey.slice(idx + 1);
  return `${dir}/thumbs/${name}.jpg`;
}
