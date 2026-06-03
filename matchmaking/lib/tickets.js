/**
 * Tickets — matchmaking mints the table ticket that hands a formed group off to
 * the game loader (cards). Signed HS256 with the shared BRIDGE_SECRET, so the
 * loader verifies it with the same secret. This is the matchmaking -> game seam.
 */
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export function verifyBridgeToken(token) {
  if (!token || !config.platform.bridgeSecret) return null;
  try { return jwt.verify(token, config.platform.bridgeSecret); }
  catch (e) { return null; }
}

export function mintTableTicket(payload, ttl = '120s') {
  return jwt.sign(payload, config.platform.bridgeSecret, { expiresIn: ttl });
}
