/**
 * Short-lived tokens for admin Socket.IO authentication.
 * Generated server-side when admin loads the livechats page.
 */
import { randomUUID } from 'crypto';

const tokens = new Map(); // token → expiresAt (ms)

export function createAdminToken() {
  // Cleanup expired tokens
  const now = Date.now();
  for (const [t, exp] of tokens) if (now > exp) tokens.delete(t);

  const token = randomUUID();
  tokens.set(token, now + 3_600_000); // 1 hour TTL
  return token;
}

export function validateAdminToken(token) {
  if (!token) return false;
  const exp = tokens.get(token);
  return !!(exp && Date.now() <= exp);
}
