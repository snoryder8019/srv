// ─────────────────────────────────────────────────────────────────────────────
// googleOAuth.js — shared Google OAuth 2.0 primitives for asset-import connectors
// (Drive, Photos). Same token endpoint and refresh-token dance for every Google
// service; only the requested scope and the API called afterwards differ.
//
// Uses the SHARED platform app (config.GGLCID / GGLSEC). Each tenant authorises
// its own Google account, yielding a refresh token we store encrypted per tenant.
// Access tokens are cached in memory keyed on the refresh token (which is unique
// per service, so Drive and Photos never collide). Uses global fetch (Node 18+).
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Build a Google consent URL. access_type=offline + prompt=consent forces a refresh_token. */
export function buildConsentUrl({ clientId, redirectUri, state, scope }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
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

/**
 * Exchange an authorization code for tokens.
 * Returns { refreshToken, accessToken, expiresIn, email }.
 */
export async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error || res.status}`);
  }
  if (!data.refresh_token) {
    throw new Error('No refresh token returned — re-authorize with offline access / consent.');
  }
  const id = data.id_token ? decodeJwtPayload(data.id_token) : null;
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in) || 3600,
    email: (id && id.email) || null,
  };
}

/** Exchange a refresh token for a fresh access token. */
async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error || res.status}`);
  }
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3600 };
}

// ── In-memory access-token cache, keyed on the refresh token ──────────────────
const accessCache = new Map();
const SKEW_MS = 5 * 60 * 1000; // refresh 5 min before Google's expiry

/**
 * Return a currently-valid access token, refreshing (and caching) as needed.
 * `oauth` = { clientId, clientSecret, refreshToken }.
 */
export async function getAccessToken(oauth) {
  const { clientId, clientSecret, refreshToken } = oauth;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google account is not connected.');
  }
  const hit = accessCache.get(refreshToken);
  if (hit && hit.expMs - SKEW_MS > Date.now()) return hit.token;

  const { accessToken, expiresIn } = await refreshAccessToken({ clientId, clientSecret, refreshToken });
  accessCache.set(refreshToken, { token: accessToken, expMs: Date.now() + expiresIn * 1000 });
  return accessToken;
}

/** Drop any cached access token for a refresh token (e.g. on disconnect). */
export function clearAccessToken(refreshToken) {
  if (refreshToken) accessCache.delete(refreshToken);
}
