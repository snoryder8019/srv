/**
 * Platform SSO (games.madladslab.com is the identity provider).
 * Implements WEBGAMES_PROTOCOL §3:
 *   GET /auth/platform           -> 302 to platform /auth/bridge?redirect=<callback>
 *   GET /auth/platform/callback  -> verify 5-min HS256 JWT (BRIDGE_SECRET),
 *                                   upsert local Profile by platformId, set session.
 *   GET /auth/logout
 * Dev fallback (development only):
 *   GET /auth/dev                -> a throwaway guest session so the map is reachable
 *                                   before the origin is whitelisted on the platform.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { dbReady } from '../services/db.js';
import Profile from '../models/Profile.js';

const router = express.Router();

function resolveAdmin(payload, slug) {
  return payload?.isAdmin === true
    || payload?.permissions?.games === 'admin'
    || payload?.permissions?.[slug] === 'admin';
}

// Kick off SSO: bounce to the platform bridge with our callback.
router.get('/platform', (req, res) => {
  const cb = config.publicUrl + '/auth/platform/callback';
  res.redirect(config.platform.url + '/auth/bridge?redirect=' + encodeURIComponent(cb));
});

// Bridge returns here with ?token=<jwt>.
router.get('/platform/callback', async (req, res) => {
  const { token } = req.query;
  if (!token || !config.platform.bridgeSecret) return res.redirect('/?auth=failed');

  let payload;
  try {
    payload = jwt.verify(String(token), config.platform.bridgeSecret); // HS256, exp enforced
  } catch (e) {
    console.warn('[platform-sso] token verify failed:', e.message);
    return res.redirect('/?auth=failed');
  }

  const slug = config.platform.slug;
  const isAdmin = resolveAdmin(payload, slug);
  const sessionUser = {
    platformId: String(payload.id),
    displayName: payload.displayName || 'wanderer',
    isAdmin: payload.isAdmin === true,
    permissions: payload.permissions || {},
    canAdmin: isAdmin,
  };

  // Mirror to local profile (best-effort; identity of record stays on platform).
  if (dbReady()) {
    try {
      await Profile.findOneAndUpdate(
        { platformId: sessionUser.platformId },
        { $set: {
            displayName: sessionUser.displayName,
            isAdmin: sessionUser.isAdmin,
            permissions: sessionUser.permissions,
            lastLoginAt: new Date(),
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (e) { console.warn('[platform-sso] profile upsert failed:', e.message); }
  }

  req.session.user = sessionUser;
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Dev-only guest login so the bones are reachable pre-whitelist ---
router.get('/dev', (req, res) => {
  if (config.env === 'production') return res.status(404).end();
  req.session.user = {
    platformId: 'dev-' + Math.random().toString(36).slice(2, 8),
    displayName: 'dev-wanderer',
    isAdmin: true,
    permissions: { madlands: 'admin' },
    canAdmin: true,
  };
  res.redirect('/');
});

export default router;
