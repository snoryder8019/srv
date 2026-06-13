/**
 * wallet — tiles-side client for the platform chip economy (lives on games).
 * Machine-to-machine via the shared bridge secret. Best-effort with short
 * timeouts; callers handle a null/!ok result (e.g. reject a bet on debit fail).
 *
 *   getChips(platformId)                  -> { ok, chips }
 *   debit(platformId, amount, game, meta) -> { ok, chips } | { ok:false, error:'insufficient' }
 *   settle(platformId, {wager,payout,game,meta}) -> { ok, chips, won, profit }
 *
 * Only real human identities have wallets; bot/dev/guest seats are no-ops so
 * casino tables still run solo-vs-bots without touching the economy.
 */
import config from '../config/index.js';

const BASE = config.platform.url;
const SECRET = config.platform.bridgeSecret;

export function isWalletSeat(platformId) {
  if (!platformId) return false;
  const p = String(platformId);
  return !p.startsWith('bot:') && !p.startsWith('dev:') && !p.startsWith('guest:');
}

async function call(path, body) {
  if (!SECRET) return null;
  try {
    const r = await fetch(`${BASE}/internal/wallet/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn('[wallet]', path, 'failed:', e.message);
    return null;
  }
}

export async function getChips(platformId, displayName) {
  if (!isWalletSeat(platformId)) return null;
  const r = await call('get', { platformId, displayName });
  return r;
}
export async function debitChips(platformId, amount, game, meta, displayName) {
  if (!isWalletSeat(platformId)) return { ok: true, chips: null, skipped: true };
  return call('debit', { platformId, amount, game, meta, displayName });
}
export async function settleChips(platformId, { wager, payout, game, meta, displayName }) {
  if (!isWalletSeat(platformId)) return { ok: true, chips: null, skipped: true };
  return call('settle', { platformId, wager, payout, game, meta, displayName });
}

export default { isWalletSeat, getChips, debitChips, settleChips };
