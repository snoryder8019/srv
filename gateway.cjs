/**
 * Slab Superadmin Gateway — Drop-in middleware for any /srv app
 *
 * CJS apps:  const { gatewayRoute } = require('/srv/gateway.cjs');
 * ESM apps:  const { gatewayRoute } = await import('/srv/gateway.cjs');
 *
 * app.get('/gateway', gatewayRoute({
 *   secret: process.env.SESHSEC,
 *   appName: 'myApp',
 *   findOrCreateAdmin: async (email) => { ... return user doc ... },
 * }));
 *
 * Token format: base64url(JSON{app,email,ts}).hmac_sha256
 * Tokens valid 60 seconds, single-use.
 */

const crypto = require('crypto');

const usedTokens = new Set();
setInterval(() => usedTokens.clear(), 5 * 60 * 1000).unref();

function verifyGatewayToken(token, secret, appName) {
  if (!token || !secret) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;

  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const raw = Buffer.from(payloadB64, 'base64url').toString();
  const expectedSig = crypto.createHmac('sha256', secret).update(raw).digest('hex');

  if (sig !== expectedSig) return null;
  if (usedTokens.has(token)) return null;
  usedTokens.add(token);

  try {
    const payload = JSON.parse(raw);
    if (Date.now() - payload.ts > 60000) return null;
    if (payload.app !== appName) return null;
    return payload;
  } catch {
    return null;
  }
}

function gatewayRoute(opts) {
  const { secret, appName, findOrCreateAdmin } = opts;

  return async function handleGateway(req, res) {
    const payload = verifyGatewayToken(req.query.token, secret, appName);

    if (!payload) {
      return res.status(403).send(
        '<html><body style="font-family:sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;">' +
        '<div style="text-align:center;"><h2 style="color:#f87171;">Gateway Access Denied</h2>' +
        '<p style="color:#737373;">Token is invalid, expired, or already used.</p></div></body></html>'
      );
    }

    try {
      const user = await findOrCreateAdmin(payload.email, payload);
      if (!user) return res.status(403).send('Admin user not found');

      req.login(user, (err) => {
        if (err) return res.status(500).send('Login failed');
        res.redirect('/admin');
      });
    } catch (err) {
      console.error('[Gateway] Error:', err.message);
      res.status(500).send('Gateway error');
    }
  };
}

module.exports = { gatewayRoute, verifyGatewayToken };
