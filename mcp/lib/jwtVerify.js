// RS256 JWT verification (verify-only) for the MCP resource server.
// Always verifies with RSA-SHA256 against our public key and rejects any token
// whose header alg isn't RS256 — so "alg":"none"/HS256 confusion can't bypass.
import crypto from 'crypto';

const fromB64url = (str) => Buffer.from(str, 'base64url');

export function verifyJWT(token, publicKeyPem, { issuer, audience } = {}) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;

  const header = JSON.parse(fromB64url(h).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`unexpected alg: ${header.alg}`);

  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKeyPem, fromB64url(s));
  if (!ok) throw new Error('bad signature');

  const payload = JSON.parse(fromB64url(p).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error('token expired');
  if (payload.nbf && now < payload.nbf) throw new Error('token not yet valid');
  if (issuer && payload.iss !== issuer) throw new Error('issuer mismatch');
  if (audience && payload.aud !== audience) throw new Error('audience mismatch');

  return payload;
}
