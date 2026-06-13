/**
 * siege-kit/token.js
 * ------------------
 * SERVER-ONLY. Signs/verifies an InstanceDescriptor so it can travel through the
 * browser as an opaque, tamper-proof token on the launch URL. Mirrors the
 * platform SSO bridge: HMAC-SHA256 with the shared BRIDGE_SECRET, short TTL.
 *
 * Why a token (not plain query params): the descriptor encodes loadout location,
 * pacing, board seed and rewards. If those rode as readable params a player
 * could forge an easier board or a richer salvage. Signing pins it to the world
 * server that issued it. The secret is never sent to a browser.
 *
 * Token format (compact, no external JWT dep):
 *   base64url(JSON(payload)) + "." + base64url(HMAC_SHA256(body, secret))
 * payload = { d: <descriptor>, exp: <ms epoch> }
 */
import crypto from 'node:crypto';

const DEFAULT_TTL_MS = 5 * 60 * 1000;   // 5 minutes, like the SSO bridge

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJSON(obj) { return b64url(JSON.stringify(obj)); }
function fromB64url(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(body, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(body).digest());
}

/**
 * Sign a descriptor. Returns the opaque token string.
 * @param {object} descriptor  output of descriptor.buildDescriptor
 * @param {string} secret      BRIDGE_SECRET
 * @param {number} [ttlMs]
 */
export function signDescriptor(descriptor, secret, ttlMs = DEFAULT_TTL_MS) {
  if (!secret) throw new Error('siege token: missing secret');
  const payload = { d: descriptor, exp: Date.now() + ttlMs };
  const body = b64urlJSON(payload);
  return `${body}.${hmac(body, secret)}`;
}

/**
 * Verify + parse a token. Returns { ok, descriptor?, error? }. Constant-time
 * signature compare; rejects on bad signature or expiry.
 */
export function verifyDescriptor(token, secret) {
  if (!secret) return { ok: false, error: 'missing secret' };
  if (!token || typeof token !== 'string' || !token.includes('.')) return { ok: false, error: 'malformed token' };
  const [body, sig] = token.split('.', 2);
  const expected = hmac(body, secret);
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'bad signature' };
  let payload;
  try { payload = JSON.parse(fromB64url(body).toString('utf8')); }
  catch { return { ok: false, error: 'bad payload' }; }
  if (!payload || typeof payload.exp !== 'number') return { ok: false, error: 'bad payload' };
  if (Date.now() > payload.exp) return { ok: false, error: 'expired' };
  return { ok: true, descriptor: payload.d };
}

export default { signDescriptor, verifyDescriptor };
