const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { ObjectId } = require('mongodb');
const announcements = require('../lib/announcements');
const ollamaAgent = require('../lib/ollama-agent');
const ollamaSd = require('../lib/ollama-sd');
const newsletter = require('../lib/newsletter');
const assets = require('../lib/assets');
const username = require('../lib/username');

// ── Game visibility (admin toggle to hide titles from public dashboard/landing) ──
// Persisted to disk so toggles survive process restarts. Keys are game ids
// (rust, valheim, ...); a truthy value means the title is hidden from the
// public-facing dashboard and landing slideshow. Admins still see everything
// on /admin so they can flip the toggle back on.
const HIDDEN_GAMES_FILE = path.join(__dirname, '..', 'hidden-games.json');
const _hiddenGames = {};
(function _loadHiddenGames() {
  try {
    if (!fs.existsSync(HIDDEN_GAMES_FILE)) return;
    const data = JSON.parse(fs.readFileSync(HIDDEN_GAMES_FILE, 'utf8'));
    if (data && typeof data === 'object') {
      for (const [g, v] of Object.entries(data)) if (v) _hiddenGames[g] = true;
    }
  } catch (e) {
    console.error('[admin] Failed to load hidden-games state:', e.message);
  }
})();
function _saveHiddenGames() {
  try { fs.writeFileSync(HIDDEN_GAMES_FILE, JSON.stringify(_hiddenGames), 'utf8'); }
  catch (e) { console.error('[admin] Failed to persist hidden-games:', e.message); }
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const u = req.user;
  const gp = u.permissions && u.permissions['games'];
  if (u.isAdmin || gp === 'admin') return next();
  res.status(403).send('Forbidden');
}

function requireSuperAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  if (req.user.isAdmin !== true) return res.status(403).json({ error: 'Superadmin only' });
  next();
}

// Serve admin panel HTML
router.get('/', requireAuth, requireAdmin, (req, res) => {
  res.sendFile('admin.html', { root: __dirname + '/../public' });
});

// --- Games users ---
router.get('/api/games/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const users = await db.collection('users')
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/games/users/:id', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { isAdmin, permissions } = req.body;
    // Superadmin cannot be granted via admin panel
    if (isAdmin === true) {
      return res.status(403).json({ error: 'Superadmin is reserved — cannot be granted via admin panel' });
    }
    // Prevent modifying your own superadmin status
    if (req.params.id === req.user._id.toString()) {
      return res.status(403).json({ error: 'Cannot modify your own superadmin status' });
    }
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isAdmin: false, permissions: permissions || {} } }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: full user management ──
router.put('/api/games/users/:id/subscription', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { subscription, subscriptionExpiry } = req.body;
    const allowed = ['free', 'player', 'admin', 'lifetime'];
    if (!allowed.includes(subscription)) {
      return res.status(400).json({ error: 'Invalid subscription: ' + allowed.join(', ') });
    }
    const update = { subscription };
    if (subscription === 'lifetime') {
      update.subscriptionExpiry = null;
    } else if (subscriptionExpiry) {
      update.subscriptionExpiry = new Date(subscriptionExpiry);
    }
    // Auto-set permissions based on subscription
    if (subscription === 'admin') {
      update['permissions.games'] = 'admin';
    }
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/games/users/:id/role', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { isAdmin, isBroadcaster, permissions, premium } = req.body;
    const update = {};

    // Superadmin is reserved for a singular user — only the current superadmin
    // can grant/revoke it, and cannot revoke their own
    if (isAdmin !== undefined) {
      if (isAdmin === true) {
        // Never allow granting superadmin to another user via API
        return res.status(403).json({ error: 'Superadmin is reserved — cannot be granted via admin panel' });
      }
      // Allow revoking superadmin (but not your own)
      if (req.params.id === req.user._id.toString()) {
        return res.status(403).json({ error: 'Cannot modify your own superadmin status' });
      }
      update.isAdmin = false;
    }
    if (isBroadcaster !== undefined) update.isBroadcaster = !!isBroadcaster;
    if (permissions !== undefined) update.permissions = permissions;
    // Premium flag grants the user "no queue" priority — skipping the free-
    // tier wait when both local game slots are taken. Future Stripe checkout
    // will set this automatically; today it's a manual admin toggle.
    if (premium !== undefined) update.premium = !!premium;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: moderation status (suspend / ban / flag) ──
// Three distinct states because they serve different purposes:
//   - flagged:   internal-only marker, no behavior change, used to surface
//                problem users for review without affecting access.
//   - suspended: time-bounded login lockout (suspendedUntil). User can log in
//                again once the timestamp passes.
//   - banned:    indefinite lockout. requireAuth passport-deserialize check
//                rejects the session immediately on next request.
router.put('/api/games/users/:id/status', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (req.params.id === req.user._id.toString()) {
      return res.status(403).json({ error: 'Cannot modify your own status' });
    }
    const { suspended, banned, flagged, statusReason, suspendedUntil } = req.body;
    const update = {};
    if (suspended !== undefined) update.suspended = !!suspended;
    if (banned !== undefined) update.banned = !!banned;
    if (flagged !== undefined) update.flagged = !!flagged;
    if (statusReason !== undefined) update.statusReason = String(statusReason || '').slice(0, 500);
    if (suspendedUntil !== undefined) {
      update.suspendedUntil = suspendedUntil ? new Date(suspendedUntil) : null;
    }
    update.statusUpdatedAt = new Date();
    update.statusUpdatedBy = req.user.email || req.user._id.toString();

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );

    // If the user just got banned, nuke their active sessions so they're
    // kicked from the open tab on the next request (deserializeUser will
    // also reject them, but this drops sockets faster).
    if (banned === true) {
      try {
        await db.collection('sessions').deleteMany({
          session: { $regex: req.params.id }
        });
      } catch (e) { /* best-effort */ }
    }
    console.log('[admin] user status', req.params.id, update, 'by', req.user.email);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Superadmin: trigger maintenance notification ──
// Body: { minutes, message? } — message overrides the default heads-up text.
router.post('/api/maintenance', requireSuperAdmin, (req, res) => {
  const { minutes, message: customMessage } = req.body;
  const mins = Math.min(parseInt(minutes) || 5, 30);
  const io = req.app.get('io');
  if (!io) return res.status(500).json({ error: 'Socket.IO not available' });

  const message = (customMessage && String(customMessage).trim())
    ? String(customMessage).trim().slice(0, 600)
    : 'The server is undergoing maintenance. You may notice odd behavior or disconnections. Thanks for your patience!';

  // Broadcast to ALL connected clients across all namespaces
  io.emit('maintenance:warning', { message, minutes: mins, ts: Date.now() });
  io.of('/broadcasts').emit('maintenance:warning', { message, minutes: mins, ts: Date.now() });
  io.of('/stats').emit('maintenance:warning', { message, minutes: mins, ts: Date.now() });

  console.log('[admin] Maintenance notification sent (' + mins + ' min countdown)');
  res.json({ ok: true, message: 'Maintenance notification sent to all clients' });
});

// ── Superadmin: AI communications composer ──
// Drafts copy for a landing-page announcement / help blurb / update notice
// via the madLadsLab Ollama endpoint. Does NOT publish — admin reviews the
// draft and posts via /announcements if it looks right.
router.post('/api/ai/compose', requireSuperAdmin, async (req, res) => {
  try {
    const { prompt, kind, tone, extraContext } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: 'prompt required' });
    }
    const result = await ollamaAgent.compose({ prompt, kind, tone, extraContext });
    res.json({ ok: true, text: result.text, model: result.model });
  } catch (e) {
    console.error('[admin] AI compose failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Announcements (landing page communications) ──
// GET is public so the landing page can render; mutations are superadmin.
router.get('/api/announcements', (req, res) => {
  const activeOnly = req.query.active === '1';
  res.json({ ok: true, announcements: announcements.list({ activeOnly }) });
});

router.post('/api/announcements', requireSuperAdmin, (req, res) => {
  try {
    const author = username.displayFor(req.user);
    const item = announcements.add({ ...(req.body || {}), author });
    res.json({ ok: true, announcement: item });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/api/announcements/:id', requireSuperAdmin, (req, res) => {
  const item = announcements.update(req.params.id, req.body || {});
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, announcement: item });
});

router.delete('/api/announcements/:id', requireSuperAdmin, (req, res) => {
  const ok = announcements.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── Admin: keep a server pinned online (override 1hr-idle auto-shutdown) ──
// minecraft is a planned public lifecycle game (in addition to the existing
// /private-servers paid flow) — keep-online will start working once its game
// lib is wired into server-manager.
const VALID_GAMES = ['rust', 'valheim', 'l4d2', '7dtd', 'se', 'palworld', 'windrose', 'minecraft'];

router.get('/api/keep-online', requireAuth, requireAdmin, (req, res) => {
  const sm = req.app.locals.serverManager;
  if (!sm) return res.status(500).json({ error: 'server-manager not available' });
  res.json({ ok: true, keepOnline: sm.getKeepOnlineMap() });
});

router.post('/api/keep-online/:game', requireAuth, requireAdmin, (req, res) => {
  const { game } = req.params;
  if (!VALID_GAMES.includes(game)) return res.status(400).json({ error: 'Invalid game' });
  const sm = req.app.locals.serverManager;
  if (!sm) return res.status(500).json({ error: 'server-manager not available' });
  const on = !!req.body.on;
  const result = sm.setKeepOnline(game, on);
  if (!result.ok) return res.status(400).json(result);
  console.log('[admin] keep-online', game, '=', result.keepOnline, 'by', req.user.email || req.user._id);
  res.json(result);
});

// ── Game visibility toggle ──
// Public GET so the dashboard + landing page can filter; admins gate the POST.
router.get('/api/hidden-games', (req, res) => {
  res.json({ ok: true, hidden: Object.keys(_hiddenGames) });
});

router.post('/api/hidden-games/:game', requireAuth, requireAdmin, (req, res) => {
  const { game } = req.params;
  if (!VALID_GAMES.includes(game)) return res.status(400).json({ error: 'Invalid game' });
  const hide = !!req.body.hidden;
  const before = !!_hiddenGames[game];
  if (hide) _hiddenGames[game] = true; else delete _hiddenGames[game];
  if (before !== hide) _saveHiddenGames();
  console.log('[admin] hidden-games', game, '=', hide, 'by', req.user.email || req.user._id);
  res.json({ ok: true, game, hidden: hide });
});

// ── SD image generation + asset library ──
// All routes superadmin-only because each gen call consumes GPU time on
// the lab box. The composer/newsletter UI calls /api/ai/sd-image to mint
// a thumbnail and (optionally) saves it via /api/assets.
router.post('/api/ai/sd-image', requireSuperAdmin, async (req, res) => {
  try {
    const { prompt, save, tags, size } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });
    const result = await ollamaSd.generate({ prompt, size });
    if (save) {
      const author = username.displayFor(req.user);
      const saved = await assets.saveSdImage({
        prompt, base64: result.base64, author,
        tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
        size: result.size,
      });
      return res.json({ ok: true, asset: saved, revisedPrompt: result.revisedPrompt });
    }
    res.json({ ok: true, base64: result.base64, revisedPrompt: result.revisedPrompt, size: result.size });
  } catch (e) {
    console.error('[admin] SD gen failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/assets', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { type, source, limit } = req.query;
    const items = await assets.list({ type, source, limit: parseInt(limit) || 60 });
    res.json({ ok: true, assets: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/assets/external', requireSuperAdmin, async (req, res) => {
  try {
    const author = username.displayFor(req.user);
    const item = await assets.registerExternal({ ...(req.body || {}), author });
    res.json({ ok: true, asset: item });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/api/assets/:id', requireSuperAdmin, async (req, res) => {
  try {
    const r = await assets.remove(req.params.id);
    if (!r.ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Newsletter admin (compose/draft/publish/reply) ──
// Drafts and replies use the same createDraft + publish pair; a reply is
// just a draft with parentId pointing at the root issue. The threaded
// public page renders root-first, replies inline.
router.get('/api/newsletter', requireAuth, requireAdmin, async (req, res) => {
  try {
    const threads = await newsletter.listThreads({ limit: 50, includeDrafts: true });
    const count = await newsletter.subscriberCount();
    res.json({ ok: true, threads, subscribers: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/newsletter/draft', requireSuperAdmin, async (req, res) => {
  try {
    const author = username.displayFor(req.user);
    const item = await newsletter.createDraft({ ...(req.body || {}), author });
    res.json({ ok: true, issue: item });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/api/newsletter/:id/publish', requireSuperAdmin, async (req, res) => {
  try {
    const item = await newsletter.publish(req.params.id);
    res.json({ ok: true, issue: item });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/api/newsletter/:id', requireSuperAdmin, async (req, res) => {
  try {
    const item = await newsletter.updateDraft(req.params.id, req.body || {});
    res.json({ ok: true, issue: item });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/api/newsletter/:id', requireSuperAdmin, async (req, res) => {
  try {
    await newsletter.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Newsletter AI draft (compose + optional SD thumbnail) ──
// Composes the issue body via ollama-agent, optionally generates a
// thumbnail with SD, and returns both for review. Admin still has to
// click "publish" — this only mints a draft.
router.post('/api/newsletter/ai-draft', requireSuperAdmin, async (req, res) => {
  try {
    const { prompt, kind = 'news', tone = 'info', subject = '', generateThumbnail = false, thumbnailPrompt = '' } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });
    const author = username.displayFor(req.user);

    const composed = await ollamaAgent.compose({ prompt, kind, tone });
    let thumb = null;
    if (generateThumbnail) {
      try {
        const tp = thumbnailPrompt && thumbnailPrompt.trim()
          ? thumbnailPrompt.trim()
          : `Cinematic key art for a gaming community newsletter about: ${prompt}. Retro-arcade neon vibe, dark moody palette, no text.`;
        const sd = await ollamaSd.generate({ prompt: tp });
        thumb = await assets.saveSdImage({ prompt: tp, base64: sd.base64, author, tags: ['newsletter', 'thumbnail'], size: sd.size });
      } catch (e) {
        console.error('[admin] newsletter thumbnail gen failed:', e.message);
        // Don't fail the whole draft if SD chokes — the admin can retry.
      }
    }
    const issue = await newsletter.createDraft({
      subject: subject && subject.trim() ? subject.trim() : 'Untitled — please rename',
      body: composed.text,
      kind, tone,
      thumbnailUrl: thumb ? thumb.url : null,
      author,
    });
    res.json({ ok: true, issue, thumbnail: thumb, model: composed.model });
  } catch (e) {
    console.error('[admin] newsletter ai-draft failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/newsletter/subscribers', requireSuperAdmin, async (req, res) => {
  try {
    const subs = await newsletter.listSubscribers({ limit: 500 });
    res.json({ ok: true, subscribers: subs, count: subs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manual resend (welcome did not arrive / went to spam). Targets an active
// subscriber by email; safe to call multiple times.
router.post('/api/newsletter/resend-welcome', requireSuperAdmin, async (req, res) => {
  try {
    const email = (req.body && req.body.email) || '';
    const result = await newsletter.resendWelcome(email);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SMTP health check — calls Zoho's VERIFY without sending mail. Useful when
// debugging "I didn't get the email" complaints.
router.get('/api/newsletter/smtp-check', requireSuperAdmin, async (req, res) => {
  try {
    const mailer = require('../lib/mailer');
    await mailer.verify();
    res.json({ ok: true, host: 'smtp.zoho.com', user: process.env.ZOHO_USER });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
