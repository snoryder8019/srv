#!/usr/bin/env node
/**
 * mllOauth — OAuth 2.1 Authorization Server for the MadLadsLab MCP resource.
 *
 * Flow (claude.ai web/desktop/mobile + Claude Code):
 *   discovery (.well-known) -> /authorize (code + PKCE/S256) -> /token (JWT)
 * The MCP server (mcp-http.js) is the resource server: it verifies the RS256
 * JWT with the public key. This service alone holds the private key.
 *
 * Fronted by Apache on https://mcp.madladslab.com (no token gate on these
 * routes — they ARE the auth flow). Listens on loopback only.
 */
import express from 'express';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { signJWT, publicKeyToJWK } from './lib/jwt.js';
import { Store } from './lib/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const PORT = process.env.OAUTH_PORT || 3651;
const ISSUER = process.env.ISSUER;
const RESOURCE = process.env.MCP_RESOURCE;
const CLIENT_ID = process.env.CLAUDE_CID;
const CLIENT_SECRET = process.env.CLAUDE_SEC;
const SCOPE = process.env.SCOPE || 'mcp';
const KID = process.env.JWT_KID || 'mll-oauth-1';
const ACCESS_TTL = parseInt(process.env.ACCESS_TTL || '3600', 10);
const REFRESH_TTL = parseInt(process.env.REFRESH_TTL || '2592000', 10);
const CODE_TTL = parseInt(process.env.CODE_TTL || '300', 10);
const ALLOWED_REDIRECTS = (process.env.ALLOWED_REDIRECTS || '').split(',').map(s => s.trim()).filter(Boolean);

const PRIVATE_KEY = readFileSync(process.env.JWT_PRIVATE_KEY, 'utf8');
const PUBLIC_KEY = readFileSync(process.env.JWT_PUBLIC_KEY, 'utf8');
const JWK = publicKeyToJWK(PUBLIC_KEY, KID);
const store = new Store(join(__dirname, 'data', 'store.json'));

const now = () => Math.floor(Date.now() / 1000);
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256b64url = (s) => crypto.createHash('sha256').update(s).digest('base64url');

// Claude callback (exact) + Claude Code loopback (port-agnostic, http only).
function redirectAllowed(uri) {
  if (ALLOWED_REDIRECTS.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  } catch { /* invalid URL */ }
  return false;
}

function issueTokens(res, { clientId, scope }) {
  const iat = now();
  const access = signJWT({
    iss: ISSUER, sub: 'claude', aud: RESOURCE, client_id: clientId,
    scope, iat, exp: iat + ACCESS_TTL, jti: rand(16),
  }, PRIVATE_KEY, { kid: KID });

  const refresh = rand(48);
  store.putRefresh(refresh, { clientId, scope, exp: iat + REFRESH_TTL });

  res.set('Cache-Control', 'no-store');
  res.json({
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    scope,
  });
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Public metadata may be fetched cross-origin by the browser.
app.use('/.well-known', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mllOauth', issuer: ISSUER }));

// ── Discovery ────────────────────────────────────────────────────
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    registration_endpoint: `${ISSUER}/register`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
  });
});

// Resource metadata (both the bare path and the /mcp-suffixed variant Claude probes).
const resourceMeta = (_req, res) => res.json({
  resource: RESOURCE,
  authorization_servers: [ISSUER],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ['header'],
});
app.get('/.well-known/oauth-protected-resource', resourceMeta);
app.get('/.well-known/oauth-protected-resource/mcp', resourceMeta);

app.get('/.well-known/jwks.json', (_req, res) => res.json({ keys: [JWK] }));

// ── Dynamic Client Registration (RFC 7591) ───────────────────────
// We run a single configured client; DCR just hands it back so the claude.ai
// web UI (which auto-registers) lands on the same credentials.
app.post('/register', (req, res) => {
  const authMethod = req.body?.token_endpoint_auth_method || 'client_secret_post';
  const out = {
    client_id: CLIENT_ID,
    client_id_issued_at: now(),
    redirect_uris: req.body?.redirect_uris || ALLOWED_REDIRECTS,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
  };
  if (authMethod !== 'none') {
    out.client_secret = CLIENT_SECRET;
    out.client_secret_expires_at = 0; // never expires
  }
  res.status(201).json(out);
});

// ── Authorization endpoint ───────────────────────────────────────
app.get('/authorize', (req, res) => {
  const { response_type, client_id, redirect_uri, code_challenge,
          code_challenge_method, state, scope } = req.query;

  // redirect_uri / client must be valid before we ever redirect back.
  if (!redirect_uri || !redirectAllowed(redirect_uri)) {
    return res.status(400).send('invalid redirect_uri');
  }
  if (client_id !== CLIENT_ID) {
    return res.status(400).send('invalid client_id');
  }

  const fail = (error, desc) => {
    const u = new URL(redirect_uri);
    u.searchParams.set('error', error);
    if (desc) u.searchParams.set('error_description', desc);
    if (state) u.searchParams.set('state', state);
    return res.redirect(302, u.toString());
  };

  if (response_type !== 'code') return fail('unsupported_response_type');
  if (!code_challenge || code_challenge_method !== 'S256') return fail('invalid_request', 'PKCE S256 required');

  const code = rand(32);
  store.putCode(code, {
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    scope: scope || SCOPE,
    exp: now() + CODE_TTL,
  });

  const u = new URL(redirect_uri);
  u.searchParams.set('code', code);
  if (state) u.searchParams.set('state', state);
  console.log(`[authorize] issued code for ${client_id} -> ${redirect_uri}`);
  res.redirect(302, u.toString());
});

// ── Token endpoint ───────────────────────────────────────────────
app.post('/token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const b = req.body || {};

  // client auth: secret may arrive via body (client_secret_post) or Basic header.
  let presentedSecret = b.client_secret;
  const basic = req.headers.authorization;
  if (!presentedSecret && basic?.startsWith('Basic ')) {
    const decoded = Buffer.from(basic.slice(6), 'base64').toString('utf8');
    presentedSecret = decoded.split(':')[1];
  }
  if (presentedSecret && presentedSecret !== CLIENT_SECRET) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  if (b.grant_type === 'authorization_code') {
    const { code, redirect_uri, code_verifier, client_id } = b;
    if (!code || !code_verifier) return res.status(400).json({ error: 'invalid_request' });

    const rec = store.takeCode(code);
    if (!rec) return res.status(400).json({ error: 'invalid_grant', error_description: 'unknown or expired code' });
    if (rec.redirectUri !== redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    if (client_id && client_id !== rec.clientId) return res.status(400).json({ error: 'invalid_grant', error_description: 'client mismatch' });
    if (sha256b64url(code_verifier) !== rec.codeChallenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
    return issueTokens(res, { clientId: rec.clientId, scope: rec.scope });
  }

  if (b.grant_type === 'refresh_token') {
    const rec = store.takeRefresh(b.refresh_token); // rotate: single-use
    if (!rec) return res.status(400).json({ error: 'invalid_grant', error_description: 'unknown or expired refresh_token' });
    return issueTokens(res, { clientId: rec.clientId, scope: rec.scope });
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`mllOauth (OAuth 2.1 AS) on 127.0.0.1:${PORT} — issuer ${ISSUER}`);
});
