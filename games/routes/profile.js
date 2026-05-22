'use strict';

/**
 * Profile — lets a logged-in user set their public username and link a
 * Steam ID. The username replaces displayName/email anywhere player-facing;
 * the Steam ID is used to gate chat posting and to swap in-game player names
 * for the user's portal username in activity feeds.
 *
 * Names from the underlying user document (displayName, firstName, email)
 * are NEVER returned to the browser — only `username`, `handle`, `steamId`.
 */

const express = require('express');
const username = require('../lib/username');
const router = express.Router();

const STEAM_ID_RE = /^7656119\d{10}$/;

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.accepts('html')) return res.redirect('/login?next=/profile');
  res.status(401).json({ error: 'Login required' });
}

function publicUser(u) {
  if (!u) return null;
  return {
    username: u.username || null,
    handle: u._id ? require('../lib/broadcasts').anonHandle(u._id.toString()) : null,
    steamId: u.steamId || null,
    role: u.isAdmin ? 'superadmin' : (u.permissions && u.permissions.games) || 'player',
    createdAt: u.createdAt || null,
  };
}

router.get('/', requireAuth, (req, res) => {
  if (req.accepts('html')) return res.sendFile('profile.html', { root: __dirname + '/../public' });
  res.json({ profile: publicUser(req.user) });
});

router.get('/api/me', requireAuth, (req, res) => {
  res.json({ profile: publicUser(req.user) });
});

router.post('/api/username', requireAuth, async (req, res) => {
  try {
    const result = await username.setForUser(req.app.locals.db, req.user._id, req.body?.username);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, username: result.username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/steamid', requireAuth, async (req, res) => {
  try {
    const raw = String(req.body?.steamId || '').trim();
    // Empty string clears the linkage — users may want to detach.
    if (!raw) {
      await req.app.locals.db.collection('users').updateOne(
        { _id: req.user._id }, { $unset: { steamId: '' } }
      );
      return res.json({ ok: true, steamId: null });
    }
    if (!STEAM_ID_RE.test(raw)) {
      return res.status(400).json({ error: 'Expected a 17-digit Steam ID starting with 7656119…' });
    }
    // Soft-uniqueness check — surface a friendly error instead of an index
    // collision if another portal user already linked this Steam ID. We
    // don't enforce a unique index since legacy users might collide and
    // require manual resolution; the check happens here at write time.
    const clash = await req.app.locals.db.collection('users').findOne(
      { steamId: raw, _id: { $ne: req.user._id } },
      { projection: { _id: 1 } }
    );
    if (clash) return res.status(409).json({ error: 'That Steam ID is already linked to another account' });
    await req.app.locals.db.collection('users').updateOne(
      { _id: req.user._id }, { $set: { steamId: raw } }
    );
    res.json({ ok: true, steamId: raw });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
