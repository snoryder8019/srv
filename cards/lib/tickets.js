/**
 * Table tickets — the matchmaking -> cards handoff (CARDGAMES_PROTOCOL §4).
 * Signed HS256 with BRIDGE_SECRET (shared with the games bridge). Until
 * matchmaking exists, the cards platform can mint dev tickets locally (admin-
 * gated) so tables can be created and tested.
 */
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export function verifyTicket(token) {
  if (!token || !config.platform.bridgeSecret) return null;
  try {
    return jwt.verify(token, config.platform.bridgeSecret);
  } catch (e) {
    return null;
  }
}

export function mintTicket(payload, ttl = '120s') {
  return jwt.sign(payload, config.platform.bridgeSecret, { expiresIn: ttl });
}
