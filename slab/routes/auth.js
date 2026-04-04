import express from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { issueAdminJWT, issuePortalJWT, createLoginToken } from '../middleware/jwtAuth.js';
import { isSuperAdminEmail } from '../middleware/superadmin.js';
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

    // 5. Find or create user — link Google to existing local account by email
    const db = tenantDbName ? getTenantDb(tenantDbName) : getSlabDb();
    const users = db.collection('users');
    let user = await users.findOne({ email: profile.email });

    if (user) {
      // Link Google provider to existing user if not already linked
      const updates = {};
      if (!user.googleId) updates.googleId = profile.id;
      if (!user.providers || !user.providers.includes('google')) {
        updates.providers = [...(user.providers || []), 'google'].filter((v, i, a) => a.indexOf(v) === i);
      }
      if (!user.displayName && profile.name) updates.displayName = profile.name;
      if (Object.keys(updates).length) {
        await users.updateOne({ _id: user._id }, { $set: updates });
        user = { ...user, ...updates };
      }
    } else {
      const result = await users.insertOne({
        googleId: profile.id,
        providers: ['google'],
        email: profile.email,
        displayName: profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim(),
        firstName: profile.given_name || '',
        lastName: profile.family_name || '',
        password: '',
        isAdmin: false,
        tutorials: { seen: {}, dismissed: {}, autoPlay: true, lastReset: null },
        createdAt: new Date(),
      });
      user = await users.findOne({ _id: result.insertedId });
    }

    // ── Central flow — find user's slabs, show picker or redirect ──
    if (authType === 'central') {
      return resolveSlabsAndRedirect(req, res, profile);
    }

    // ── Superadmin flow — issue a normal admin JWT, superadmin derived from email at request time ──
    if (authType === 'superadmin') {
      if (!isSuperAdminEmail(user.email)) {
        return res.redirect(`https://${returnDomain}/superadmin/login?error=unauthorized`);
      }
      user.isAdmin = true;
      issueAdminJWT(user, res, tenantDbName, returnDomain);
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

    if (!user.isAdmin && !isSuperUser && !user.isOwner) {
      return res.redirect(`https://${returnDomain}/admin/login?error=unauthorized`);
    }

    // Superadmin or owner supersedes — grant admin access
    if ((isSuperUser || user.isOwner) && !user.isAdmin) {
      user.isAdmin = true;
    }

    // Custom domains can't receive cookies from slab.madladslab.com callback.
    // Redirect with a one-time token — requireAdmin will exchange it for a cookie on the tenant domain.
    const isCustom = returnDomain && !returnDomain.endsWith('.madladslab.com') && returnDomain !== 'localhost';
    if (isCustom) {
      const { createLoginToken } = await import('../middleware/jwtAuth.js');
      const oneTimeToken = createLoginToken(user, tenantDbName, '2m');

      return res.redirect(`https://${returnDomain}/admin?token=${oneTimeToken}`);
    }

    issueAdminJWT(user, res, tenantDbName, returnDomain);
    res.redirect(`https://${returnDomain}/admin`);
  } catch (err) {
    console.error('[auth] OAuth callback error:', err);
    res.redirect('/admin/login?error=oauth');
  }
});

// ── Google One Tap / Sign In With Google (credential response) ──────────────
router.post('/google/one-tap', async (req, res) => {
  try {
    const { credential, mode } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing credential' });

    // Verify the Google ID token
    const creds = getOAuthCreds(req);
    const tokenInfo = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
    const profile = await tokenInfo.json();

    // Accept credential from either tenant or platform client ID
    const validAuds = [creds.clientId, config.GGLCID].filter(Boolean);
    if (!profile.email || !validAuds.includes(profile.aud)) {
      return res.status(401).json({ error: 'Invalid credential' });
    }

    // Find or create user
    const db = req.db || getSlabDb();
    const users = db.collection('users');
    let user = await users.findOne({ email: profile.email });

    if (user) {
      // Link Google if not already
      const updates = {};
      if (!user.googleId) updates.googleId = profile.sub;
      if (!user.providers?.includes('google')) {
        updates.providers = [...(user.providers || []), 'google'].filter((v, i, a) => a.indexOf(v) === i);
      }
      if (!user.displayName && profile.name) updates.displayName = profile.name;
      if (Object.keys(updates).length) {
        await users.updateOne({ _id: user._id }, { $set: updates });
        user = { ...user, ...updates };
      }
    } else if (mode === 'signup') {
      // Create new user from One Tap during signup
      const result = await users.insertOne({
        googleId: profile.sub,
        providers: ['google'],
        email: profile.email,
        displayName: profile.name || '',
        isAdmin: false,
        isOwner: false,
        tutorials: { seen: {}, dismissed: {}, autoPlay: true, lastReset: null },
        createdAt: new Date(),
      });
      user = await users.findOne({ _id: result.insertedId });
    } else {
      return res.status(401).json({ error: 'No account found. Please create an account first.' });
    }

    const isSuperUser = isSuperAdminEmail(user.email);
    if (!user.isAdmin && !isSuperUser && !user.isOwner) {
      return res.status(403).json({ error: 'Account exists but is not an admin. Contact your administrator.' });
    }
    if ((isSuperUser || user.isOwner) && !user.isAdmin) user.isAdmin = true;

    issueAdminJWT(user, res, req.tenant?.db, req.hostname);
    res.json({ ok: true, redirect: '/admin' });
  } catch (err) {
    console.error('[auth] One Tap error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CENTRAL AUTH FLOW — all Google auth runs through slab.madladslab.com
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Find every active tenant where this email has a user document.
 * Returns array of { tenantDb, domain, brandName, isAdmin, isOwner, userId }
 */
async function findSlabsForEmail(email) {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find({
    status: { $in: ['active', 'preview'] },
  }).toArray();

  const results = [];
  for (const t of tenants) {
    try {
      const db = getTenantDb(t.db);
      const user = await db.collection('users').findOne({ email });
      if (user) {
        results.push({
          tenantDb: t.db,
          domain: t.domain,
          brandName: t.brand?.name || t.domain,
          isAdmin: user.isAdmin || false,
          isOwner: user.isOwner || false,
          userId: user._id.toString(),
        });
      }
    } catch { /* skip unreachable tenant DBs */ }
  }
  return results;
}

/**
 * After auth, resolve user into a single tenant or show the picker.
 * Handles: 0 slabs (no account), 1 slab (auto-redirect), N slabs (picker).
 */
async function resolveSlabsAndRedirect(req, res, profile) {
  const email = profile.email.toLowerCase();
  const slabs = await findSlabsForEmail(email);

  if (slabs.length === 0) {
    return res.render('auth/central-login', {
      oauthCid: config.GGLCID || '',
      errorMsg: 'No workspace found for this Google account. Contact your administrator or sign up.',
    });
  }

  if (slabs.length === 1) {
    // Single slab — go straight there
    return redirectToSlab(res, slabs[0], profile);
  }

  // Multiple slabs — show picker
  // Create a short-lived picker token carrying the Google profile
  const pickerToken = jwt.sign({
    email: profile.email,
    googleId: profile.id || profile.sub,
    displayName: profile.name || '',
    picker: true,
  }, config.JWT_SECRET, { expiresIn: '10m' });

  res.render('auth/select-slab', { email: profile.email, slabs, pickerToken });
}

/**
 * Issue a one-time token for a specific tenant and redirect to their admin.
 */
async function redirectToSlab(res, slab, profile) {
  const db = getTenantDb(slab.tenantDb);
  let user = await db.collection('users').findOne({ email: profile.email || profile.email?.toLowerCase() });

  if (!user) {
    // Shouldn't happen (findSlabsForEmail found them), but handle gracefully
    return res.redirect('/auth/login?error=not_found');
  }

  // Ensure Google provider is linked
  const updates = {};
  const gid = profile.id || profile.sub;
  if (gid && !user.googleId) updates.googleId = gid;
  if (!user.providers?.includes('google')) {
    updates.providers = [...(user.providers || []), 'google'].filter((v, i, a) => a.indexOf(v) === i);
  }
  if (!user.displayName && profile.name) updates.displayName = profile.name;
  if (Object.keys(updates).length) {
    await db.collection('users').updateOne({ _id: user._id }, { $set: updates });
    user = { ...user, ...updates };
  }

  // Superadmin or owner supersedes
  const isSuperUser = isSuperAdminEmail(user.email);
  if ((isSuperUser || user.isOwner) && !user.isAdmin) user.isAdmin = true;

  if (!user.isAdmin && !isSuperUser && !user.isOwner) {
    return res.redirect('/auth/login?error=unauthorized');
  }

  // Always use one-time token redirect (central domain → tenant domain)
  const token = createLoginToken(user, slab.tenantDb, '2m');
  const targetDomain = slab.domain.includes('://') ? slab.domain : `https://${slab.domain}`;
  res.redirect(`${targetDomain}/admin?token=${token}`);
}

// ── Central login page (slab.madladslab.com/auth/login) ─────────────────────
router.get('/login', (req, res) => {
  const error = req.query.error;
  let errorMsg = null;
  if (error === 'unauthorized') errorMsg = 'Your account does not have admin access to that workspace.';
  if (error === 'not_found') errorMsg = 'Account not found. Please try again.';
  if (error === 'oauth') errorMsg = 'Google sign-in failed. Please try again.';
  if (error === 'expired') errorMsg = 'Session expired. Please sign in again.';
  res.render('auth/central-login', { oauthCid: config.GGLCID || '', errorMsg });
});

// ── Central email/password login — find slab by email, verify, redirect ─────
router.post('/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const cleanEmail = email.toLowerCase().trim();
    const slabs = await findSlabsForEmail(cleanEmail);

    if (slabs.length === 0) {
      return res.status(401).json({ error: 'No workspace found for this email.' });
    }

    // Try to verify password against each slab the user belongs to
    const bcrypt = (await import('bcrypt')).default;
    let matchedSlab = null;
    let matchedUser = null;

    for (const slab of slabs) {
      try {
        const db = getTenantDb(slab.tenantDb);
        const user = await db.collection('users').findOne({ email: cleanEmail });
        if (user && user.password) {
          const valid = await bcrypt.compare(password, user.password);
          if (valid) {
            matchedSlab = slab;
            matchedUser = user;
            break;
          }
        }
      } catch { /* skip */ }
    }

    if (!matchedUser) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Issue a one-time token to redirect into the matched slab
    const isSuperUser = isSuperAdminEmail(matchedUser.email);
    if ((isSuperUser || matchedUser.isOwner) && !matchedUser.isAdmin) matchedUser.isAdmin = true;

    if (!matchedUser.isAdmin && !isSuperUser && !matchedUser.isOwner) {
      return res.status(403).json({ error: 'Your account does not have admin access to that workspace.' });
    }

    const token = createLoginToken(matchedUser, matchedSlab.tenantDb, '2m');
    const targetDomain = matchedSlab.domain.includes('://') ? matchedSlab.domain : `https://${matchedSlab.domain}`;

    // If user has multiple slabs, return them all so frontend can show picker
    if (slabs.length > 1) {
      return res.json({
        ok: true,
        multiple: true,
        redirect: `${targetDomain}/admin?token=${token}`,
        slabs: slabs.map(s => ({
          domain: s.domain,
          brandName: s.brandName,
          tenantDb: s.tenantDb,
        })),
        email: cleanEmail,
      });
    }

    res.json({ ok: true, redirect: `${targetDomain}/admin?token=${token}` });
  } catch (err) {
    console.error('[auth] Central login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── Central email login — pick a specific slab (for multi-slab users) ──────
router.post('/login/pick-slab', express.json(), async (req, res) => {
  try {
    const { email, password, tenantDb } = req.body;
    if (!email || !password || !tenantDb) return res.status(400).json({ error: 'Missing fields' });

    const cleanEmail = email.toLowerCase().trim();
    const bcrypt = (await import('bcrypt')).default;
    const db = getTenantDb(tenantDb);
    const user = await db.collection('users').findOne({ email: cleanEmail });

    if (!user || !user.password) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const isSuperUser = isSuperAdminEmail(user.email);
    if ((isSuperUser || user.isOwner) && !user.isAdmin) user.isAdmin = true;
    if (!user.isAdmin && !isSuperUser && !user.isOwner) {
      return res.status(403).json({ error: 'No admin access to this workspace.' });
    }

    // Look up the domain for this tenantDb
    const slab = getSlabDb();
    const tenantDoc = await slab.collection('tenants').findOne({ db: tenantDb });
    if (!tenantDoc) return res.status(404).json({ error: 'Workspace not found' });

    const token = createLoginToken(user, tenantDb, '2m');
    const targetDomain = tenantDoc.domain.includes('://') ? tenantDoc.domain : `https://${tenantDoc.domain}`;
    res.json({ ok: true, redirect: `${targetDomain}/admin?token=${token}` });
  } catch (err) {
    console.error('[auth] Pick-slab login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Central Google OAuth redirect — always uses platform creds ──────────────
router.get('/google/central', (req, res) => {
  const callbackUrl = `${config.DOMAIN}/auth/google/callback`;
  const state = buildState({
    authType: 'central',
    returnDomain: 'slab.madladslab.com',
    tenantDbName: null,
    oauthSource: 'platform',
    callbackUrl,
  });

  const params = new URLSearchParams({
    client_id: config.GGLCID,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'profile email openid',
    prompt: 'select_account',
    access_type: 'online',
    state,
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

// ── Central One-Tap (POST from slab.madladslab.com/auth/login) ──────────────
router.post('/google/one-tap-central', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing credential' });

    // Verify the Google ID token
    const tokenInfo = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
    const profile = await tokenInfo.json();

    if (!profile.email || profile.aud !== config.GGLCID) {
      return res.status(401).json({ error: 'Invalid credential' });
    }

    // Find slabs for this email
    const email = profile.email.toLowerCase();
    const slabs = await findSlabsForEmail(email);

    if (slabs.length === 0) {
      return res.json({ error: 'No workspace found for this Google account.' });
    }

    if (slabs.length === 1) {
      // Single slab — build redirect URL
      const slab = slabs[0];
      const db = getTenantDb(slab.tenantDb);
      let user = await db.collection('users').findOne({ email });
      if (!user) return res.json({ error: 'Account not found.' });

      const isSuperUser = isSuperAdminEmail(user.email);
      if ((isSuperUser || user.isOwner) && !user.isAdmin) user.isAdmin = true;
      if (!user.isAdmin && !isSuperUser && !user.isOwner) {
        return res.json({ error: 'Your account does not have admin access.' });
      }

      const token = createLoginToken(user, slab.tenantDb, '2m');
      const targetDomain = slab.domain.includes('://') ? slab.domain : `https://${slab.domain}`;
      return res.json({ ok: true, redirect: `${targetDomain}/admin?token=${token}` });
    }

    // Multiple slabs — send picker token, frontend redirects to picker page
    const pickerToken = jwt.sign({
      email: profile.email,
      googleId: profile.sub,
      displayName: profile.name || '',
      picker: true,
    }, config.JWT_SECRET, { expiresIn: '10m' });

    return res.json({ ok: true, redirect: `/auth/select-slab?t=${encodeURIComponent(pickerToken)}` });
  } catch (err) {
    console.error('[auth] Central One-Tap error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ── Slab picker page (GET — for multi-slab users after one-tap) ─────────────
router.get('/select-slab', async (req, res) => {
  try {
    const { t } = req.query;
    if (!t) return res.redirect('/auth/login?error=expired');

    const payload = jwt.verify(t, config.JWT_SECRET);
    if (!payload.picker) return res.redirect('/auth/login?error=expired');

    const slabs = await findSlabsForEmail(payload.email.toLowerCase());
    if (slabs.length === 0) return res.redirect('/auth/login?error=not_found');

    res.render('auth/select-slab', { email: payload.email, slabs, pickerToken: t });
  } catch {
    res.redirect('/auth/login?error=expired');
  }
});

// ── Enter slab (from picker selection) ──────────────────────────────────────
router.get('/enter-slab', async (req, res) => {
  try {
    const { t, slab: tenantDb } = req.query;
    if (!t || !tenantDb) return res.redirect('/auth/login?error=expired');

    const payload = jwt.verify(t, config.JWT_SECRET);
    if (!payload.picker) return res.redirect('/auth/login?error=expired');

    // Verify the requested slab is valid for this user
    const slabs = await findSlabsForEmail(payload.email.toLowerCase());
    const chosen = slabs.find(s => s.tenantDb === tenantDb);
    if (!chosen) return res.redirect('/auth/login?error=unauthorized');

    await redirectToSlab(res, chosen, {
      email: payload.email,
      id: payload.googleId,
      sub: payload.googleId,
      name: payload.displayName,
    });
  } catch {
    res.redirect('/auth/login?error=expired');
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  const domain = config.NODE_ENV === 'production' ? '.madladslab.com' : undefined;
  const opts = domain ? { domain } : {};
  res.clearCookie('slab_token', opts);
  res.clearCookie('slab_portal', opts);
  // Also clear on exact domain for custom domain tenants
  res.clearCookie('slab_token');
  res.clearCookie('slab_portal');
  res.redirect('/admin/login');
});

export default router;
