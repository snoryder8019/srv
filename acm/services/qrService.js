/**
 * QR Code service — generates QR code URLs and promo codes.
 * Uses Google Charts API for QR image generation (no npm deps needed).
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3004';

function generatePromoCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getPromoUrl(code) {
  return BASE_URL + '/promo/' + code;
}

function getQRImageUrl(data, size) {
  size = size || 300;
  return 'https://chart.googleapis.com/chart?cht=qr&chs=' + size + 'x' + size + '&chl=' + encodeURIComponent(data) + '&chld=M|2';
}

function getPromoQRUrl(code, size) {
  return getQRImageUrl(getPromoUrl(code), size);
}

module.exports = { generatePromoCode, getPromoUrl, getQRImageUrl, getPromoQRUrl };
