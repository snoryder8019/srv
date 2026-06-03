/**
 * wallet.js — site-wide chip economy for the MadLadsLab platform.
 *
 * One balance per identity (platformId), stored in Mongo. Chips are earned
 * across the whole site — playing on dedicated servers, and participating in the
 * arcade — and spent/won in the casino games (craps, roulette) on tiles.
 *
 * Collections:
 *   wallets        { platformId, displayName, chips, biggestBetWon, biggestBetGame,
 *                    totalWagered, totalWon, updatedAt, createdAt }
 *   wallet_ledger  { platformId, delta, balance, reason, game, meta, ts }  (audit trail)
 *
 * Every mutation is atomic via findOneAndUpdate with $inc, and writes a ledger
 * row. Debits never take a balance below zero (caller checks the returned ok).
 *
 * "Most chips" = wallets sorted by chips. "Largest bet won" = max single winning
 * wager, tracked per wallet as biggestBetWon (with the game it happened in).
 */

const { EventEmitter } = require('events');

const STARTING_CHIPS = 500;          // granted once on first wallet touch
const EARN = {
  arcadePlay: 10,
  arcadeWin: 50,
  serverMinute: 2,                   // server-reward COINS earned per minute on a dedicated server
};

// The unified wallet holds two currencies:
//   chips — the casino/arcade currency (bet at craps & roulette, earned in the arcade)
//   coins — server-reward coins, earned by playing on the dedicated game servers
// Live balance changes are published on this emitter; app.js forwards them to the
// owning user's socket so the profile wallet updates in real time.
const emitter = new EventEmitter();
function emitWallet(platformId, w, extra) {
  try {
    emitter.emit('wallet', {
      platformId: String(platformId),
      chips: w ? (w.chips || 0) : 0,
      coins: w ? (w.coins || 0) : 0,
      at: Date.now(),
      ...(extra || {}),
    });
  } catch (e) { /* emit is best-effort */ }
}

function coll(db) { return db.collection('wallets'); }
function ledger(db) { return db.collection('wallet_ledger'); }

async function ensureIndexes(db) {
  await coll(db).createIndex({ platformId: 1 }, { unique: true });
  await coll(db).createIndex({ chips: -1 });
  await coll(db).createIndex({ coins: -1 });
  await coll(db).createIndex({ biggestBetWon: -1 });
  await ledger(db).createIndex({ platformId: 1, ts: -1 });
  // server-reward coins resolve a Steam link → platform user on the hot stats path
  try { await db.collection('users').createIndex({ steamId: 1 }); } catch (e) { /* may already exist */ }
}

async function logLedger(db, platformId, delta, balance, reason, game, meta, currency) {
  try {
    await ledger(db).insertOne({
      platformId: String(platformId), delta, balance,
      currency: currency || 'chips',
      reason: reason || 'adjust', game: game || null,
      meta: (meta && typeof meta === 'object') ? meta : {}, ts: new Date(),
    });
  } catch (e) { /* ledger is best-effort */ }
}

/** Recent wallet activity (both currencies) for the profile wallet view. */
async function recentActivity(db, platformId, limit = 10) {
  limit = Math.min(Math.max(1, limit), 50);
  try {
    const rows = await ledger(db).find({ platformId: String(platformId) })
      .sort({ ts: -1 }).limit(limit).toArray();
    return rows.map((r) => ({
      delta: r.delta, balance: r.balance, currency: r.currency || 'chips',
      reason: r.reason, game: r.game, ts: r.ts,
    }));
  } catch (e) { return []; }
}

/** Get a wallet, creating it with the starting balance on first touch. */
async function getWallet(db, platformId, displayName) {
  const pid = String(platformId);
  const now = new Date();
  const r = await coll(db).findOneAndUpdate(
    { platformId: pid },
    {
      $setOnInsert: {
        platformId: pid, chips: STARTING_CHIPS, coins: 0, biggestBetWon: 0, biggestBetGame: null,
        totalWagered: 0, totalWon: 0, serverCoinsEarned: 0, createdAt: now,
      },
      $set: { updatedAt: now, ...(displayName ? { displayName } : {}) },
    },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true }
  );
  const w = r && (r.value || r);
  const wasInsert = r && r.lastErrorObject && r.lastErrorObject.updatedExisting === false;
  if (wasInsert) await logLedger(db, pid, STARTING_CHIPS, STARTING_CHIPS, 'welcome-bonus', null, {});
  return w;
}

/** Credit chips (earn / win / payout). Always succeeds. */
async function credit(db, platformId, amount, reason, game, meta, displayName) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  await getWallet(db, platformId, displayName);
  if (!amount) { const w = await coll(db).findOne({ platformId: String(platformId) }); return { ok: true, chips: w.chips, credited: 0 }; }
  const r = await coll(db).findOneAndUpdate(
    { platformId: String(platformId) },
    { $inc: { chips: amount }, $set: { updatedAt: new Date(), ...(displayName ? { displayName } : {}) } },
    { returnDocument: 'after' }
  );
  const w = r.value || r;
  await logLedger(db, platformId, amount, w.chips, reason, game, meta, 'chips');
  emitWallet(platformId, w, { delta: amount, currency: 'chips', reason: reason || 'credit', game: game || null });
  return { ok: true, chips: w.chips, credited: amount };
}

/** Debit chips (place a wager). Fails (ok:false) if insufficient balance. */
async function debit(db, platformId, amount, reason, game, meta, displayName) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  await getWallet(db, platformId, displayName);
  if (!amount) { const w = await coll(db).findOne({ platformId: String(platformId) }); return { ok: true, chips: w.chips, debited: 0 }; }
  const r = await coll(db).findOneAndUpdate(
    { platformId: String(platformId), chips: { $gte: amount } },
    { $inc: { chips: -amount, totalWagered: amount }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  const w = r && (r.value || r);
  if (!w) {
    const cur = await coll(db).findOne({ platformId: String(platformId) });
    return { ok: false, error: 'insufficient', chips: cur ? cur.chips : 0 };
  }
  await logLedger(db, platformId, -amount, w.chips, reason, game, meta, 'chips');
  emitWallet(platformId, w, { delta: -amount, currency: 'chips', reason: reason || 'wager', game: game || null });
  return { ok: true, chips: w.chips, debited: amount };
}

/**
 * Credit server-reward COINS (a distinct currency from chips). Earned by playing
 * on the dedicated game servers. Always succeeds.
 */
async function creditCoins(db, platformId, amount, reason, game, meta, displayName) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  await getWallet(db, platformId, displayName);
  if (!amount) { const w = await coll(db).findOne({ platformId: String(platformId) }); return { ok: true, coins: w.coins || 0, credited: 0 }; }
  const r = await coll(db).findOneAndUpdate(
    { platformId: String(platformId) },
    { $inc: { coins: amount, serverCoinsEarned: amount }, $set: { updatedAt: new Date(), ...(displayName ? { displayName } : {}) } },
    { returnDocument: 'after' }
  );
  const w = r.value || r;
  await logLedger(db, platformId, amount, w.coins, reason || 'server-reward', game, meta, 'coins');
  emitWallet(platformId, w, { delta: amount, currency: 'coins', reason: reason || 'server-reward', game: game || null });
  return { ok: true, coins: w.coins, credited: amount };
}

/** Spend server-reward COINS (redeem a reward). Fails (ok:false) if insufficient. */
async function debitCoins(db, platformId, amount, reason, game, meta, displayName) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  await getWallet(db, platformId, displayName);
  if (!amount) { const w = await coll(db).findOne({ platformId: String(platformId) }); return { ok: true, coins: w.coins || 0, debited: 0 }; }
  const r = await coll(db).findOneAndUpdate(
    { platformId: String(platformId), coins: { $gte: amount } },
    { $inc: { coins: -amount }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  const w = r && (r.value || r);
  if (!w) { const cur = await coll(db).findOne({ platformId: String(platformId) }); return { ok: false, error: 'insufficient', coins: cur ? (cur.coins || 0) : 0 }; }
  await logLedger(db, platformId, -amount, w.coins, reason || 'redeem', game, meta, 'coins');
  emitWallet(platformId, w, { delta: -amount, currency: 'coins', reason: reason || 'redeem', game: game || null });
  return { ok: true, coins: w.coins, debited: amount };
}

/**
 * Settle a casino round: the wager was already debited at bet time; pay out the
 * winnings (0 on a loss) and update win-stats + the "largest bet won" record.
 * payout = total returned (stake + profit); 0 for a loss.
 */
async function settleBet(db, platformId, { wager, payout, game, meta, displayName }) {
  wager = Math.max(0, Math.floor(Number(wager) || 0));
  payout = Math.max(0, Math.floor(Number(payout) || 0));
  const won = payout > 0;
  const profit = Math.max(0, payout - wager);

  if (payout > 0) await credit(db, platformId, payout, won ? 'casino-win' : 'casino-payout', game, meta, displayName);

  const update = { $inc: { totalWon: profit, totalWagered: wager }, $set: { updatedAt: new Date() } };
  if (won) update.$max = { biggestBetWon: wager };
  const r = await coll(db).findOneAndUpdate(
    { platformId: String(platformId) }, update, { returnDocument: 'after' }
  );
  const w = r && (r.value || r);
  if (won && w && w.biggestBetWon === wager) {
    await coll(db).updateOne({ platformId: String(platformId) }, { $set: { biggestBetGame: game || null } });
  }
  return { ok: true, chips: w ? w.chips : null, won, profit };
}

/** Leaderboards. kind: 'chips' (richest) | 'bet' (largest single bet won). */
async function leaderboard(db, kind = 'chips', limit = 20) {
  limit = Math.min(Math.max(1, limit), 100);
  const sort = kind === 'bet' ? { biggestBetWon: -1 } : { chips: -1 };
  const filter = kind === 'bet' ? { biggestBetWon: { $gt: 0 } } : {};
  const rows = await coll(db).find(filter).sort(sort).limit(limit).toArray();
  return rows.map((w, i) => ({
    rank: i + 1,
    displayName: w.displayName || 'Player',
    chips: w.chips || 0,
    biggestBetWon: w.biggestBetWon || 0,
    biggestBetGame: w.biggestBetGame || null,
  }));
}

/** Award chips for a recorded arcade result (called from the score-ingest hook). */
const CASINO_GAMES = new Set(['craps', 'roulette']);
async function awardArcadeResult(db, { platformId, displayName, status, game }) {
  if (!platformId) return null;
  if (CASINO_GAMES.has(game)) return null;   // casino games settle in chips, no arcade bonus
  const win = status === 'won';
  const amount = EARN.arcadePlay + (win ? EARN.arcadeWin : 0);
  return credit(db, platformId, amount, win ? 'arcade-win' : 'arcade-play', game, { status }, displayName);
}

/**
 * Accrue server-reward COINS for time spent on a dedicated server. Dedicated
 * servers identify players by Steam ID; a platform user earns coins only once
 * they've linked that Steam ID on their profile (steamId field). We resolve the
 * link (cached, with a negative cache so unlinked players don't hammer Mongo) and
 * credit floor coins for the elapsed seconds at EARN.serverMinute per minute.
 * Returns the credit result, or null when there's no linked platform account.
 */
const steamLinkCache = new Map();    // steamId -> { pid: string|null, at: ms }
const LINK_TTL_MS = 5 * 60 * 1000;
const LINK_MISS_TTL_MS = 60 * 1000;

async function resolveSteamLink(db, steamId) {
  const key = String(steamId);
  const hit = steamLinkCache.get(key);
  const now = Date.now();
  if (hit && (now - hit.at) < (hit.pid ? LINK_TTL_MS : LINK_MISS_TTL_MS)) return hit.pid;
  let pid = null;
  try {
    const u = await db.collection('users').findOne({ steamId: key }, { projection: { _id: 1 } });
    if (u) pid = String(u._id);
  } catch (e) { /* leave pid null */ }
  steamLinkCache.set(key, { pid, at: now });
  return pid;
}

async function accrueServerCoins(db, { game, steamId, name, seconds }) {
  if (!steamId || !seconds) return null;
  const pid = await resolveSteamLink(db, steamId);
  if (!pid) return null;                         // player hasn't linked their Steam ID
  const amount = Math.round((Number(seconds) / 60) * EARN.serverMinute);
  if (amount < 1) return null;
  return creditCoins(db, pid, amount, 'server-play', game, { steamId: String(steamId), name: name || null }, name || null);
}

module.exports = {
  STARTING_CHIPS, EARN, emitter,
  ensureIndexes, getWallet, credit, debit, settleBet, leaderboard, awardArcadeResult,
  creditCoins, debitCoins, accrueServerCoins, recentActivity,
};
