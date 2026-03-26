import express from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { issueAdminJWT, issuePortalJWT } from '../middleware/jwtAuth.js';
import { isSuperAdminEmail, issueSuperAdminJWT } from '../middleware/superadmin.js';
import { config } from '../config/config.js';

const router = express.Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// ── OAuth credential resolver ────────────────────────────────────────────────

/**
 * Get Google OAuth credentials for this request.
 * Tenant override wins; platform default is fallback.
 */
function getOAuthCreds(req) {
  const tenantCid = req.tenant?.public?.googleOAuthClientId;
  const tenantSec = req.tenant?.secrets?.googleOAuthSecret;

  if (tenantCid && tenantSec) {
    // Tenant has their own OAuth app — callback goes to their domain
    return {
      clientId: tenantCid,
      clientSecret: tenantSec,
      callbackUrl: `https://${req.hostname}/auth/google/callback`,
      source: 'tenant',
    };
  }

  // Platform default — callback to slab.madladslab.com
  return {
    clientId: config.GGLCID,
    clientSecret: config.GGLSEC,
    callbackUrl: `${config.DOMAIN}/auth/google/callback`,
    source: 'platform',
  };
}

/**
 * Build a signed state token that carries context through the OAuth redirect.
 * Replaces fragile cross-domain session approach.
 */
function buildState(payload) {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '10m' });
}

function verifyState(state) {
  return jwt.verify(state, config.JWT_SECRET);
}

// ── Redirect to Google ───────────────────────────────────────────────────────

function redirectToGoogle(req, res, { authType, linkClientId }) {
  const creds = getOAuthCreds(req);

  const state = buildState({
    authType,
    returnDomain: req.hostname,
    tenantDbName: req.tenant?.db || null,
    oauthSource: creds.source,
    callbackUrl: creds.callbackUrl,
    linkClientId: linkClientId || null,
  });

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: creds.callbackUrl,
    response_type: 'code',
    scope: 'profile email openid',
    prompt: 'select_account',
    access_type: 'online',
    state,
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
}

// ── Admin Google OAuth ───────────────────────────────────────────────────────
router.get('/google', (req, res) => {
  redirectToGoogle(req, res, { authType: 'admin' });
});

// ── Client Google OAuth ──────────────────────────────────────────────────────
router.get('/google/client', (req, res) => {
  redirectToGoogle(req, res, {
    authType: 'client',
    linkClientId: req.query.cid || null,
  });
});

// ── Superadmin Google OAuth ──────────────────────────────────────────────────
router.get('/google/superadmin', (req, res) => {
  redirectToGoogle(req, res, { authType: 'superadmin' });
});

// ── Shared callback — all OAuth flows return here ────────────────────────────
router.get('/google/callback', async (req, res) => {
  try {
    // 1. Verify state token
    const { code, state: stateToken } = req.query;
    if (!code || !stateToken) return res.redirect('/admin/login?error=oauth');

    let ctx;
    try {
      ctx = verifyState(stateToken);
    } catch {
      return res.redirect('/admin/login?error=oauth_expired');
    }

    const {
      authType = 'admin',
      returnDomain,
      tenantDbName,
      oauthSource,
      callbackUrl,
      linkClientId,
    } = ctx;

    // 2. Resolve OAuth credentials for token exchange
    let clientId, clientSecret;
    if (oauthSource === 'tenant' && tenantDbName) {
      // Look up tenant's OAuth creds
      const slab = getSlabDb();
      const tenantDoc = await slab.collection('tenants').findOne({ db: tenantDbName });
      clientId = tenantDoc?.public?.googleOAuthClientId;
      // Secret is encrypted in DB — tenant middleware decrypts, but we're on
      // the callback domain (might be slab). Re-decrypt from raw doc.
      if (tenantDoc?.secrets?.googleOAuthSecret) {
        const { decrypt } = await import('../plugins/crypto.js');
        clientSecret = decrypt(tenantDoc.secrets.googleOAuthSecret);
      }
    }
    // Fallback to platform default
    if (!clientId || !clientSecret) {
      clientId = config.GGLCID;
      clientSecret = config.GGLSEC;
    }

    // 3. Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      console.error('[auth] Token exchange failed:', tokens);
      return res.redirect(`https://${returnDomain}/admin/login?error=oauth`);
    }

    // 4. Get Google profile
    const profileRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profile.email) {
      return res.redirect(`https://${returnDomain}/admin/login?error=oauth`);
    }

    // 5. Find or create user in the correct database
    const db = tenantDbName ? getTenantDb(tenantDbName) : getSlabDb();
    const users = db.collection('users');
    let user = await users.findOne({ email: profile.email });

    if (!user) {
      const result = await users.insertOne({
        providerID: profile.id,
        provider: 'google',
        email: profile.email,
        displayName: profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim(),
        firstName: profile.given_name || '',
        lastName: profile.family_name || '',
        password: '',
        isAdmin: false,
        isW2Admin: false,
        tutorials: { seen: {}, dismissed: {}, autoPlay: true, lastReset: null },
        createdAt: new Date(),
      });
      user = await users.findOne({ _id: result.insertedId });
    }

    // ── Superadmin flow ──
    if (authType === 'superadmin') {
      if (!isSuperAdminEmail(user.email)) {
        return res.redirect(`https://${returnDomain}/superadmin/login?error=unauthorized`);
      }
      issueSuperAdminJWT(user, res);
      return res.redirect(`https://${returnDomain}/superadmin`);
    }

    // ── Client flow ──
    if (authType === 'client') {
      const updates = {};
      if (!user.role) updates.role = 'client';

      if (linkClientId && !user.clientId) {
        try {
          const client = await db.collection('clients').findOne({ _id: new ObjectId(linkClientId) });
          if (client) {
            updates.clientId = linkClientId;
            await db.collection('clients').updateOne(
              { _id: new ObjectId(linkClientId) },
              { $set: { userId: user._id.toString(), updatedAt: new Date() } }
            );
          }
        } catch {}
      }

      if (!updates.clientId && !user.clientId) {
        const clientByEmail = await db.collection('clients').findOne({ email: user.email.toLowerCase() });
        if (clientByEmail) {
          updates.clientId = clientByEmail._id.toString();
          await db.collection('clients').updateOne(
            { _id: clientByEmail._id },
            { $set: { userId: user._id.toString(), updatedAt: new Date() } }
          );
        }
      }

      if (Object.keys(updates).length) {
        await users.updateOne({ _id: user._id }, { $set: updates });
      }

      issuePortalJWT(user, res);
      return res.redirect(`https://${returnDomain}/onboard/account-linked`);
    }

    // ── Admin flow ──
    const isSuperUser = isSuperAdminEmail(user.email);

    if (!user.isW2Admin && !user.isAdmin && !isSuperUser) {
      return res.redirect(`https://${returnDomain}/admin/login?error=unauthorized`);
    }

    // Superadmin supersedes — grant admin access even if flags aren't set
    if (isSuperUser && !user.isAdmin) {
      user.isAdmin = true;
    }

    issueAdminJWT(user, res);
    if (isSuperUser) {
      issueSuperAdminJWT(user, res);
    }
    res.redirect(`https://${returnDomain}/admin`);
  } catch (err) {
    console.error('[auth] OAuth callback error:', err);
    res.redirect('/admin/login?error=oauth');
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  const domain = config.NODE_ENV === 'production' ? '.madladslab.com' : undefined;
  const opts = domain ? { domain } : {};
  res.clearCookie('slab_token', opts);
  res.clearCookie('slab_portal', opts);
  res.clearCookie('slab_super', opts);
  res.redirect('/admin/login');
});

export default router;
