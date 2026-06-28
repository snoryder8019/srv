// ─────────────────────────────────────────────────────────────────────────────
// Styled QR renderer — turns a URL into a branded/artistic QR PNG using the
// module matrix from `qrcode` + node-canvas. No extra deps.
//
// Supports: module shapes (square | dots | rounded), solid or gradient fill,
// a center logo (forces error-correction H), and a "phantom" mode that melts
// the code into a background image at low contrast (still scannable — a QR
// needs real contrast, so phantom is subtle-arty, not truly invisible).
//
// Finder patterns (the 3 corner eyes) are always drawn solid so dotted/rounded
// styles stay reliably scannable.
// ─────────────────────────────────────────────────────────────────────────────
import QRCode from 'qrcode';
import { createCanvas, loadImage } from 'canvas';

export const QR_MODULES = ['square', 'dots', 'rounded'];

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function isFinder(r, c, n) {
  return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
}

function drawCover(ctx, img, size) {
  const ir = img.width / img.height;
  let w = size, h = size, x = 0, y = 0;
  if (ir > 1) { w = size * ir; x = -(w - size) / 2; } else { h = size / ir; y = -(h - size) / 2; }
  ctx.drawImage(img, x, y, w, h);
}

/**
 * @param {string} text  URL/data to encode
 * @param {object} style { module, fill:'solid'|'gradient', color1, color2,
 *                         gradientType:'linear'|'radial', bg:'transparent'|'color',
 *                         bgColor, logo:bool, phantom:bool, bgImageUrl, contrast(0.35..0.85) }
 * @param {object} opts  { size, margin, logoUrl, transparent, ec }
 * @returns {Promise<Buffer>} PNG
 */
export async function renderStyledQR(text, style = {}, opts = {}) {
  const size = opts.size || 600;
  const quiet = opts.margin != null ? opts.margin : 4;
  const ec = (style.logo || style.phantom) ? 'H' : (opts.ec || 'M');

  const qr = QRCode.create(text || 'https://', { errorCorrectionLevel: ec });
  const n = qr.modules.size, data = qr.modules.data;
  const dim = n + quiet * 2;
  const cell = size / dim;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const c1 = style.color1 || '#000000';
  const c2 = style.color2 || c1;
  let fill = c1;
  if (style.fill === 'gradient') {
    fill = style.gradientType === 'radial'
      ? ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.72)
      : ctx.createLinearGradient(0, 0, size, size);
    fill.addColorStop(0, c1); fill.addColorStop(1, c2);
  }

  // ── background ──
  const phantom = !!style.phantom && !!style.bgImageUrl;
  const contrast = Math.min(0.85, Math.max(0.35, style.contrast != null ? style.contrast : 0.6));
  if (phantom) {
    try {
      const img = await loadImage(style.bgImageUrl);
      drawCover(ctx, img, size);
    } catch { ctx.fillStyle = style.bgColor || '#ffffff'; ctx.fillRect(0, 0, size, size); }
    // wash the image lighter so the (semi-transparent) modules still read
    ctx.fillStyle = `rgba(255,255,255,${1 - contrast})`;
    ctx.fillRect(0, 0, size, size);
  } else if (style.bg === 'color') {
    ctx.fillStyle = style.bgColor || '#ffffff'; ctx.fillRect(0, 0, size, size);
  } else if (!opts.transparent) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  }

  // ── modules ──
  ctx.fillStyle = fill;
  ctx.globalAlpha = opts.alpha != null ? opts.alpha : (phantom ? Math.max(0.55, contrast) : 1); // keep some opacity for scanning
  const shape = QR_MODULES.includes(style.module) ? style.module : 'square';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!data[r * n + c]) continue;
      const x = (c + quiet) * cell, y = (r + quiet) * cell;
      if (shape === 'square' || isFinder(r, c, n)) {
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cell), Math.ceil(cell));
      } else if (shape === 'dots') {
        ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.42, 0, Math.PI * 2); ctx.fill();
      } else { // rounded
        roundRect(ctx, x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.32); ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // ── center logo ──
  if (style.logo && opts.logoUrl) {
    try {
      const img = await loadImage(opts.logoUrl);
      const lw = size * 0.22, lx = (size - lw) / 2, ly = (size - lw) / 2;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, lx - size * 0.018, ly - size * 0.018, lw + size * 0.036, lw + size * 0.036, size * 0.03);
      ctx.fill();
      ctx.drawImage(img, lx, ly, lw, lw);
    } catch { /* logo failed — skip */ }
  }

  return canvas.toBuffer('image/png');
}

export async function renderStyledQRDataUrl(text, style = {}, opts = {}) {
  const buf = await renderStyledQR(text, style, opts);
  return 'data:image/png;base64,' + buf.toString('base64');
}

// Coerce arbitrary input (form/query) into a safe style object.
export function normalizeQRStyle(s = {}) {
  const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : d);
  return {
    module: QR_MODULES.includes(s.module) ? s.module : 'square',
    fill: s.fill === 'gradient' ? 'gradient' : 'solid',
    color1: hex(s.color1, ''),
    color2: hex(s.color2, ''),
    gradientType: s.gradientType === 'radial' ? 'radial' : 'linear',
    bg: s.bg === 'color' ? 'color' : 'transparent',
    bgColor: hex(s.bgColor, '#ffffff'),
    logo: s.logo === true || s.logo === 'true' || s.logo === '1' || s.logo === 'on',
    phantom: s.phantom === true || s.phantom === 'true' || s.phantom === '1' || s.phantom === 'on',
    bgImageUrl: (typeof s.bgImageUrl === 'string' && /^https?:\/\//.test(s.bgImageUrl) && s.bgImageUrl.length < 600) ? s.bgImageUrl : '',
    contrast: s.contrast != null && !Number.isNaN(parseFloat(s.contrast)) ? Math.min(0.85, Math.max(0.35, parseFloat(s.contrast))) : 0.6,
  };
}
