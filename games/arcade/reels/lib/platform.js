/**
 * Platform client — narrow channel to games.madladslab.com per WEBGAMES_PROTOCOL.md.
 * Wallet is authoritative on the platform; all calls carry x-bridge-secret and are
 * server-to-server only. Score reporting is best-effort and never blocks a spin.
 */
const BASE = process.env.PLATFORM_INTERNAL || 'http://127.0.0.1:3500';
const SECRET = process.env.BRIDGE_SECRET;

async function internal(path, body, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': SECRET },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  } finally { clearTimeout(t); }
}

async function getWallet(platformId) {
  const { status, data } = await internal('/internal/wallet/get', { platformId });
  if (status !== 200) throw new Error(data.error || 'wallet unavailable');
  return data;
}

/** Debit the wager up front. Throws {code:'INSUFFICIENT'} if the player can't cover it. */
async function debit(platformId, amount, game, meta) {
  const { status, data } = await internal('/internal/wallet/debit', { platformId, amount, game, meta });
  if (status === 200 && data.ok) return data;
  const err = new Error(data.error || 'debit failed');
  if (/insufficient/i.test(data.error || '')) err.code = 'INSUFFICIENT';
  throw err;
}

/** Settle: credits payout (if any) and records wager stats / biggestBetWon. */
async function settle(platformId, { wager, payout, game, meta }) {
  const { status, data } = await internal('/internal/wallet/settle', { platformId, wager, payout, game, meta });
  if (status !== 200) throw new Error(data.error || 'settle failed');
  return data;
}

/** Best-effort big-win report onto the master leaderboard / activity feed. */
function reportBigWin({ platformId, game, payout, meta }) {
  internal('/internal/webgame/score', {
    game, platformId, event: 'game-end', status: 'won',
    score: payout, meta: meta || {},
  }).catch(() => {});
}

// durable per-player game state (Joker shoe, etc.) via platform KV
async function getState(platformId, key) {
  const { status, data } = await internal('/internal/gamestate/get', { game: 'reels', platformId, key });
  if (status !== 200) throw new Error(data.error || 'gamestate get failed');
  return data.value;
}
async function setState(platformId, key, value) {
  const { status, data } = await internal('/internal/gamestate/set', { game: 'reels', platformId, key, value });
  if (status !== 200) throw new Error(data.error || 'gamestate set failed');
  return data.value;
}

module.exports = { getWallet, debit, settle, reportBigWin, getState, setState };
