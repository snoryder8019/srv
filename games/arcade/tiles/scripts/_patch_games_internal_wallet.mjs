/**
 * Wire the wallet into games/routes/internal.js:
 *   - require lib/wallet
 *   - award chips on every recorded arcade result (inside /webgame/score)
 *   - add internal endpoints tiles uses to spend/settle real chips:
 *       POST /internal/wallet/get      { platformId, displayName }
 *       POST /internal/wallet/debit    { platformId, amount, game, meta }
 *       POST /internal/wallet/credit   { platformId, amount, reason, game, meta }
 *       POST /internal/wallet/settle   { platformId, wager, payout, game, meta }
 *       POST /internal/wallet/grant    { platformId, amount, reason, meta }  (server presence etc.)
 * Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/games/routes/internal.js';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes("require('../lib/wallet')")) { console.log('already wired'); process.exit(0); }

// 1) require wallet near the other libs
s = s.replace(
  "const windrose = require('../lib/windrose');",
  "const windrose = require('../lib/windrose');\nconst wallet = require('../lib/wallet');"
);

// 2) award chips on a recorded result — right after the leaderboard upsert block
const anchor = `      { upsert: true }
    );
    if (event === 'game-end') {`;
const withAward = `      { upsert: true }
    );
    // Chip economy: every recorded arcade result earns chips (participation + win bonus).
    try { await wallet.awardArcadeResult(db, { platformId, displayName, status, game }); } catch (we) { /* best-effort */ }
    if (event === 'game-end') {`;
if (s.split(anchor).length - 1 !== 1) throw new Error('score-ingest anchor not unique');
s = s.replace(anchor, withAward);

// 3) add the internal wallet endpoints just before module.exports
const endpoints = `
// ───────────────────────── Chip wallet (service-to-service) ─────────────────────────
// tiles' casino games call these with the shared bridge secret to spend/settle
// real chips. All amounts are integers; debit fails (ok:false) on insufficient funds.
router.post('/wallet/get', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, displayName } = req.body || {};
    if (!platformId) return res.status(400).json({ error: 'platformId required' });
    const w = await wallet.getWallet(db, platformId, displayName);
    res.json({ ok: true, chips: w.chips, biggestBetWon: w.biggestBetWon || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/wallet/debit', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, amount, game, meta, displayName } = req.body || {};
    if (!platformId) return res.status(400).json({ error: 'platformId required' });
    const r = await wallet.debit(db, platformId, amount, 'wager', game, meta, displayName);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/wallet/credit', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, amount, reason, game, meta, displayName } = req.body || {};
    if (!platformId) return res.status(400).json({ error: 'platformId required' });
    const r = await wallet.credit(db, platformId, amount, reason || 'credit', game, meta, displayName);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/wallet/settle', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, wager, payout, game, meta, displayName } = req.body || {};
    if (!platformId) return res.status(400).json({ error: 'platformId required' });
    const r = await wallet.settleBet(db, platformId, { wager, payout, game, meta, displayName });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generic grant — dedicated-server presence, daily bonuses, admin gifts, etc.
router.post('/wallet/grant', requireInternal, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { platformId, amount, reason, meta, displayName } = req.body || {};
    if (!platformId || !amount) return res.status(400).json({ error: 'platformId and amount required' });
    const r = await wallet.credit(db, platformId, amount, reason || 'grant', null, meta, displayName);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;`;

s = s.replace(/module\.exports = router;\s*$/, endpoints);

fs.writeFileSync(FILE, s);
console.log('internal.js: wallet wired (award hook + 5 endpoints)');
