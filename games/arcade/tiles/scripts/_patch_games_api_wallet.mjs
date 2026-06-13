/**
 * Public wallet read API in games/routes/api.js:
 *   GET /api/wallet/me                         -> { ok, chips, biggestBetWon, ... }  (auth)
 *   GET /api/wallet/leaderboard?kind=chips|bet  -> { ok, kind, leaderboard:[...] }   (public)
 * Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/games/routes/api.js';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes("require('../lib/wallet')")) { console.log('already wired'); process.exit(0); }

// require wallet near the top libs
s = s.replace(
  "const windrose = require('../lib/windrose');",
  "const windrose = require('../lib/windrose');\nconst wallet = require('../lib/wallet');"
);

// add routes before module.exports
const routes = `
// ───────────────────────── Chip wallet (public reads) ─────────────────────────
// The player's own balance (used by the portal + arcade chip pill).
router.get('/wallet/me', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const pid = String(req.user._id);
    const name = req.user.displayName || req.user.username || null;
    const w = await wallet.getWallet(db, pid, name);
    res.json({ ok: true, chips: w.chips, biggestBetWon: w.biggestBetWon || 0,
      biggestBetGame: w.biggestBetGame || null, totalWagered: w.totalWagered || 0, totalWon: w.totalWon || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Chip leaderboards: kind=chips (richest) or kind=bet (largest single bet won).
router.get('/wallet/leaderboard', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const kind = req.query.kind === 'bet' ? 'bet' : 'chips';
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const leaderboard = await wallet.leaderboard(db, kind, limit);
    res.json({ ok: true, kind, leaderboard });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;`;

s = s.replace(/module\.exports = router;\s*$/, routes);
fs.writeFileSync(FILE, s);
console.log('api.js: wallet read endpoints added');
