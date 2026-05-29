// Dependency-free RS256 JWT — sign + verify using Node's built-in crypto.
// We NEVER honor the token's own `alg` header on verify (always RSA-SHA256
// against our public key), so algorithm-confusion ("alg":"none"/HS256) attacks
// don't apply.
import crypto from 'crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (str) => Buffer.from(str, 'base64url');

export function signJWT(payload, privateKeyPem, { kid } = {}) {
  const header = { alg: 'RS256', typ: 'JWT', ...(kid ? { kid } : {}) };
  const segments = [b64url(JSON.stringify(header)), b64url(JSON.stringify(payload))];
  const signingInput = segments.join('.');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem);
  return `${signingInput}.${b64url(signature)}`;
}

// Returns the decoded payload if valid, else throws.
export function verifyJWT(token, publicKeyPem, { issuer, audience } = {}) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;

  const header = JSON.parse(fromB64url(h).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`unexpected alg: ${header.alg}`);

  const signingInput = `${h}.${p}`;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(signingInput), publicKeyPem, fromB64url(s));
  if (!ok) throw new Error('bad signature');

  const payload = JSON.parse(fromB64url(p).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error('token expired');
  if (payload.nbf && now < payload.nbf) throw new Error('token not yet valid');
  if (issuer && payload.iss !== issuer) throw new Error('issuer mismatch');
  if (audience && payload.aud !== audience) throw new Error('audience mismatch');

  return payload;
}

// Build an RFC 7517 JWK (public) from a PEM public key, for the JWKS endpoint.
export function publicKeyToJWK(publicKeyPem, kid) {
  const keyObj = crypto.createPublicKey(publicKeyPem);
  const jwk = keyObj.export({ format: 'jwk' });
  return { ...jwk, use: 'sig', alg: 'RS256', kid };
}
