import express from 'express';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';
import { config } from '../../../config/config.js';
import { callLLM, tryParseAgentResponse, hasCJK, stripCJK } from '../../../plugins/agentMcp.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { logActivity } from '../../../plugins/activityLog.js';
import {
  PLATFORMS, PLATFORM_LIST, LIVE_PLATFORMS,
  packCredentials, unpackCredentials, maskAccount, isAccountConfigured,
  publishToPlatform, publishPost, verifyPlatform, discoverInstagramFromPage,
} from '../../../plugins/socialPublish.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { fetchEngagement, postReply, allEngageCaps, engageCaps } from '../../../plugins/socialEngage.js';
import { encrypt, decrypt } from '../../../plugins/crypto.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng } from '../../../plugins/autoSocial.js';
import { uploadBuffer } from '../../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../../plugins/socialDesign.js';
import { suggestSlots } from '../../../plugins/socialSchedule.js';
import { fetchAllFollows, followsAction } from '../../../plugins/socialFollows.js';
import {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseMedia, publishPostBackground, loadAccountMap,
} from './shared.js';

const router = express.Router();

// ── Mark a data-deletion request completed ────────────────────────────────────
router.post('/deletion/:id/complete', async (req, res) => {
  const db = req.db;
  await db.collection('deletion_requests').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: 'completed', completedAt: new Date() } },
  );
  res.redirect('/admin/settings?saved=Marked+completed');
});

// ── Save / connect a platform's credentials ──────────────────────────────────
router.post('/connections/:platform', async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  const def = PLATFORMS[platform];
  const json = wantsJson(req);
  if (!def) return json ? res.json({ ok: false, error: 'Unknown platform' }) : res.redirect('/admin/settings?error=Unknown+platform');

  try {
    const existing = await db.collection('social_accounts').findOne({ platform });
    const { credentials, secrets } = packCredentials(platform, req.body, existing || {});

    const set = {
      platform,
      label: (req.body.label || '').trim() || def.name,
      credentials,
      secrets,
      enabled: req.body.enabled !== 'off',
      updatedAt: new Date(),
    };
    if (!existing) set.connectedAt = new Date();

    await db.collection('social_accounts').updateOne(
      { platform },
      { $set: set },
      { upsert: true },
    );

    // Auto-upgrade Meta tokens to long-lived/permanent right after save.
    await tryAutoUpgrade(db, platform);

    // Connecting Facebook auto-links its Instagram Business account (best-effort,
    // never breaks the save). One Meta app → no re-pasting the IG User ID.
    if (platform === 'facebook') {
      try { await linkInstagramFromFacebook(db); }
      catch (e) { console.warn('[social] auto IG link failed:', e.message); }
    }

    logActivity({
      category: 'social', action: 'connection_saved',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform }, ip: req.ip,
    });

    if (json) {
      const saved = await db.collection('social_accounts').findOne({ platform });
      return res.json({ ok: true, account: maskAccount(saved) });
    }
    res.redirect(`/admin/settings?saved=${encodeURIComponent(def.name + ' saved')}`);
  } catch (err) {
    console.error('[social] save connection error:', err);
    if (json) return res.json({ ok: false, error: err.message || 'Save failed' });
    res.redirect('/admin/settings?error=' + encodeURIComponent(err.message || 'Save failed'));
  }
});

// ── Disconnect a platform ─────────────────────────────────────────────────────
router.post('/connections/:platform/disconnect', async (req, res) => {
  const db = req.db;
  await db.collection('social_accounts').deleteOne({ platform: req.params.platform });
  res.redirect('/admin/settings?saved=Disconnected');
});

// ── Test a platform connection (publishes nothing — validates creds) ──────────
router.post('/connections/:platform/test', async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  const def = PLATFORMS[platform];
  if (!def) return res.json({ ok: false, error: 'Unknown platform' });
  if (def.comingSoon) return res.json({ ok: false, error: `${def.name} is not available yet` });

  try {
    const account = await db.collection('social_accounts').findOne({ platform });
    if (!account || !isAccountConfigured(account)) return res.json({ ok: false, error: 'Missing credentials' });

    // Non-destructive, read-only credential check (no posting).
    const result = await verifyPlatform(platform, account);

    await db.collection('social_accounts').updateOne(
      { platform },
      { $set: { lastTestOk: result.ok, lastTestAt: new Date(), ...(result.profile ? { profile: result.profile } : {}) } },
    );
    logActivity({
      category: 'social', action: 'connection_verified',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: result.ok ? 'success' : 'failed',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform }, error: result.ok ? undefined : result.error, ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    console.warn('[social/test] ' + platform + ' failed: ' + err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ── Make a token permanent / long-lived now (manual trigger) ──────────────────
router.post('/connections/:platform/upgrade', async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  if (!AUTO_TOKEN_PLATFORMS.has(platform)) return res.json({ ok: false, error: 'Not supported for this platform' });
  try {
    const acct = await db.collection('social_accounts').findOne({ platform });
    if (!acct) return res.json({ ok: false, error: 'Not connected' });
    const fb = platform === 'facebook' ? acct : await db.collection('social_accounts').findOne({ platform: 'facebook' });
    const appCreds = {
      appId: fb?.credentials?.appId || null,
      appSecret: fb?.secrets?.appSecret ? decrypt(fb.secrets.appSecret) : null,
    };
    const result = await refreshAccount(acct, appCreds);
    if (result?.skipped) return res.json({ ok: false, error: result.skipped });
    await applyRefresh(db, platform, result);
    const fresh = await db.collection('social_accounts').findOne({ platform });
    const permanent = fresh.tokenType === 'PAGE' && !fresh.tokenExpiresAt;
    res.json({
      ok: true, permanent,
      expiresAt: fresh.tokenExpiresAt || null,
      note: permanent ? 'Token is now permanent (never expires).'
        : fresh.tokenExpiresAt ? `Renewed — auto-renews before ${new Date(fresh.tokenExpiresAt).toLocaleDateString()}.`
        : 'Token upgraded.',
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Meta: auto-link Instagram from the connected Facebook Page ────────────────
// One Meta app covers Facebook + Instagram. This discovers the IG Business
// account linked to the saved Facebook Page and fills it in — no manual IG User
// ID hunting, no re-pasted token. Safe to call repeatedly (non-destructive).
router.post('/connections/meta/link-instagram', async (req, res) => {
  try {
    const r = await linkInstagramFromFacebook(req.db);
    if (r.ok) {
      logActivity({
        category: 'social', action: 'meta_ig_linked',
        tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
        actor: { email: req.adminUser?.email, role: 'admin' },
        details: { igUserId: r.igUserId, seededToken: r.seededToken }, ip: req.ip,
      });
    }
    res.json(r);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── LinkedIn Author URN resolver ──────────────────────────────────────────────
// Fetch the member's person URN from LinkedIn's userinfo endpoint using the
// pasted (or already-saved) access token. Single read-only call — no posting,
// no login flow. Lets admins fill the Author URN field without hunting for
// their numeric member id. Body: { accessToken? }.
router.post('/linkedin/urn', express.json(), async (req, res) => {
  try {
    let token = (req.body && typeof req.body.accessToken === 'string') ? req.body.accessToken.trim() : '';
    // Fall back to the saved LinkedIn token when the field is blank or masked.
    if (!token || token.startsWith('••••')) {
      const acct = await req.db.collection('social_accounts').findOne({ platform: 'linkedin' });
      const creds = acct ? unpackCredentials(acct) : {};
      token = creds.accessToken || '';
    }
    if (!token) return res.json({ ok: false, error: 'Enter or save a LinkedIn access token first' });
    const auth = { Authorization: `Bearer ${token}` };

    // 1) OpenID Connect userinfo — needs `openid profile`. Returns `sub` + name.
    const r1 = await fetch('https://api.linkedin.com/v2/userinfo', { headers: auth, signal: AbortSignal.timeout(15000) });
    const j1 = await r1.json().catch(() => ({}));
    if (r1.ok && j1.sub) {
      return res.json({ ok: true, urn: `urn:li:person:${j1.sub}`, sub: j1.sub, name: j1.name || j1.given_name || null, via: 'userinfo' });
    }

    // 2) Legacy /v2/me — needs `r_liteprofile` (or `profile`). Returns `id`.
    const r2 = await fetch('https://api.linkedin.com/v2/me', {
      headers: { ...auth, 'X-Restli-Protocol-Version': '2.0.0' }, signal: AbortSignal.timeout(15000),
    });
    const j2 = await r2.json().catch(() => ({}));
    if (r2.ok && j2.id) {
      const name = [j2.localizedFirstName, j2.localizedLastName].filter(Boolean).join(' ') || null;
      return res.json({ ok: true, urn: `urn:li:person:${j2.id}`, sub: j2.id, name, via: 'me' });
    }

    // Both failed — distinguish a DEAD token (401) from a SCOPE gap (403).
    const detail = j1.message || j2.message || `HTTP ${r1.status}/${r2.status}`;
    if (r1.status === 401 || r2.status === 401) {
      return res.json({
        ok: false,
        error: detail + ' — the access token is invalid or expired (401). Generate a fresh token in the LinkedIn Token Generator, then paste it into the Access Token field above (replace the •••• dots) BEFORE clicking Fetch.',
      });
    }
    res.json({
      ok: false,
      error: detail + ' — the token is valid but missing a profile scope. In the LinkedIn Token Generator, add the "Sign In with LinkedIn using OpenID Connect" product and re-issue with `openid profile` (or `r_liteprofile`) checked.',
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── LinkedIn token introspection — read the ACTUAL scopes on a token ──────────
// Calls LinkedIn's introspectToken endpoint with the app's client id/secret to
// return the token's real scope list + status. Ends the "does my token have
// openid/profile?" guessing. Body: { accessToken?, clientId?, clientSecret? };
// blank/masked values fall back to the saved LinkedIn account.
router.post('/linkedin/introspect', express.json(), async (req, res) => {
  try {
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'linkedin' });
    const saved = acct ? unpackCredentials(acct) : {};
    let token = (req.body?.accessToken || '').trim();
    if (!token || token.startsWith('••••')) token = saved.accessToken || '';
    let clientId = (req.body?.clientId || '').trim() || saved.clientId || '';
    let clientSecret = (req.body?.clientSecret || '').trim();
    if (!clientSecret || clientSecret.startsWith('••••')) clientSecret = saved.clientSecret || '';

    if (!token) return res.json({ ok: false, error: 'No access token to check — paste one above first' });
    if (!clientId || !clientSecret) return res.json({ ok: false, error: 'Enter your app Client ID and Client Secret (in the fields above) to check token scopes' });

    const r = await fetch('https://www.linkedin.com/oauth/v2/introspectToken', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.json({ ok: false, error: j.error_description || j.message || `introspect HTTP ${r.status}` });
    res.json({
      ok: true,
      active: j.active === true || j.status === 'active',
      status: j.status || (j.active ? 'active' : 'inactive'),
      scope: j.scope || '',
      expiresAt: j.expires_at ? new Date(j.expires_at * 1000).toISOString() : null,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});


export default router;
