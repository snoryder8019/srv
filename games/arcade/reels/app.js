/**
 * Reels — skinnable slot machines for the MadLadsLab arcade.
 * Domain: reels.madladslab.com · Port 3740 · tmux: reels
 *
 * Identity comes from the platform SSO bridge (WEBGAMES_PROTOCOL.md §3);
 * chips live in the platform wallet; spins are server-authoritative
 * (lib/engine.js). Sessions are a signed JWT cookie — no local DB in v0.
 *
 * Bonus modes (see REELS_PROTOCOL.md §bonuses):
 *  - freespins: replay the triggering bet N times, win multiplier, retriggers stack
 *  - pick: interactive — prizes are shuffled and committed server-side at trigger
 *    time; further spins 409 until POST /api/bonus/pick resolves it
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const engine = require('./lib/engine');
const platform = require('./lib/platform');

const PORT = process.env.PORT || 3740;
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`;
const PLATFORM_PUBLIC = process.env.PLATFORM_PUBLIC || 'https://games.madladslab.com';
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const GAME_SLUG = 'reels';
const COOKIE = 'reels_session';

if (!BRIDGE_SECRET || !SESSION_SECRET) { console.error('[config] BRIDGE_SECRET / SESSION_SECRET required'); process.exit(1); }

engine.loadMachines();
console.log('[machines]', engine.listMachines().map(m => m.slug).join(', '));

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());
// index:false so `/` falls through to our route (3D scene), not the 2D index.html
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── In-memory play state (free spins, pending pick bonus, session tallies),
// keyed by platformId. Wallet/chips are platform-authoritative; losing this on
// restart only resets session counters and pending bonuses (acceptable v0).
const playState = new Map();
function stateFor(pid) {
  if (!playState.has(pid)) {
    playState.set(pid, { freeSpins: null, pendingPick: null, session: { wagered: 0, won: 0, perMachine: {} } });
  }
  return playState.get(pid);
}

// ── Session helpers ──
function setSession(res, payload) {
  const token = jwt.sign(payload, SESSION_SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: DOMAIN.startsWith('https'), maxAge: 12 * 3600 * 1000 });
}
function requireSession(req, res, next) {
  try {
    req.player = jwt.verify(req.cookies[COOKIE], SESSION_SECRET);
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: 'not signed in', loginUrl: '/auth/platform' });
  }
}

// ── SSO (platform is the identity provider) ──
app.get('/auth/platform', (req, res) => {
  const cb = DOMAIN.replace(/\/+$/, '') + '/auth/platform/callback';
  res.redirect(PLATFORM_PUBLIC + '/auth/bridge?redirect=' + encodeURIComponent(cb));
});

app.get('/auth/platform/callback', (req, res) => {
  try {
    const p = jwt.verify(String(req.query.token || ''), BRIDGE_SECRET, { algorithms: ['HS256'] });
    // Screen-name privacy: token displayName is already the public handle (§9.1).
    setSession(res, {
      platformId: String(p.id), displayName: p.displayName || 'Player',
      isAdmin: p.isAdmin === true || (p.permissions && (p.permissions.games === 'admin' || p.permissions[GAME_SLUG] === 'admin')),
    });
    var m = String(req.query.m || '').replace(/[^a-z0-9-]/gi, '');
    res.redirect(m ? '/?m=' + m : '/');
  } catch (e) {
    res.status(401).send('Sign-in token invalid or expired. <a href="/auth/platform">Try again</a>');
  }
});

app.post('/auth/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

// ── Health ──
app.get('/api/v1/health', (req, res) => res.json({ success: true, service: 'reels', version: require('./package.json').version, time: new Date().toISOString() }));

// ── Catalog + state ──
app.get('/api/machines', (req, res) => res.json({ ok: true, machines: engine.listMachines() }));

app.get('/api/state', requireSession, async (req, res) => {
  const slug = String(req.query.machine || 'classic-diamond');
  const m = engine.getMachine(slug);
  if (!m) return res.status(404).json({ ok: false, error: 'unknown machine' });
  let chips = null;
  try { const w = await platform.getWallet(req.player.platformId); chips = w.chips; } catch { /* wallet read best-effort */ }
  const st = stateFor(req.player.platformId);
  let shoe = null;
  if (m.collect) {
    let count = 0;
    try { const v = await platform.getState(req.player.platformId, m.collect.key + ':' + slug); count = Number(v) || 0; } catch (e) {}
    shoe = { count, fill: m.collect.fill, label: m.collect.label };
  }
  res.json({
    ok: true,
    player: { displayName: req.player.displayName },
    machine: engine.publicMachine(m),
    chips,
    freeSpins: fsView(st),
    pendingPick: pickView(st),
    shoe,
    session: sessionView(st, slug),
  });
});

function sessionView(st, slug) {
  const pm = st.session.perMachine[slug] || { wagered: 0, won: 0 };
  return {
    machine: { wagered: pm.wagered, won: pm.won },
    total: { wagered: st.session.wagered, won: st.session.won },
  };
}
function fsView(st) {
  return st.freeSpins ? { remaining: st.freeSpins.remaining, multiplier: st.freeSpins.multiplier, label: st.freeSpins.label } : null;
}
function pickView(st) {
  return st.pendingPick ? { label: st.pendingPick.label, options: st.pendingPick.prizes.length, bet: st.pendingPick.bet } : null;
}

// ── Spin (server-authoritative) ──
app.post('/api/spin', requireSession, async (req, res) => {
  const pid = req.player.platformId;
  const slug = String(req.body.machine || 'classic-diamond');
  const m = engine.getMachine(slug);
  if (!m) return res.status(404).json({ ok: false, error: 'unknown machine' });

  const st = stateFor(pid);
  if (st.pendingPick) {
    return res.status(409).json({ ok: false, error: 'bonus in progress — make your pick', code: 'BONUS_PENDING', pendingPick: pickView(st) });
  }

  let denom, betLevel, lines, winMultiplier = 1, isFree = false;

  if (st.freeSpins && st.freeSpins.remaining > 0 && st.freeSpins.machine === slug) {
    // Free spins replay the triggering bet; no debit.
    ({ denom, betLevel, lines } = st.freeSpins.bet);
    winMultiplier = st.freeSpins.multiplier || 1;
    isFree = true;
  } else {
    denom = Number(req.body.denom); betLevel = Number(req.body.betLevel); lines = Number(req.body.lines);
    if (!engine.validBet(m, { denom, betLevel, lines })) return res.status(400).json({ ok: false, error: 'invalid bet' });
  }

  const bet = denom * betLevel * lines;

  if (!isFree) {
    try {
      await platform.debit(pid, bet, GAME_SLUG, { machine: slug, denom, betLevel, lines });
    } catch (e) {
      if (e.code === 'INSUFFICIENT') return res.status(402).json({ ok: false, error: 'not enough chips', code: 'INSUFFICIENT' });
      return res.status(502).json({ ok: false, error: 'wallet unavailable, spin not taken' });
    }
  }

  const result = engine.evaluateSpin(m, { denom, betLevel, lines, winMultiplier });

  // Bonus triggers.
  let bonusAwarded = null;
  for (const b of result.bonuses) {
    if (b.type === 'freespins') {
      if (!st.freeSpins || st.freeSpins.machine !== slug) {
        st.freeSpins = { machine: slug, remaining: 0, multiplier: b.multiplier, bet: { denom, betLevel, lines }, label: b.label };
      }
      st.freeSpins.remaining += b.spins;
      bonusAwarded = { type: 'freespins', spins: b.spins, multiplier: b.multiplier, label: b.label };
    } else if (b.type === 'pick') {
      // Commit the shuffled prize layout NOW (crypto shuffle) so the reveal is honest.
      const prizes = b.prizes.slice();
      for (let i = prizes.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [prizes[i], prizes[j]] = [prizes[j], prizes[i]];
      }
      st.pendingPick = { machine: slug, bet, prizes, label: b.label, createdAt: Date.now() };
      bonusAwarded = { type: 'pick', label: b.label, options: prizes.length };
    }
  }
  if (isFree) {
    st.freeSpins.remaining -= 1;
    if (st.freeSpins.remaining <= 0 && !(bonusAwarded && bonusAwarded.type === 'freespins')) st.freeSpins = null;
  }

  // ── Dealer Shoe: persistent Joker collection (machine.collect). Each joker on
  // the board banks a card; filling the shoe triggers a pick bonus. Stored durably
  // via the platform gamestate KV so progress survives restarts/sessions forever.
  let shoe = null;
  if (m.collect && !st.pendingPick) {
    const jokers = engine.countInWindow(result.window, m.collect.symbol);
    let count = 0;
    try { const v = await platform.getState(pid, m.collect.key + ':' + slug); count = Number(v) || 0; } catch (e) { count = (st._shoeCache && st._shoeCache[slug]) || 0; }
    count += jokers;
    let shoeBonus = null;
    if (count >= m.collect.fill) {
      count -= m.collect.fill;                 // carry remainder
      // trigger the shoe's pick bonus (only if not already in one)
      if (!st.pendingPick && m.collect.bonus) {
        const prizes = m.collect.bonus.prizes.slice();
        for (let i = prizes.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [prizes[i], prizes[j]] = [prizes[j], prizes[i]]; }
        st.pendingPick = { machine: slug, bet, prizes, label: m.collect.bonus.label, createdAt: Date.now() };
        bonusAwarded = { type: 'pick', label: m.collect.bonus.label, options: prizes.length, source: 'shoe' };
        shoeBonus = true;
      }
    }
    try { await platform.setState(pid, m.collect.key + ':' + slug, count); } catch (e) { st._shoeCache = st._shoeCache || {}; st._shoeCache[slug] = count; }
    shoe = { count, fill: m.collect.fill, added: jokers, label: m.collect.label, filled: !!shoeBonus };
  }

  // Settle with the platform wallet (records wager stats; credits payout).
  let chips = null;
  try {
    const s = await platform.settle(pid, {
      wager: isFree ? 0 : bet, payout: result.payout, game: GAME_SLUG,
      meta: { machine: slug, denom, betLevel, lines, free: isFree },
    });
    chips = s.chips;
  } catch (e) {
    // Payout credit failed AFTER the debit — surface loudly so it can be reconciled.
    console.error('[settle] FAILED pid=%s bet=%d payout=%d: %s', pid, bet, result.payout, e.message);
    return res.status(502).json({ ok: false, error: 'settle failed — contact admin', code: 'SETTLE_FAIL' });
  }

  // Session tallies.
  const pm = st.session.perMachine[slug] || (st.session.perMachine[slug] = { wagered: 0, won: 0 });
  if (!isFree) { st.session.wagered += bet; pm.wagered += bet; }
  st.session.won += result.payout; pm.won += result.payout;

  // Big win? (config threshold ×bet) → overlay client-side + master leaderboard.
  const bigWin = result.payout >= bet * ((m.bigWin && m.bigWin.thresholdX) || 10);
  if (bigWin) platform.reportBigWin({ platformId: pid, game: GAME_SLUG, payout: result.payout, meta: { machine: slug, bet, lines, denom, free: isFree } });

  res.json({
    ok: true,
    machine: slug,
    bet: isFree ? 0 : bet,
    betShown: bet,
    stops: result.stops,
    window: result.window,
    wins: result.wins,
    payout: result.payout,
    bigWin,
    bonus: bonusAwarded,
    freeSpins: fsView(st),
    pendingPick: pickView(st),
    shoe,
    chips,
    session: sessionView(st, slug),
  });
});

// ── Interactive pick bonus: resolve the committed layout ──
app.post('/api/bonus/pick', requireSession, async (req, res) => {
  const pid = req.player.platformId;
  const st = stateFor(pid);
  const pp = st.pendingPick;
  if (!pp) return res.status(409).json({ ok: false, error: 'no bonus pending' });

  const choice = Number(req.body.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= pp.prizes.length) {
    return res.status(400).json({ ok: false, error: 'invalid choice' });
  }

  const mult = pp.prizes[choice];
  const amount = mult * pp.bet;
  const slug = pp.machine;
  const m = engine.getMachine(slug);

  let chips = null;
  try {
    const s = await platform.settle(pid, {
      wager: 0, payout: amount, game: GAME_SLUG,
      meta: { machine: slug, bonus: 'pick', mult, bet: pp.bet },
    });
    chips = s.chips;
  } catch (e) {
    console.error('[bonus-pick settle] FAILED pid=%s amount=%d: %s', pid, amount, e.message);
    return res.status(502).json({ ok: false, error: 'settle failed — bonus still pending, try again', code: 'SETTLE_FAIL' });
  }

  st.pendingPick = null;
  const pm = st.session.perMachine[slug] || (st.session.perMachine[slug] = { wagered: 0, won: 0 });
  st.session.won += amount; pm.won += amount;

  const bigWin = amount >= pp.bet * ((m && m.bigWin && m.bigWin.thresholdX) || 10);
  if (bigWin) platform.reportBigWin({ platformId: pid, game: GAME_SLUG, payout: amount, meta: { machine: slug, bet: pp.bet, bonus: 'pick', mult } });

  res.json({
    ok: true,
    picked: choice,
    prizes: pp.prizes,          // full reveal for the animation
    mult,
    amount,
    bet: pp.bet,
    bigWin,
    chips,
    session: sessionView(st, slug),
  });
});

// 3D slot is the front door (what the parlor satellite jumps into); 2D stays at /classic
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'slot3d.html')));
app.get('/classic', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('================================');
  console.log(' Reels v' + require('./package.json').version);
  console.log(' Domain: ' + DOMAIN);
  console.log(' Listening on port ' + PORT);
  console.log('================================');
});
