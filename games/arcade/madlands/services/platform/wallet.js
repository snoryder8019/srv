/**
 * Wallet client — talks to the games.madladslab.com platform chip wallet (the
 * single global currency = "coins") over the internal bridge channel. Server-only.
 * Best-effort: a network failure surfaces as { ok:false } so callers refuse the
 * purchase rather than hand out free goods. Mirrors /srv/td/services/platform/wallet.js.
 */
import config from '../../config/index.js';

const { url, slug, bridgeSecret } = config.platform;

async function call(path, body) {
  if (!bridgeSecret) return { ok: false, error: 'wallet unavailable' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': bridgeSecret },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || ('http ' + res.status) };
    return data;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function getBalance(platformId, displayName) {
  if (!platformId) return { ok: false, error: 'no platform identity', chips: 0 };
  const r = await call('/internal/wallet/get', { platformId: String(platformId), displayName });
  return r.ok === false ? { ok: false, error: r.error, chips: 0 } : { ok: true, chips: r.chips || 0 };
}

export async function spend(platformId, amount, meta = {}, displayName) {
  if (!platformId) return { ok: false, error: 'no platform identity' };
  if (!(amount > 0)) return { ok: false, error: 'amount must be positive' };
  return call('/internal/wallet/debit', { platformId: String(platformId), amount: Math.round(amount), game: slug, meta, displayName });
}

export async function credit(platformId, amount, reason = 'madlands-reward', meta = {}, displayName) {
  if (!platformId) return { ok: false, error: 'no platform identity' };
  if (!(amount > 0)) return { ok: false, error: 'amount must be positive' };
  return call('/internal/wallet/credit', { platformId: String(platformId), amount: Math.round(amount), reason, game: slug, meta, displayName });
}

export default { getBalance, spend, credit };
