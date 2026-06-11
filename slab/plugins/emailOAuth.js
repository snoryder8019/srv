/**
 * Email OAuth — per-tenant OAuth 2.0 for outbound SMTP (XOAUTH2).
 *
 * Supports the two providers whose mailboxes commonly block password-based SMTP:
 *   - gmail   → Google (Gmail / Workspace)   SMTP scope: https://mail.google.com/
 *   - outlook → Microsoft (Outlook / M365)    SMTP scope: outlook.office365.com/SMTP.Send
 *
 * Each tenant registers its OWN OAuth client (client id + secret) and authorises
 * its mailbox, yielding a long-lived refresh token we store encrypted. At send
 * time we exchange the refresh token for a short-lived access token (cached in
 * memory until shortly before expiry) and hand it to nodemailer as XOAUTH2.
 *
 * Reuses the JWT-state + `https://${hostname}/...callback` conventions from
 * routes/auth.js. Uses global fetch (Node 18+).
 */

export const EMAIL_OAUTH_PROVIDERS = {
  gmail: {
    label: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // mail.google.com is required for SMTP send; openid+email lets us read the
    // authorised address back from the id_token.
    scope: 'https://mail.google.com/ openid email',
    // access_type=offline + prompt=consent forces a refresh_token every time.
    authExtra: { access_type: 'offline', prompt: 'consent' },
  },
  outlook: {
    label: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // SMTP.Send for sending; offline_access for a refresh token; openid+email
    // to recover the mailbox address.
    scope: 'https://outlook.office365.com/SMTP.Send offline_access openid email',
    authExtra: { response_mode: 'query' },
  },
};

export function isOAuthProvider(provider) {
  return Object.prototype.hasOwnProperty.call(EMAIL_OAUTH_PROVIDERS, provider);
}

/** Build the provider consent URL to redirect the admin to. */
export function buildAuthUrl(provider, { clientId, redirectUri, state }) {
  const p = EMAIL_OAUTH_PROVIDERS[provider];
  if (!p) throw new Error(`Unknown email OAuth provider: ${provider}`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    ...p.authExtra,
  });
  return `${p.authUrl}?${params.toString()}`;
}

/** Best-effort decode of a JWT payload (no signature check — TLS-trusted source). */
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function emailFromTokenResponse(data) {
  const id = data.id_token ? decodeJwtPayload(data.id_token) : null;
  return (id && (id.email || id.preferred_username || id.upn)) || null;
}

/**
 * Exchange an authorization code for tokens.
 * Returns { refreshToken, accessToken, expiresIn, email }.
 */
export async function exchangeCode(provider, { clientId, clientSecret, code, redirectUri }) {
  const p = EMAIL_OAUTH_PROVIDERS[provider];
  if (!p) throw new Error(`Unknown email OAuth provider: ${provider}`);
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error || res.status}`);
  }
  if (!data.refresh_token) {
    throw new Error('No refresh token returned — re-authorize with offline access / consent.');
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in) || 3600,
    email: emailFromTokenResponse(data),
  };
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(provider, { clientId, clientSecret, refreshToken }) {
  const p = EMAIL_OAUTH_PROVIDERS[provider];
  if (!p) throw new Error(`Unknown email OAuth provider: ${provider}`);
  const body = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  };
  // Microsoft requires the scope on refresh; Google ignores it harmlessly.
  if (provider === 'outlook') body.scope = p.scope;
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error || res.status}`);
  }
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3600 };
}

/* ── In-memory access-token cache (per client+refresh-token) ─────────────────
 * Date.now() is used only for relative expiry comparison; that's fine here.
 * Keyed on the refresh token so a re-consent (new refresh token) gets a fresh
 * entry automatically. */
const accessCache = new Map();
const SKEW_MS = 5 * 60 * 1000; // refresh 5 min before the provider's expiry

/**
 * Return a currently-valid access token for the given OAuth config, refreshing
 * (and caching) as needed. `oauth` = { provider, clientId, clientSecret, refreshToken }.
 */
export async function getEmailAccessToken(oauth) {
  const { provider, clientId, clientSecret, refreshToken } = oauth;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth client credentials or refresh token missing.');
  }
  const key = `${provider}|${clientId}|${refreshToken}`;
  const hit = accessCache.get(key);
  if (hit && hit.expMs - SKEW_MS > Date.now()) return hit.token;

  const { accessToken, expiresIn } = await refreshAccessToken(provider, { clientId, clientSecret, refreshToken });
  accessCache.set(key, { token: accessToken, expMs: Date.now() + expiresIn * 1000 });
  return accessToken;
}

/** Drop any cached access token for a refresh token (e.g. on disconnect). */
export function clearEmailAccessToken(oauth) {
  for (const k of accessCache.keys()) {
    if (oauth?.refreshToken && k.endsWith(`|${oauth.refreshToken}`)) accessCache.delete(k);
  }
}
