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

// ── Google OAuth connect flow (Google Business + YouTube share one client) ────
// ?product=youtube requests the YouTube scope; default is Google Business. The
// OAuth client always lives on the Google Business connection — one Cloud project.
router.get('/google/connect', async (req, res) => {
  try {
    const product = req.query.product === 'youtube' ? 'youtube' : 'business';
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'googlebusiness' });
    const creds = acct ? unpackCredentials(acct) : {};
    if (!creds.clientId || !creds.clientSecret) {
      return res.send('Save your Google OAuth Client ID & Secret first under Connections → Google Business (YouTube reuses the same client), then click Connect.');
    }
    const redirectUri = `https://${req.get('host')}/admin/social/google/callback`;
    const scope = product === 'youtube'
      // force-ssl covers Live Streaming (create/transition broadcasts) + upload covers VOD.
      ? 'https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.upload'
      : 'https://www.googleapis.com/auth/business.manage';
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: product,
    }).toString();
    res.redirect(url);
  } catch (e) { res.status(500).send('Google connect error: ' + e.message); }
});

router.get('/google/callback', async (req, res) => {
  try {
    const product = req.query.state === 'youtube' ? 'youtube' : 'business';
    if (!req.query.code) {
      const reason = req.query.error || 'denied';
      const desc = req.query.error_description ? ' (' + req.query.error_description + ')' : '';
      console.warn('[google/callback] no code; error=' + reason + desc);
      return res.redirect('/admin/settings?error=' + encodeURIComponent(reason));
    }
    // The OAuth client always comes from the Google Business connection (shared).
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'googlebusiness' });
    const creds = acct ? unpackCredentials(acct) : {};
    const redirectUri = `https://${req.get('host')}/admin/social/google/callback`;
    // 1. exchange code for tokens
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: req.query.code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(15000),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tj.refresh_token) return res.redirect('/admin/settings?error=norefresh');

    // ── YouTube: store into its own account, copying the shared Google client so
    //    verify/publish stay self-contained. Discover the channel id best-effort.
    if (product === 'youtube') {
      let channelId = '';
      try {
        const cr = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15000) });
        const cj = await cr.json().catch(() => ({}));
        channelId = cj.items?.[0]?.id || '';
      } catch { /* channel id can be added manually */ }
      // Which scopes did Google ACTUALLY grant? The token response lists them.
      // Live streaming needs youtube.force-ssl; Google silently DROPS a scope it
      // won't grant (e.g. it isn't registered on the OAuth consent screen, or the
      // user unchecked it on the granular-consent dialog) while still granting the
      // rest — so a "successful" connect can quietly lack live permission and only
      // 403 later at broadcast time. Detect it here and say so at connect time.
      const grantedScopes = (tj.scope || '').split(/\s+/).filter(Boolean);
      const hasLiveScope = grantedScopes.includes('https://www.googleapis.com/auth/youtube.force-ssl');
      const yt = await req.db.collection('social_accounts').findOne({ platform: 'youtube' });
      const { credentials, secrets } = packCredentials('youtube', { channelId, refreshToken: tj.refresh_token }, yt || {});
      credentials.clientId = creds.clientId;              // shared client — not a field, not re-entered
      secrets.clientSecret = encrypt(creds.clientSecret);
      await req.db.collection('social_accounts').updateOne(
        { platform: 'youtube' },
        // liveEnabled drives the UI's "live ready?" hint; upload/VOD still works without force-ssl.
        { $set: { platform: 'youtube', label: 'YouTube', credentials, secrets, enabled: true, liveEnabled: hasLiveScope, grantedScopes, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      if (!hasLiveScope) {
        // Stored (uploads still work) but LIVE won't — surface the exact fix loudly.
        return res.redirect('/admin/settings?error=' + encodeURIComponent(
          'YouTube connected, but LIVE streaming permission was NOT granted (missing youtube.force-ssl). ' +
          'Google only grants scopes registered on your OAuth consent screen — in Google Cloud Console → APIs & Services → OAuth consent screen, ADD the scope ' +
          'https://www.googleapis.com/auth/youtube.force-ssl, save, then reconnect YouTube and approve every permission on the consent screen.'));
      }
      return res.redirect('/admin/settings?saved=' + encodeURIComponent('YouTube connected' + (channelId ? '' : ' — add your Channel ID')));
    }

    // 2. auto-discover account + first location (best-effort; needs APIs enabled)
    let accountId = creds.accountId || '', locationId = creds.locationId || '';
    try {
      const ar = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15000) });
      const aj = await ar.json().catch(() => ({}));
      const acctName = aj.accounts?.[0]?.name || '';
      if (acctName) {
        accountId = acctName.split('/')[1] || accountId;
        const lr = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${acctName}/locations?readMask=name&pageSize=1`, { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15000) });
        const lj = await lr.json().catch(() => ({}));
        const locName = lj.locations?.[0]?.name || '';
        if (locName) locationId = locName.split('/').pop() || locationId;
      }
    } catch { /* IDs can be filled manually if discovery is gated */ }
    // 3. store (refreshToken encrypted via packCredentials)
    const { credentials, secrets } = packCredentials('googlebusiness', { refreshToken: tj.refresh_token, accountId, locationId }, acct || {});
    await req.db.collection('social_accounts').updateOne(
      { platform: 'googlebusiness' },
      { $set: { platform: 'googlebusiness', credentials, secrets, enabled: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    res.redirect('/admin/settings?gconnected=1' + (accountId && locationId ? '' : '&gids=manual'));
  } catch (e) { res.status(500).send('Google connect failed: ' + e.message); }
});

// ── Facebook (Meta) OAuth connect flow ────────────────────────────────────────
// Facebook Login → a long-lived PAGE token that carries publish_video (required
// for Facebook Live) plus the Page/Instagram publishing scopes, auto-discovering
// the Page (no manual token pasting, no monthly expiry). Reuses the App ID/Secret
// already saved on the Facebook connection — one Meta app powers FB/IG/Threads.
const FB_GRAPH_V = 'https://graph.facebook.com/v21.0';
const FB_LOGIN_SCOPES = [
  'pages_show_list', 'pages_manage_posts', 'pages_read_engagement',
  'pages_manage_metadata', 'pages_manage_engagement',
  'publish_video',                 // ← Facebook Live (create live_videos)
  'business_management', 'read_insights',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments',
].join(',');

router.get('/facebook/connect', async (req, res) => {
  try {
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'facebook' });
    const creds = acct ? unpackCredentials(acct) : {};
    if (!creds.appId || !creds.appSecret) {
      return res.send('Save your Meta App ID & App Secret first under Connections → Facebook Page (the App ID / App Secret fields), then click "Connect with Facebook".');
    }
    const redirectUri = `https://${req.get('host')}/admin/social/facebook/callback`;
    const url = 'https://www.facebook.com/v21.0/dialog/oauth?' + new URLSearchParams({
      client_id: creds.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: FB_LOGIN_SCOPES,
      state: 'fb',
    }).toString();
    res.redirect(url);
  } catch (e) { res.status(500).send('Facebook connect error: ' + e.message); }
});

router.get('/facebook/callback', async (req, res) => {
  try {
    if (!req.query.code) {
      const reason = req.query.error_description || req.query.error || 'cancelled';
      return res.redirect('/admin/settings?error=' + encodeURIComponent('Facebook connect ' + reason));
    }
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'facebook' });
    const creds = acct ? unpackCredentials(acct) : {};
    if (!creds.appId || !creds.appSecret) return res.redirect('/admin/settings?error=' + encodeURIComponent('Save your Meta App ID & Secret first'));
    const redirectUri = `https://${req.get('host')}/admin/social/facebook/callback`;

    // 1. code → short-lived user token
    const tr = await fetch(`${FB_GRAPH_V}/oauth/access_token?` + new URLSearchParams({
      client_id: creds.appId, client_secret: creds.appSecret, redirect_uri: redirectUri, code: req.query.code,
    }).toString(), { signal: AbortSignal.timeout(15000) });
    const tj = await tr.json().catch(() => ({}));
    if (!tj.access_token) return res.redirect('/admin/settings?error=' + encodeURIComponent('Facebook token exchange failed: ' + (tj.error?.message || tr.status)));

    // 2. short-lived → long-lived user token (Page tokens minted from it don't expire)
    const lr = await fetch(`${FB_GRAPH_V}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: creds.appId, client_secret: creds.appSecret, fb_exchange_token: tj.access_token,
    }).toString(), { signal: AbortSignal.timeout(15000) });
    const lj = await lr.json().catch(() => ({}));
    const userToken = lj.access_token || tj.access_token;

    // 3. list Pages — each carries its own Page access token
    const pr = await fetch(`${FB_GRAPH_V}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`, { signal: AbortSignal.timeout(15000) });
    const pj = await pr.json().catch(() => ({}));
    const pages = pj.data || [];
    if (!pages.length) return res.redirect('/admin/settings?error=' + encodeURIComponent('No Facebook Pages found — on the consent screen, grant access to your Page, then reconnect.'));
    // Keep the previously-chosen Page if it's still listed, else default to the first.
    const page = pages.find(p => p.id === creds.pageId) || pages[0];

    // 4. confirm publish_video was actually granted (granular consent can drop it) via debug_token
    let hasLive = false;
    try {
      const appToken = `${creds.appId}|${creds.appSecret}`;
      const dr = await fetch(`${FB_GRAPH_V}/debug_token?input_token=${encodeURIComponent(page.access_token)}&access_token=${encodeURIComponent(appToken)}`, { signal: AbortSignal.timeout(15000) });
      const dj = await dr.json().catch(() => ({}));
      hasLive = (dj.data?.scopes || []).includes('publish_video');
    } catch { /* non-fatal — fall through with hasLive=false */ }

    // 5. store the Page id + long-lived token (app creds preserved by packCredentials)
    const { credentials, secrets } = packCredentials('facebook', { pageId: page.id, pageAccessToken: page.access_token }, acct || {});
    await req.db.collection('social_accounts').updateOne(
      { platform: 'facebook' },
      { $set: { platform: 'facebook', label: acct?.label || 'Facebook Page', credentials, secrets,
        enabled: true, liveEnabled: hasLive, tokenType: 'PAGE', tokenManaged: true, updatedAt: new Date(),
        profile: { ...(acct?.profile || {}), name: page.name, url: `https://facebook.com/${page.id}` } },
        $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    // A Page token minted from a long-lived user token doesn't expire — drop any stale expiry marker.
    await req.db.collection('social_accounts').updateOne({ platform: 'facebook' }, { $unset: { tokenExpiresAt: '' } });

    // 6. auto-link Instagram from the freshly-saved Page (best-effort, never breaks connect)
    try { await linkInstagramFromFacebook(req.db); } catch (e) { console.warn('[facebook/callback] IG link failed:', e.message); }

    logActivity({
      category: 'social', action: 'connection_saved',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform: 'facebook', via: 'oauth', live: hasLive }, ip: req.ip,
    });

    if (!hasLive) {
      return res.redirect('/admin/settings?error=' + encodeURIComponent(
        `Facebook connected as "${page.name}", but LIVE video permission (publish_video) was NOT granted — Facebook Live won't work. ` +
        `Reconnect and approve "publish_video" on the consent screen. If it isn't offered, add publish_video to your app under App Review → Permissions and Features.`));
    }
    return res.redirect('/admin/settings?saved=' + encodeURIComponent(`Facebook connected as "${page.name}" — Live ready`));
  } catch (e) { res.status(500).send('Facebook connect failed: ' + e.message); }
});

// ── LinkedIn OAuth connect flow ───────────────────────────────────────────────
// One click → an access token AND the author URN, resolved from the token's own
// profile. Kills the Token-Generator + "find my urn:li:person id" two-step. Reuses
// the Client ID/Secret already saved (optional fields) on the LinkedIn connection.
// Member tokens last ~60 days with no refresh path — reconnecting re-issues one.
const LINKEDIN_SCOPES = 'openid profile w_member_social';

router.get('/linkedin/connect', async (req, res) => {
  try {
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'linkedin' });
    const creds = acct ? unpackCredentials(acct) : {};
    if (!creds.clientId || !creds.clientSecret) {
      return res.send('Save your LinkedIn app Client ID & Client Secret first under Connections → LinkedIn (the optional fields), then click "Connect with LinkedIn".');
    }
    const redirectUri = `https://${req.get('host')}/admin/social/linkedin/callback`;
    const url = 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
      response_type: 'code', client_id: creds.clientId, redirect_uri: redirectUri,
      scope: LINKEDIN_SCOPES, state: 'li',
    }).toString();
    res.redirect(url);
  } catch (e) { res.status(500).send('LinkedIn connect error: ' + e.message); }
});

router.get('/linkedin/callback', async (req, res) => {
  const back = (msg, ok = false) => res.redirect('/admin/settings?' + (ok ? 'saved' : 'error') + '=' + encodeURIComponent(msg));
  try {
    if (!req.query.code) return back('LinkedIn connect ' + (req.query.error_description || req.query.error || 'cancelled'));
    const acct = await req.db.collection('social_accounts').findOne({ platform: 'linkedin' });
    const creds = acct ? unpackCredentials(acct) : {};
    if (!creds.clientId || !creds.clientSecret) return back('Save your LinkedIn Client ID & Secret first');
    const redirectUri = `https://${req.get('host')}/admin/social/linkedin/callback`;

    // 1. code → access token
    const tr = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: req.query.code, redirect_uri: redirectUri,
        client_id: creds.clientId, client_secret: creds.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tj.access_token) return back('LinkedIn token exchange failed: ' + (tj.error_description || tj.error || tr.status));

    // 2. resolve the member's author URN from the token itself (needs openid/profile)
    let authorUrn = creds.authorUrn || '', name = null;
    try {
      const ur = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15000) });
      const uj = await ur.json().catch(() => ({}));
      if (uj.sub) { authorUrn = `urn:li:person:${uj.sub}`; name = uj.name || uj.given_name || null; }
    } catch { /* URN may already be saved; fall through */ }
    if (!authorUrn) return back('Connected, but could not read your LinkedIn profile — add the "Sign In with LinkedIn using OpenID Connect" product to your app, then reconnect.');

    // 3. store token + URN (Client ID/Secret preserved by packCredentials)
    const { credentials, secrets } = packCredentials('linkedin', { authorUrn, accessToken: tj.access_token }, acct || {});
    const expiresAt = tj.expires_in ? new Date(Date.now() + tj.expires_in * 1000) : null;
    await req.db.collection('social_accounts').updateOne(
      { platform: 'linkedin' },
      { $set: { platform: 'linkedin', label: acct?.label || 'LinkedIn', credentials, secrets,
        enabled: true, tokenExpiresAt: expiresAt, updatedAt: new Date(),
        ...(name ? { profile: { ...(acct?.profile || {}), name } } : {}) },
        $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    logActivity({
      category: 'social', action: 'connection_saved',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform: 'linkedin', via: 'oauth' }, ip: req.ip,
    });
    return back(`LinkedIn connected${name ? ' as ' + name : ''}. Token lasts ~60 days — reconnect when a post fails with 401.`, true);
  } catch (e) { res.status(500).send('LinkedIn connect failed: ' + e.message); }
});

// ── Threads OAuth connect flow ────────────────────────────────────────────────
// Threads rides the SAME Meta app as Facebook/Instagram — it reuses the App ID/
// Secret saved on the Facebook connection. One click → the Threads user id + a
// long-lived (60-day) token that the daily cron auto-refreshes from here on.
const THREADS_SCOPES = 'threads_basic,threads_content_publish';

router.get('/threads/connect', async (req, res) => {
  try {
    const fb = await req.db.collection('social_accounts').findOne({ platform: 'facebook' });
    const creds = fb ? unpackCredentials(fb) : {};
    if (!creds.appId || !creds.appSecret) {
      return res.send('Save your Meta App ID & App Secret first under Connections → Facebook Page (Threads shares the same Meta app), then click "Connect with Threads".');
    }
    const redirectUri = `https://${req.get('host')}/admin/social/threads/callback`;
    const url = 'https://threads.net/oauth/authorize?' + new URLSearchParams({
      client_id: creds.appId, redirect_uri: redirectUri, response_type: 'code',
      scope: THREADS_SCOPES, state: 'th',
    }).toString();
    res.redirect(url);
  } catch (e) { res.status(500).send('Threads connect error: ' + e.message); }
});

router.get('/threads/callback', async (req, res) => {
  const back = (msg, ok = false) => res.redirect('/admin/settings?' + (ok ? 'saved' : 'error') + '=' + encodeURIComponent(msg));
  try {
    if (!req.query.code) return back('Threads connect ' + (req.query.error_description || req.query.error || 'cancelled'));
    const fb = await req.db.collection('social_accounts').findOne({ platform: 'facebook' });
    const creds = fb ? unpackCredentials(fb) : {};
    if (!creds.appId || !creds.appSecret) return back('Save your Meta App ID & Secret under Facebook first');
    const redirectUri = `https://${req.get('host')}/admin/social/threads/callback`;

    // 1. code → short-lived Threads token (+ user id)
    const tr = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.appId, client_secret: creds.appSecret, grant_type: 'authorization_code',
        redirect_uri: redirectUri, code: req.query.code,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tj.access_token) return back('Threads token exchange failed: ' + (tj.error?.message || tj.error_message || tr.status));
    const userId = tj.user_id ? String(tj.user_id) : '';

    // 2. short-lived → long-lived (60-day) token
    let token = tj.access_token, expiresInSec = null;
    try {
      const lr = await fetch('https://graph.threads.net/access_token?' + new URLSearchParams({
        grant_type: 'th_exchange_token', client_secret: creds.appSecret, access_token: tj.access_token,
      }).toString(), { signal: AbortSignal.timeout(15000) });
      const lj = await lr.json().catch(() => ({}));
      if (lj.access_token) { token = lj.access_token; expiresInSec = lj.expires_in || null; }
    } catch { /* keep the short-lived token; the cron will exchange it next run */ }

    // 3. resolve username for a friendly label (best-effort)
    let name = null;
    if (userId) {
      try {
        const mr = await fetch(`https://graph.threads.net/v1.0/${userId}?fields=username&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) });
        const mj = await mr.json().catch(() => ({}));
        name = mj.username || null;
      } catch { /* label is cosmetic */ }
    }

    // 4. store (token managed → daily cron refreshes it before it lapses)
    const existingT = await req.db.collection('social_accounts').findOne({ platform: 'threads' });
    const merged = packCredentials('threads', { userId, accessToken: token }, existingT || {});
    const expiresAt = expiresInSec ? new Date(Date.now() + expiresInSec * 1000) : null;
    await req.db.collection('social_accounts').updateOne(
      { platform: 'threads' },
      { $set: { platform: 'threads', label: existingT?.label || 'Threads', credentials: merged.credentials, secrets: merged.secrets,
        enabled: true, tokenType: 'USER', tokenManaged: true, tokenExpiresAt: expiresAt, updatedAt: new Date(),
        ...(name ? { profile: { ...(existingT?.profile || {}), name, url: `https://threads.net/@${name}` } } : {}) },
        $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    logActivity({
      category: 'social', action: 'connection_saved',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform: 'threads', via: 'oauth' }, ip: req.ip,
    });
    return back(`Threads connected${name ? ' as @' + name : ''} — token auto-renews.`, true);
  } catch (e) { res.status(500).send('Threads connect failed: ' + e.message); }
});


export default router;
