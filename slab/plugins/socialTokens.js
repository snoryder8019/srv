// ─────────────────────────────────────────────────────────────────────────────
// socialTokens.js — automatic long-lived token management for Meta platforms.
//
// Strategy:
//  • Facebook  → exchange the pasted token for a long-lived USER token, then
//                derive the Page access token (which NEVER expires). Set & forget.
//  • Instagram → extend to a long-lived USER token (60 days); the daily cron
//                re-exchanges it before it lapses.
//  • Threads   → refresh via the Threads refresh endpoint (60-day tokens).
//
// Tokens are AES-256-GCM encrypted at rest; decrypted values are never logged.
// ─────────────────────────────────────────────────────────────────────────────
import { encrypt, decrypt } from './crypto.js';

const FB = 'https://graph.facebook.com/v21.0';
const REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000; // refresh when <10 days left

// ── Low-level Graph helpers ──────────────────────────────────────────────────
export async function fbDebugToken(token, appId, appSecret) {
  const appToken = `${appId}|${appSecret}`;
  const r = await fetch(`${FB}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  const d = j.data || {};
  return {
    isValid: !!d.is_valid,
    type: d.type || null,                 // 'USER' | 'PAGE'
    scopes: d.scopes || [],
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null, // null = never
  };
}

export async function fbExchangeLongLived(appId, appSecret, token) {
  const u = `${FB}/oauth/access_token?grant_type=fb_exchange_token`
    + `&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}`
    + `&fb_exchange_token=${encodeURIComponent(token)}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error?.message || `exchange HTTP ${r.status}`);
  return { token: j.access_token, expiresInSec: j.expires_in || null };
}

export async function fbGetPageToken(userToken, pageId) {
  const r = await fetch(`${FB}/me/accounts?fields=id,access_token&access_token=${encodeURIComponent(userToken)}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  const pages = Array.isArray(j.data) ? j.data : [];
  const page = pages.find(p => p.id === pageId) || pages[0];
  return page?.access_token || null;
}

export async function threadsRefresh(token) {
  const r = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error?.message || `threads refresh HTTP ${r.status}`);
  return { token: j.access_token, expiresInSec: j.expires_in || null };
}

// ── Should this account be (re)processed now? ────────────────────────────────
export function needsRefresh(account) {
  if (account.platform === 'facebook') {
    // Not yet converted to a permanent page token
    return account.tokenType !== 'PAGE' || account.tokenExpiresAt != null;
  }
  if (account.platform === 'instagram' || account.platform === 'threads') {
    const exp = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : 0;
    if (!exp) return true;                                  // unknown → refresh
    return exp - Date.now() < REFRESH_WINDOW_MS;            // within window
  }
  return false;
}

// ── Compute the token update for one account ─────────────────────────────────
// `appCreds` supplies { appId, appSecret } (Instagram has none of its own, so
// the caller passes the Facebook connection's app credentials).
// Returns { secrets?, set? } to persist, or { skipped: reason }.
export async function refreshAccount(account, appCreds = {}) {
  const p = account.platform;

  if (p === 'facebook' || p === 'instagram') {
    const appId = account.credentials?.appId || appCreds.appId;
    const appSecret = (account.secrets?.appSecret ? decrypt(account.secrets.appSecret) : null) || appCreds.appSecret;
    if (!appId || !appSecret) return { skipped: 'Add App ID + App Secret to enable auto-renew' };

    const tokField = p === 'facebook' ? 'pageAccessToken' : 'accessToken';
    if (!account.secrets?.[tokField]) return { skipped: 'No token saved yet' };
    const current = decrypt(account.secrets[tokField]);

    if (p === 'facebook') {
      const info = await fbDebugToken(current, appId, appSecret);
      // Already a permanent page token → just record status.
      if (info.type === 'PAGE' && !info.expiresAt) {
        return { set: { tokenType: 'PAGE', tokenExpiresAt: null, tokenManaged: true } };
      }
      // Exchange → long-lived user token → derive the never-expiring page token.
      const ll = await fbExchangeLongLived(appId, appSecret, current);
      const pageTok = await fbGetPageToken(ll.token, account.credentials?.pageId);
      if (!pageTok) throw new Error('Could not derive a Page token — is this token an admin of the Page?');
      return {
        secrets: { pageAccessToken: encrypt(pageTok) },
        set: { tokenType: 'PAGE', tokenExpiresAt: null, tokenManaged: true, lastRefreshAt: new Date() },
      };
    } else {
      // Instagram: extend the long-lived user token (60 days).
      const ll = await fbExchangeLongLived(appId, appSecret, current);
      const expiresAt = ll.expiresInSec ? new Date(Date.now() + ll.expiresInSec * 1000) : null;
      return {
        secrets: { accessToken: encrypt(ll.token) },
        set: { tokenType: 'USER', tokenExpiresAt: expiresAt, tokenManaged: true, lastRefreshAt: new Date() },
      };
    }
  }

  if (p === 'threads') {
    if (!account.secrets?.accessToken) return { skipped: 'No token saved yet' };
    const current = decrypt(account.secrets.accessToken);
    const res = await threadsRefresh(current);
    const expiresAt = res.expiresInSec ? new Date(Date.now() + res.expiresInSec * 1000) : null;
    return {
      secrets: { accessToken: encrypt(res.token) },
      set: { tokenExpiresAt: expiresAt, tokenManaged: true, lastRefreshAt: new Date() },
    };
  }

  return { skipped: 'Platform does not support auto-renew' };
}

// Persist a refreshAccount() result. Returns true if anything was written.
export async function applyRefresh(db, platform, result) {
  if (!result || result.skipped || (!result.secrets && !result.set)) return false;
  const set = { ...(result.set || {}), updatedAt: new Date() };
  for (const [k, v] of Object.entries(result.secrets || {})) set[`secrets.${k}`] = v;
  await db.collection('social_accounts').updateOne({ platform }, { $set: set });
  return true;
}

// Refresh all due Meta accounts in one tenant DB. Returns a per-platform summary.
export async function refreshTenantTokens(db, { force = false } = {}) {
  const accounts = await db.collection('social_accounts')
    .find({ platform: { $in: ['facebook', 'instagram', 'threads'] } }).toArray();
  if (!accounts.length) return [];

  const fb = accounts.find(a => a.platform === 'facebook');
  const appCreds = {
    appId: fb?.credentials?.appId || null,
    appSecret: fb?.secrets?.appSecret ? decrypt(fb.secrets.appSecret) : null,
  };

  const out = [];
  for (const a of accounts) {
    try {
      if (!force && !needsRefresh(a)) { out.push({ platform: a.platform, skipped: 'not due' }); continue; }
      const result = await refreshAccount(a, appCreds);
      if (await applyRefresh(db, a.platform, result)) {
        out.push({ platform: a.platform, refreshed: true, expiresAt: result.set?.tokenExpiresAt ?? null });
      } else {
        out.push({ platform: a.platform, skipped: result?.skipped || 'nothing to do' });
      }
    } catch (e) {
      out.push({ platform: a.platform, error: e.message });
    }
  }
  return out;
}
