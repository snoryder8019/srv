/**
 * Platform SSO consumer — games.madladslab.com is the identity provider.
 * Mirrors the proven Towers (/srv/td/routes/auth.js) flow:
 *
 *   GET /auth/platform          -> bounce to the platform bridge
 *   GET /auth/platform/callback -> verify the 5-min JWT, establish a session
 *   GET /auth/me                -> JSON of the current session user (or null)
 *   POST /auth/logout           -> clear session
 *
 * The cards platform does not mint identity. It trusts the bridge token and
 * carries the player by platformId. (Local persistence — a per-platform cards
 * profile/DB — is added with the lobby; the shell keeps identity in session.)
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

const router = express.Router();

router.get('/platform', (req, res) => {
  const cb = config.publicUrl + '/auth/platform/callback';
  res.redirect(config.platform.url + '/auth/bridge?redirect=' + encodeURIComponent(cb));
});

router.get('/platform/callback', (req, res) => {
  const token = req.query.token;
  if (!token || !config.platform.bridgeSecret) return res.redirect('/?auth=failed');
  let payload;
  try {
    payload = jwt.verify(token, config.platform.bridgeSecret);
  } catch (e) {
    console.warn('[platform-sso] token verify failed:', e.message);
    return res.redirect('/?auth=failed');
  }
  const perms = payload.permissions || {};
  req.session.user = {
    platformId: String(payload.id),
    email: payload.email,
    displayName: payload.displayName || (payload.email || 'Player').split('@')[0],
    isAdmin: payload.isAdmin === true || perms.games === 'admin' || perms.cards === 'admin',
    permissions: perms,
  };
  // `next` lets the arcade/matchmaking deep-link straight into a table later.
  const next = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/';
  res.redirect(next);
});

router.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

export default router;
