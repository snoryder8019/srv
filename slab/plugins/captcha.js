// Self-hosted proof-of-work CAPTCHA — an open-source, privacy-friendly
// alternative to reCAPTCHA/hCaptcha for public, non-authenticated forms.
//
// No external service, no API keys, no third-party JS, no tracking cookies.
// The protocol is wire-compatible with ALTCHA (https://altcha.org): the browser
// is handed a signed challenge and must brute-force a small number whose
// SHA-256 hash matches — cheap for one honest submitter (<1s), expensive at the
// scale a spam bot operates. Because the challenge is HMAC-signed and carries
// its own expiry, verification needs no server-side session state; a small
// in-memory replay guard blocks a solved token from being submitted twice.
//
//   GET  /captcha/challenge   → issue a fresh challenge (called by the widget)
//   verifyCaptcha(payload)    → validate a solution in a form POST handler
//
// Client widget: public/js/captcha.js (auto-wires any <form data-captcha>).

import crypto from 'crypto';
import express from 'express';
import { config } from '../config/config.js';

const ALGORITHM = 'SHA-256';
// Average work is maxNumber/2 hashes. 100k keeps an honest solve well under a
// second on any modern device while still costing a bot real CPU per attempt.
const MAX_NUMBER = 100000;
const TTL_MS = 10 * 60 * 1000; // a challenge is solvable for 10 minutes

// HMAC key. Prefer a dedicated secret; fall back to the session secret so the
// feature works out of the box without new env wiring.
const SECRET = process.env.SLAB_CAPTCHA_SECRET || config.SESHSEC || 'dev_captcha_secret';

const sha256Hex = (str) => crypto.createHash('sha256').update(str).digest('hex');
const hmacHex = (str) => crypto.createHmac('sha256', SECRET).update(str).digest('hex');

// ── Replay guard ─────────────────────────────────────────────────────────────
// One honest challenge → one accepted submission. Solved signatures are held
// (with their expiry) until they age out; a bounded sweep keeps the map small.
const consumed = new Map(); // signature → expiresAt(ms)
function markConsumed(signature, expiresAt) {
  consumed.set(signature, expiresAt);
  if (consumed.size > 5000) {
    const now = Date.now();
    for (const [sig, exp] of consumed) if (exp < now) consumed.delete(sig);
  }
}
function alreadyConsumed(signature) {
  const exp = consumed.get(signature);
  if (exp == null) return false;
  if (exp < Date.now()) { consumed.delete(signature); return false; }
  return true;
}

// ── Challenge ────────────────────────────────────────────────────────────────
/**
 * Build a fresh, self-verifying challenge. The salt embeds an expiry so the
 * server can reject stale solutions without storing anything.
 */
export function generateChallenge() {
  const expires = Date.now() + TTL_MS;
  const salt = `${crypto.randomBytes(12).toString('hex')}.${expires}`;
  const number = crypto.randomInt(0, MAX_NUMBER + 1);
  const challenge = sha256Hex(salt + number);
  const signature = hmacHex(challenge);
  return { algorithm: ALGORITHM, challenge, salt, maxnumber: MAX_NUMBER, signature };
}

function parseExpiry(salt) {
  const n = Number(String(salt).split('.').pop());
  return Number.isFinite(n) ? n : 0;
}

// ── Verification ─────────────────────────────────────────────────────────────
/**
 * Validate a solution produced by the widget (base64 of the ALTCHA payload).
 * Stateless except for the single-use replay guard.
 * @returns {{ok:boolean, reason?:string}}
 */
export function verifyCaptcha(payload) {
  if (!payload || typeof payload !== 'string') return { ok: false, reason: 'missing' };

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const { algorithm, challenge, number, salt, signature } = data || {};
  if (algorithm !== ALGORITHM || !challenge || !salt || !signature) {
    return { ok: false, reason: 'incomplete' };
  }
  if (!Number.isInteger(number) || number < 0 || number > MAX_NUMBER) {
    return { ok: false, reason: 'bad-number' };
  }
  if (parseExpiry(salt) < Date.now()) return { ok: false, reason: 'expired' };

  // The signature must be one we issued (HMAC over the challenge hash)…
  const expectedSig = hmacHex(challenge);
  if (!timingSafeEqualHex(signature, expectedSig)) return { ok: false, reason: 'bad-signature' };

  // …and the number must actually solve the challenge.
  if (sha256Hex(salt + number) !== challenge) return { ok: false, reason: 'unsolved' };

  if (alreadyConsumed(signature)) return { ok: false, reason: 'replay' };
  markConsumed(signature, parseExpiry(salt));

  return { ok: true };
}

// Append a query param to a relative URL, keeping any #fragment last so the
// browser still parses the query (…/?k=v#frag, never …/#frag?k=v).
function withQuery(url, key, value) {
  const hashAt = url.indexOf('#');
  const frag = hashAt === -1 ? '' : url.slice(hashAt);
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}${frag}`;
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Express-style guard for form POST handlers. Reads the solution from the
 * `captcha` field (or `altcha`, for widget compatibility). On failure, returns
 * false after redirecting/responding, so callers can `if (!passedCaptcha(...)) return;`.
 * @returns {boolean} true when the request may proceed
 */
export function passedCaptcha(req, res, { redirectTo } = {}) {
  const payload = req.body?.captcha || req.body?.altcha || '';
  const result = verifyCaptcha(payload);
  if (result.ok) return true;

  const wantsJson = (req.get('accept') || '').includes('application/json')
    || req.xhr || req.get('x-requested-with') === 'XMLHttpRequest';
  if (wantsJson) {
    res.status(400).json({ ok: false, error: 'captcha', message: 'Please complete the verification and try again.' });
  } else {
    res.redirect(withQuery(redirectTo || '/', 'captcha', 'fail'));
  }
  return false;
}

// ── Router ───────────────────────────────────────────────────────────────────
export const captchaRouter = express.Router();
captchaRouter.get('/challenge', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(generateChallenge());
});

export default captchaRouter;
