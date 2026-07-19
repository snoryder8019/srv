import express from 'express';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { getSlabDb } from '../../plugins/mongo.js';
import { encrypt, decrypt } from '../../plugins/crypto.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import jwt from 'jsonwebtoken';
import { config } from '../../config/config.js';
import { logActivity } from '../../plugins/activityLog.js';
import { PLATFORM_LIST, maskAccount } from '../../plugins/socialPublish.js';
import { toggleableFunctions, toggleableFunctionKeys } from '../../plugins/featureRegistry.js';
import { buildAuthUrl, exchangeCode, isOAuthProvider, EMAIL_OAUTH_PROVIDERS } from '../../plugins/emailOAuth.js';
import { notifyAdmin } from '../../plugins/notify.js';

const router = express.Router();

// Fields that get encrypted
const SECRET_FIELDS = [
  'stripeSecret', 'stripeWebhookSecret',
  'paypalSecret',
  'zohoPass',
  'googleOAuthSecret',
  // White glove: tenant's own Microsoft (Azure AD) app secret for admin sign-in
  'microsoftOAuthSecret',
  // Advanced: provider OAuth client secrets (stored for OAuth-based sending)
  'gmailOAuthSecret', 'outlookOAuthSecret',
];

// Fields stored in plain text (safe to expose to frontend)
const PUBLIC_FIELDS = [
  'stripePublishable',
  'paypalClientId', 'paypalMode',
  'paymentProvider',   // which method(s) to offer on invoices: 'both' | 'stripe' | 'paypal'
  'zohoUser',
  'emailProvider',     // 'zoho' | 'gmail' | 'outlook' | 'custom' — selects SMTP host
  'emailAuthMode',     // 'password' | 'oauth' (gmail/outlook only)
  'smtpHost', 'smtpPort',  // only used when emailProvider === 'custom'
  'googlePlacesKey', 'googlePlaceId',
  'googleOAuthClientId',
  // White glove: tenant's own Microsoft (Azure AD) app for admin sign-in.
  // microsoftOAuthTenant = 'common' | 'organizations' | Directory (tenant) ID
  'microsoftOAuthClientId', 'microsoftOAuthTenant',
  // Advanced: provider OAuth client IDs
  'gmailOAuthClientId', 'outlookOAuthClientId',
  // Connected mailbox addresses (set by the OAuth callback, not the form)
  'gmailOAuthUser', 'outlookOAuthUser',
  'customDomain',
  'chatbotEnabled',
  // sLab Network — opt-in backlink exchange + cross-tenant content syndication.
  // Master switch joins the network (directory listing + footer backlink); the
  // per-module flags choose what content this tenant contributes.
  'networkOptIn',    // master: join the sLab Network
  'networkJobs',     // syndicate open job postings to /network
  'networkPress',    // syndicate press releases to /network
  'networkVideo',    // syndicate YouTube channel uploads to /network
  'networkMarket',   // syndicate marketplace listings to /network
  'networkContent',  // syndicate blog posts + newsletter issues to /network
  'networkFollow',   // let hub visitors subscribe to this brand's newsletter
];

// Brand profile fields stored in tenant.brand (drives all agent prompts)
const BRAND_FIELDS = [
  'name', 'businessType', 'industry', 'tagline', 'description',
  'location', 'serviceArea', 'phone', 'email', 'ownerName',
  'services',       // comma-separated → stored as array
  'pricingNotes',
  'targetAudience', 'brandVoice',
  'social_facebook', 'social_instagram', 'social_twitter',
  'social_linkedin', 'social_youtube', 'social_tiktok',
];

// ── GET settings page ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.redirect('/admin');

  // Build display values — secrets show masked, public show full
  const settings = {};

  // Public fields
  for (const key of PUBLIC_FIELDS) {
    settings[key] = tenant.public?.[key] || '';
  }

  // Secret fields — show masked (last 4 chars)
  for (const key of SECRET_FIELDS) {
    const val = tenant.secrets?.[key];
    if (val) {
      settings[key] = '••••••••' + val.slice(-4);
      settings[`${key}_set`] = true;
    } else {
      settings[key] = '';
      settings[`${key}_set`] = false;
    }
  }

  // OAuth-connected mailbox status (refresh token present = connected)
  settings.gmailOAuthConnected   = !!tenant.secrets?.gmailOAuthRefreshToken;
  settings.outlookOAuthConnected = !!tenant.secrets?.outlookOAuthRefreshToken;
  settings.emailAuthMode = tenant.public?.emailAuthMode || 'password';
  // The exact redirect URI the tenant must register in their OAuth app
  settings.emailOAuthRedirectBase = `https://${tenant.meta?.customDomain || tenant.public?.customDomain || tenant.domain}/admin/settings/email/oauth`;
  // Microsoft (Azure AD) sign-in redirect URI to register in the tenant's app
  settings.microsoftOAuthRedirect = `https://${tenant.meta?.customDomain || tenant.public?.customDomain || tenant.domain}/auth/microsoft/callback`;
  settings.microsoftOAuthConnected = !!tenant.secrets?.microsoftOAuthSecret && !!tenant.public?.microsoftOAuthClientId;

  // Asset-import connectors (refresh token present = connected). These use the
  // shared platform Google app, so there is nothing per-tenant to configure —
  // the connect button drives the whole OAuth flow.
  settings.googleDriveConnected  = !!tenant.secrets?.googleDriveRefreshToken;
  settings.googleDriveUser       = tenant.public?.googleDriveUser || '';
  settings.googlePhotosConnected = !!tenant.secrets?.googlePhotosRefreshToken;
  settings.googlePhotosUser      = tenant.public?.googlePhotosUser || '';

  // Meta
  settings.domain = tenant.domain;
  settings.status = tenant.status;
  settings.plan = tenant.meta?.plan || 'free';
  settings.customDomain = tenant.meta?.customDomain || tenant.public?.customDomain || '';
  // Custom domain requires an active paid plan (trial/preview must subscribe first).
  settings.customDomainPaidRequired = !(
    tenant.status === 'active' &&
    ['monthly', 'quarterly', 'annual', 'lifetime'].includes(tenant.meta?.plan) &&
    !tenant.meta?.isTrial
  );
  settings.contactEmail = tenant.meta?.contactEmail || '';
  settings.ownerEmail = tenant.meta?.ownerEmail || '';

  // Brand profile
  const brand = tenant.brand || {};
  const brandProfile = {
    name:            brand.name || '',
    businessType:    brand.businessType || '',
    industry:        brand.industry || '',
    tagline:         brand.tagline || '',
    description:     brand.description || '',
    location:        brand.location || '',
    serviceArea:     brand.serviceArea || '',
    phone:           brand.phone || '',
    email:           brand.email || '',
    ownerName:       brand.ownerName || '',
    services:        Array.isArray(brand.services) ? brand.services.join(', ') : '',
    pricingNotes:    brand.pricingNotes || '',
    targetAudience:  brand.targetAudience || '',
    brandVoice:      brand.brandVoice || '',
    social_facebook:  brand.socialLinks?.facebook || '',
    social_instagram: brand.socialLinks?.instagram || '',
    social_twitter:   brand.socialLinks?.twitter || '',
    social_linkedin:  brand.socialLinks?.linkedin || '',
    social_youtube:   brand.socialLinks?.youtube || '',
    social_tiktok:    brand.socialLinks?.tiktok || '',
  };

  // What's New / Changelog — DISABLED for this release (2026-06-27).
  // View section is hidden via `if (false)` guard; the git-log + pinned-notes
  // build below is skipped to avoid spawning git on every settings load.
  // Re-enable by restoring the original block (see git history).
  let whatsNew = [];
  let pinnedNotes = {};

  // Read package.json version
  let platformVersion = '1.0.0';
  try {
    const pkg = await import('../../package.json', { assert: { type: 'json' } });
    platformVersion = pkg.default?.version || '1.0.0';
  } catch { /* ignore */ }

  // ── Social media connections (stored in tenant DB `social_accounts`) ──
  const socialPlatforms = PLATFORM_LIST.map(p => ({
    key: p.key, name: p.name, icon: p.icon, color: p.color,
    portal: p.portal || null, setup: p.setup || '', comingSoon: !!p.comingSoon,
    links: Array.isArray(p.links) ? p.links : [],
    fields: p.fields.map(f => ({ key: f.key, label: f.label, secret: !!f.secret, placeholder: f.placeholder || '' })),
  }));
  const socialStatus = {};
  // accountMap feeds the shared connections partial (grouped-card UI); it mirrors
  // the shape the /admin/social route builds: { platform: maskAccount(account) }.
  const accountMap = {};
  try {
    const accounts = await req.db.collection('social_accounts').find({}).toArray();
    for (const a of accounts) {
      const m = maskAccount(a);
      accountMap[a.platform] = m;
      socialStatus[a.platform] = {
        configured: m.configured,
        verified: a.lastTestOk === true,
        secretsSet: m.secretsSet,
        credentials: m.credentials,
        profile: a.profile || null,
        tokenManaged: m.tokenManaged,
        tokenType: m.tokenType,
        tokenExpiresAt: m.tokenExpiresAt,
      };
    }
  } catch { /* tenant db unavailable — show all unconfigured */ }

  // Data-deletion queue (app-compliance) — folded into the connections section.
  const deletionRequests = await req.db.collection('deletion_requests')
    .find({}).sort({ createdAt: -1 }).limit(200).toArray().catch(() => []);

  const publicBaseUrl = 'https://' + (tenant.meta?.customDomain || tenant.public?.customDomain || tenant.domain);
  const publicWebhookUrl = publicBaseUrl + '/webhooks/meta';

  res.render('admin/settings', {
    user: req.adminUser,
    page: 'settings',
    settings,
    toggleableFunctions: toggleableFunctions(),
    disabledFunctions: (tenant.public?.disabledFunctions || '').split(',').map((x) => x.trim()).filter(Boolean),
    brandProfile,
    socialPlatforms,
    socialStatus,
    platforms: PLATFORM_LIST,
    accountMap,
    deletionRequests,
    publicBaseUrl,
    publicWebhookUrl,
    saved: req.query.saved || null,
    error: req.query.error || null,
    // Google OAuth connect flags — surfaced by the connections partial's hint.
    gconnected: req.query.gconnected === '1',
    gidsManual: req.query.gids === 'manual',
    whatsNew,
    pinnedNotes,
    platformVersion,
    platformEnv: config.NODE_ENV,
    nodeVersion: process.version,
  });
});

// ── POST save settings ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.redirect('/admin');

  const slab = getSlabDb();
  const updates = { updatedAt: new Date() };

  // Process public fields
  for (const key of PUBLIC_FIELDS) {
    if (req.body[key] !== undefined) {
      updates[`public.${key}`] = req.body[key].trim();
    }
  }

  // Custom domain is a paid feature — gate it behind an active paid plan.
  // Free-trial and preview tenants may configure everything else, but must
  // subscribe before pointing a custom domain (try free → pay → add domain).
  let customDomainBlocked = false;
  if (updates['public.customDomain']) {
    const plan = tenant.meta?.plan;
    const isPaidPlan = ['monthly', 'quarterly', 'annual', 'lifetime'].includes(plan);
    const isPaid = tenant.status === 'active' && isPaidPlan && !tenant.meta?.isTrial;
    // Allow clearing the field regardless; only block setting a new custom domain.
    if (!isPaid && updates['public.customDomain'] !== '') {
      delete updates['public.customDomain'];
      customDomainBlocked = true;
    }
  }

  // Chatbot toggle — checkbox posts nothing when off, so normalize explicitly.
  updates['public.chatbotEnabled'] =
    (req.body.chatbotEnabled === 'on' || req.body.chatbotEnabled === 'true') ? 'true' : 'false';

  // sLab Network toggles — checkboxes post nothing when off, so normalize each
  // to a 'true'/'false' string (same precedent as chatbotEnabled). Only touch
  // them when the Network form section was actually submitted, so saving an
  // unrelated section (which won't include the marker) can't silently opt a
  // tenant out. The hidden `networkForm` marker is emitted by that section only.
  if (req.body.networkForm !== undefined) {
    const asBool = (v) => (v === 'on' || v === 'true') ? 'true' : 'false';
    updates['public.networkOptIn'] = asBool(req.body.networkOptIn);
    // Per-module syndication only makes sense once you've joined; force off when
    // the master switch is off so a stale sub-toggle can't leak content.
    const joined = updates['public.networkOptIn'] === 'true';
    updates['public.networkJobs']  = joined ? asBool(req.body.networkJobs)  : 'false';
    updates['public.networkPress'] = joined ? asBool(req.body.networkPress) : 'false';
    updates['public.networkVideo'] = joined ? asBool(req.body.networkVideo) : 'false';
    updates['public.networkMarket'] = joined ? asBool(req.body.networkMarket) : 'false';
    updates['public.networkContent'] = joined ? asBool(req.body.networkContent) : 'false';
    updates['public.networkFollow'] = joined ? asBool(req.body.networkFollow) : 'false';
  }

  // Slab Functions — per-tenant sidebar tool visibility. Only enabled tools post
  // fn_<key>='on'; any toggleable tool NOT posted is treated as switched off.
  if (req.body.functionsForm !== undefined) {
    const toggleable = toggleableFunctionKeys();
    const disabled = toggleable.filter((k) => req.body[`fn_${k}`] !== 'on');
    updates['public.disabledFunctions'] = disabled.join(',');
  }

  // Contact form recipient (where landing-page /contact submissions are emailed)
  if (req.body.contactEmail !== undefined) {
    updates['meta.contactEmail'] = req.body.contactEmail.trim().toLowerCase();
  }

  // Owner (billing + notification) email. This single field is read live by every
  // owner-facing email (invoices, booking alerts, onboarding), so editing it here
  // hydrates globally. Only the billing/contact address — not the login identity.
  if (req.body.ownerEmail !== undefined) {
    const oe = req.body.ownerEmail.trim().toLowerCase();
    if (oe && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(oe)) updates['meta.ownerEmail'] = oe;
  }

  // Process secret fields — only update if not the masked placeholder
  for (const key of SECRET_FIELDS) {
    const val = req.body[key]?.trim();
    if (val && !val.startsWith('••••')) {
      updates[`secrets.${key}`] = encrypt(val);
    }
    // If empty and was previously set, clear it
    if (val === '' && tenant.secrets?.[key]) {
      updates[`secrets.${key}`] = '';
    }
  }

  // Process brand profile fields
  for (const key of BRAND_FIELDS) {
    const bodyKey = `brand_${key}`;
    if (req.body[bodyKey] !== undefined) {
      const val = req.body[bodyKey].trim();
      if (key === 'services') {
        // Comma-separated string → array
        updates['brand.services'] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
      } else if (key.startsWith('social_')) {
        // Social links → nested object
        const platform = key.replace('social_', '');
        updates[`brand.socialLinks.${platform}`] = val;
      } else {
        updates[`brand.${key}`] = val;
      }
    }
  }

  // Tenant docs are keyed by the wildcard subdomain. When admin is accessed via
  // a custom domain, tenant.domain is the *custom* domain, which is NOT the DB
  // key — so always update by the canonical wildcard domain.
  const canonicalDomain = tenant.wildcardDomain || tenant.domain;

  try {
    const result = await slab.collection('tenants').updateOne(
      { domain: canonicalDomain },
      { $set: updates }
    );
    if (result.matchedCount === 0) {
      throw new Error(`No tenant document matched domain "${canonicalDomain}" — settings not saved`);
    }
    // Bust every hostname this tenant may be cached under
    for (const d of [canonicalDomain, tenant.domain, tenant.customDomain, tenant.meta?.customDomain]) {
      if (d) bustTenantCache(d);
    }

    // Build a readable list of what changed
    const changedFields = Object.keys(updates).filter(k => k !== 'updatedAt');
    logActivity({
      category: 'settings', action: 'settings_saved',
      tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { fieldsUpdated: changedFields },
      ip: req.ip,
    });
    res.redirect('/admin/settings?saved=1' + (customDomainBlocked ? '&domainLocked=1' : ''));
  } catch (err) {
    console.error('[settings] save error:', err);
    logActivity({
      category: 'settings', action: 'settings_saved',
      tenantDomain: tenant.domain, tenantId: tenant._id, status: 'failed',
      actor: { email: req.adminUser?.email, role: 'admin' },
      error: err.message, ip: req.ip,
    });
    res.redirect('/admin/settings?error=save');
  }
});

// ── Test Stripe connection ──────────────────────────────────────────────────
router.post('/test-stripe', async (req, res) => {
  try {
    const key = req.tenant?.secrets?.stripeSecret;
    if (!key) return res.json({ ok: false, error: 'No Stripe secret key configured' });
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(key);
    const balance = await stripe.balance.retrieve();
    logActivity({
      category: 'settings', action: 'stripe_test',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' }, ip: req.ip,
    });
    res.json({ ok: true, currency: balance.available?.[0]?.currency || 'usd' });
  } catch (err) {
    logActivity({
      category: 'settings', action: 'stripe_test',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'failed',
      actor: { email: req.adminUser?.email, role: 'admin' },
      error: err.message, ip: req.ip,
    });
    res.json({ ok: false, error: err.message });
  }
});

// ── Test email connection ───────────────────────────────────────────────────
router.post('/test-email', async (req, res) => {
  try {
    const { resolveSmtp, getTenantTransporter } = await import('../../plugins/mailer.js');
    const smtp = resolveSmtp(req.tenant);
    if (smtp.authMode === 'oauth') {
      if (!smtp.user) return res.json({ ok: false, error: 'OAuth mailbox not connected' });
    } else {
      if (!smtp.user || !smtp.pass) return res.json({ ok: false, error: 'Email credentials not configured' });
      if (!smtp.host) return res.json({ ok: false, error: 'Custom SMTP host not set' });
    }
    // getTenantTransporter fetches a fresh OAuth access token when in OAuth mode.
    const transporter = await getTenantTransporter(req.tenant);
    await transporter.verify();
    logActivity({
      category: 'settings', action: 'email_test',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' }, details: { provider: smtp.provider }, ip: req.ip,
    });
    res.json({ ok: true, provider: smtp.provider });
  } catch (err) {
    logActivity({
      category: 'settings', action: 'email_test',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'failed',
      actor: { email: req.adminUser?.email, role: 'admin' },
      error: err.message, ip: req.ip,
    });
    res.json({ ok: false, error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
 * EMAIL OAUTH — per-tenant "Connect mailbox" flow for Gmail / Outlook.
 * The tenant registers its own OAuth client (id+secret saved above) and
 * authorises its mailbox; we store the resulting refresh token encrypted and
 * flip emailAuthMode to 'oauth'. Mirrors the JWT-state pattern in routes/auth.js.
 * ────────────────────────────────────────────────────────────────────────── */

// Start consent → redirect to the provider
router.get('/email/oauth/:provider/connect', (req, res) => {
  const provider = req.params.provider;
  if (!isOAuthProvider(provider)) return res.redirect('/admin/settings?error=' + encodeURIComponent('Unknown OAuth provider') + '#email');
  const tenant = req.tenant;
  const clientId = tenant?.public?.[`${provider}OAuthClientId`];
  const clientSecret = tenant?.secrets?.[`${provider}OAuthSecret`];
  if (!clientId || !clientSecret) {
    return res.redirect('/admin/settings?error=' + encodeURIComponent('Save the ' + (EMAIL_OAUTH_PROVIDERS[provider]?.label || provider) + ' OAuth Client ID and Secret first') + '#email');
  }
  const redirectUri = `https://${req.hostname}/admin/settings/email/oauth/${provider}/callback`;
  const state = jwt.sign(
    { provider, domain: tenant.wildcardDomain || tenant.domain, redirectUri },
    config.JWT_SECRET, { expiresIn: '10m' }
  );
  res.redirect(buildAuthUrl(provider, { clientId, redirectUri, state }));
});

// Provider callback → exchange code, store refresh token, enable OAuth
router.get('/email/oauth/:provider/callback', async (req, res) => {
  const provider = req.params.provider;
  try {
    if (!isOAuthProvider(provider)) throw new Error('Unknown provider');
    const { code, state, error, error_description } = req.query;
    if (error) throw new Error(error_description || error);
    if (!code || !state) throw new Error('Missing authorization code');
    let claims;
    try { claims = jwt.verify(state, config.JWT_SECRET); }
    catch { throw new Error('Consent link expired — please try connecting again.'); }
    if (claims.provider !== provider) throw new Error('Provider mismatch');

    const tenant = req.tenant;
    const clientId = tenant?.public?.[`${provider}OAuthClientId`];
    const clientSecret = tenant?.secrets?.[`${provider}OAuthSecret`];
    if (!clientId || !clientSecret) throw new Error('OAuth client credentials missing');

    const redirectUri = claims.redirectUri || `https://${req.hostname}/admin/settings/email/oauth/${provider}/callback`;
    const { refreshToken, email } = await exchangeCode(provider, { clientId, clientSecret, code, redirectUri });

    const canonicalDomain = tenant.wildcardDomain || tenant.domain;
    const updates = {
      [`secrets.${provider}OAuthRefreshToken`]: encrypt(refreshToken),
      'public.emailProvider': provider,
      'public.emailAuthMode': 'oauth',
      updatedAt: new Date(),
    };
    if (email) updates[`public.${provider}OAuthUser`] = email;
    await getSlabDb().collection('tenants').updateOne({ domain: canonicalDomain }, { $set: updates });
    for (const d of [canonicalDomain, tenant.domain, tenant.customDomain, tenant.meta?.customDomain]) if (d) bustTenantCache(d);

    logActivity({
      category: 'settings', action: 'email_oauth_connected',
      tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { provider, mailbox: email || null }, ip: req.ip,
    });
    res.redirect('/admin/settings?saved=1#email');
  } catch (err) {
    logActivity({
      category: 'settings', action: 'email_oauth_connected',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'failed',
      actor: { email: req.adminUser?.email, role: 'admin' }, error: err.message, ip: req.ip,
    });
    res.redirect('/admin/settings?error=' + encodeURIComponent('OAuth connect failed: ' + err.message) + '#email');
  }
});

// Disconnect a connected mailbox
router.post('/email/oauth/:provider/disconnect', async (req, res) => {
  const provider = req.params.provider;
  if (!isOAuthProvider(provider)) return res.json({ ok: false, error: 'Unknown provider' });
  try {
    const tenant = req.tenant;
    const canonicalDomain = tenant.wildcardDomain || tenant.domain;
    await getSlabDb().collection('tenants').updateOne(
      { domain: canonicalDomain },
      {
        $unset: { [`secrets.${provider}OAuthRefreshToken`]: '', [`public.${provider}OAuthUser`]: '' },
        $set: { 'public.emailAuthMode': 'password', updatedAt: new Date() },
      }
    );
    for (const d of [canonicalDomain, tenant.domain, tenant.customDomain, tenant.meta?.customDomain]) if (d) bustTenantCache(d);
    logActivity({
      category: 'settings', action: 'email_oauth_disconnected',
      tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' }, details: { provider }, ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Check DNS records (SPF, DKIM, DMARC, MX) ─────────────────────────────
// --- Zoho DNS constants (shared by the checker & the auto-creator) ---------
// Previously the checker probed DKIM at `zmail._domainkey` while the auto-
// creator published `zb._domainkey`, and the SPF check required
// `include:zoho.com` while the live root domain uses `include:zohomail.com`.
// Both mismatches made Check DNS report false negatives, so both settings now
// live here and the two code paths read from the same source of truth.
const ZOHO_SPF_INCLUDES = ['zohomail.com', 'zoho.com']; // accept either alias when verifying
const ZOHO_SPF_INCLUDE  = ZOHO_SPF_INCLUDES[0];         // canonical one we write (matches root domain)
const DKIM_SELECTORS    = ['zmail', 'zb', 'default'];   // selectors we may have published across the fleet

router.post('/check-dns', async (req, res) => {
  try {
    const { resolveTxt, resolveMx } = await import('dns/promises');
    const zohoUser = req.tenant?.public?.zohoUser;
    if (!zohoUser) return res.json({ ok: false, error: 'Set Zoho email first' });

    const domain = zohoUser.split('@')[1];
    if (!domain) return res.json({ ok: false, error: 'Invalid email domain' });

    const results = { domain, spf: null, dkim: null, dmarc: null, mx: null };

    // SPF — look for TXT record containing v=spf1
    try {
      const txtRecords = await resolveTxt(domain);
      const spfRecord = txtRecords.flat().find(r => r.startsWith('v=spf1'));
      if (spfRecord) {
        const hasZoho = ZOHO_SPF_INCLUDES.some(inc => new RegExp('include:' + inc.replace(/\./g, '\\.'), 'i').test(spfRecord));
        results.spf = {
          found: true,
          value: spfRecord,
          valid: hasZoho,
          message: hasZoho ? 'SPF includes Zoho' : `SPF found but no Zoho include (${ZOHO_SPF_INCLUDES.join(' or ')})`,
        };
      } else {
        results.spf = { found: false, valid: false, message: 'No SPF record found' };
      }
    } catch {
      results.spf = { found: false, valid: false, message: 'No TXT records found' };
    }

    // DKIM — probe every selector we might publish (a manual Zoho TXT key,
    // or an auto-created CNAME) and report the first valid hit, so the result
    // matches however this specific domain was actually set up.
    results.dkim = { found: false, valid: false, message: `No DKIM key found (checked selectors: ${DKIM_SELECTORS.join(', ')})` };
    for (const sel of DKIM_SELECTORS) {
      try {
        const dkimRecords = await resolveTxt(`${sel}._domainkey.${domain}`);
        const dkimValue = dkimRecords.flat().join('');
        const valid = dkimValue.includes('v=DKIM1');
        results.dkim = {
          found: true,
          valid,
          selector: sel,
          value: dkimValue.substring(0, 80) + '…',
          message: valid ? `DKIM configured (selector: ${sel})` : `Record at ${sel}._domainkey found but missing v=DKIM1`,
        };
        if (valid) break; // stop at the first good key; keep scanning past invalid ones
      } catch { /* selector not published -- try the next */ }
    }

    // DMARC — check _dmarc.domain
    try {
      const dmarcRecords = await resolveTxt(`_dmarc.${domain}`);
      const dmarcValue = dmarcRecords.flat().find(r => r.startsWith('v=DMARC1'));
      if (dmarcValue) {
        const policy = dmarcValue.match(/p=(none|quarantine|reject)/)?.[1] || 'unknown';
        results.dmarc = {
          found: true, valid: true, value: dmarcValue, policy,
          message: `DMARC active (policy: ${policy})`,
        };
      } else {
        results.dmarc = { found: false, valid: false, message: 'No DMARC record found' };
      }
    } catch {
      results.dmarc = { found: false, valid: false, message: 'No DMARC record found' };
    }

    // MX — check for Zoho MX records
    try {
      const mxRecords = await resolveMx(domain);
      const hasZohoMx = mxRecords.some(r => /zoho\.com$/i.test(r.exchange));
      results.mx = {
        found: mxRecords.length > 0,
        valid: hasZohoMx,
        records: mxRecords.map(r => `${r.priority} ${r.exchange}`),
        message: hasZohoMx
          ? `${mxRecords.length} MX records (Zoho)`
          : mxRecords.length
            ? `${mxRecords.length} MX records (not Zoho — OK if you use another provider for receiving)`
            : 'No MX records',
      };
    } catch {
      results.mx = { found: false, valid: false, message: 'No MX records found' };
    }

    logActivity({
      category: 'settings', action: 'dns_check',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: {
        domain: results.domain,
        spf: results.spf?.valid ? 'pass' : 'fail',
        dkim: results.dkim?.valid ? 'pass' : 'fail',
        dmarc: results.dmarc?.valid ? 'pass' : 'fail',
        mx: results.mx?.valid ? 'pass' : 'fail',
      },
      ip: req.ip,
    });
    res.json({ ok: true, results });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Auto-create DNS records for subdomain tenants on madladslab.com ───────
router.post('/auto-create-dns', async (req, res) => {
  try {
    const zohoUser = req.tenant?.public?.zohoUser;
    if (!zohoUser) return res.json({ ok: false, error: 'Set Zoho email first' });

    const emailDomain = zohoUser.split('@')[1];

    // Only auto-create for madladslab.com subdomains
    if (!emailDomain || !emailDomain.endsWith('.madladslab.com')) {
      return res.json({ ok: false, error: 'Auto-create only works for *.madladslab.com subdomains. For custom domains, add records manually in your DNS provider.' });
    }

    if (!config.LINODE_API_TOKEN || !config.LINODE_DOMAIN_ID) {
      return res.json({ ok: false, error: 'Linode API not configured' });
    }

    const subdomain = emailDomain.replace('.madladslab.com', '');
    const LINODE_API = 'https://api.linode.com/v4';
    const headers = {
      'Authorization': `Bearer ${config.LINODE_API_TOKEN}`,
      'Content-Type': 'application/json',
    };

    const created = [];
    const errors = [];

    // SPF TXT record
    try {
      const spfRes = await fetch(
        `${LINODE_API}/domains/${config.LINODE_DOMAIN_ID}/records`,
        {
          method: 'POST', headers,
          body: JSON.stringify({
            type: 'TXT',
            name: subdomain,
            target: `v=spf1 include:${ZOHO_SPF_INCLUDE} ~all`,
            ttl_sec: 300,
          }),
        }
      );
      if (spfRes.ok) created.push('SPF');
      else errors.push(`SPF: ${(await spfRes.text()).substring(0, 100)}`);
    } catch (e) { errors.push(`SPF: ${e.message}`); }

    // DMARC TXT record
    try {
      const dmarcRes = await fetch(
        `${LINODE_API}/domains/${config.LINODE_DOMAIN_ID}/records`,
        {
          method: 'POST', headers,
          body: JSON.stringify({
            type: 'TXT',
            name: `_dmarc.${subdomain}`,
            target: `v=DMARC1; p=none; rua=mailto:dmarc@${emailDomain}`,
            ttl_sec: 300,
          }),
        }
      );
      if (dmarcRes.ok) created.push('DMARC');
      else errors.push(`DMARC: ${(await dmarcRes.text()).substring(0, 100)}`);
    } catch (e) { errors.push(`DMARC: ${e.message}`); }

    // Return-path CNAME
    try {
      const zbRes = await fetch(
        `${LINODE_API}/domains/${config.LINODE_DOMAIN_ID}/records`,
        {
          method: 'POST', headers,
          body: JSON.stringify({
            type: 'CNAME',
            name: `zb._domainkey.${subdomain}`,
            target: 'zb._domainkey.zoho.com',
            ttl_sec: 300,
          }),
        }
      );
      if (zbRes.ok) created.push('Return-Path CNAME');
      else errors.push(`CNAME: ${(await zbRes.text()).substring(0, 100)}`);
    } catch (e) { errors.push(`CNAME: ${e.message}`); }

    console.log(`[settings] Auto-created DNS for ${emailDomain}: ${created.join(', ')} | Errors: ${errors.join(', ') || 'none'}`);

    logActivity({
      category: 'settings', action: 'dns_auto_create',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id,
      status: errors.length ? 'partial' : 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { emailDomain, created, errors },
      ip: req.ip,
    });

    res.json({
      ok: true,
      created,
      errors,
      note: 'DKIM must still be added manually — get the key from Zoho Mail Admin → DKIM. DNS changes take up to 5 minutes to propagate.',
    });
  } catch (err) {
    logActivity({
      category: 'settings', action: 'dns_auto_create',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'failed',
      actor: { email: req.adminUser?.email, role: 'admin' },
      error: err.message, ip: req.ip,
    });
    res.json({ ok: false, error: err.message });
  }
});

// ── Changelog / What's New ──────────────────────────────────────────────────

// Superadmin can add a pinned note to any commit hash
router.post('/changelog', async (req, res) => {
  if (!req.isSuperAdmin) return res.status(403).json({ error: 'Superadmin required' });

  const { commitHash, notes } = req.body;
  if (!notes) return res.status(400).json({ error: 'notes required' });

  try {
    const slab = getSlabDb();
    await slab.collection('changelog').updateOne(
      { commitHash: commitHash || 'general' },
      {
        $set: {
          commitHash: commitHash || 'general',
          notes: notes.trim(),
          updatedAt: new Date(),
          addedBy: req.adminUser?.email || 'unknown',
        },
      },
      { upsert: true },
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Account wire-up request (welcome banner form) ────────────────────────────
// Tenant admin asks for help connecting integrations. Saved to the superadmin
// action list (slab.setup_requests) and emailed to Scott via notifyAdmin.
// Replaces the old paid "Done-For-You" CTA.
router.post('/setup-request', async (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ error: 'No tenant context' });

  const accounts = Array.isArray(req.body.accounts)
    ? req.body.accounts.filter(a => typeof a === 'string').map(a => a.slice(0, 60)).slice(0, 20)
    : [];
  const message = (req.body.message || '').toString().trim().slice(0, 2000);

  const domain         = tenant.domain;
  const brandName      = tenant.brand?.name || '';
  const requesterEmail = req.adminUser?.email || tenant.public?.email || tenant.meta?.ownerEmail || '';
  const requesterName  = req.adminUser?.displayName || brandName || '';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';

  try {
    const slab = getSlabDb();
    await slab.collection('setup_requests').insertOne({
      tenantId: tenant._id || null,
      tenantDb: tenant.db || req.adminUser?.tenantDb || null,
      domain,
      brandName,
      requesterEmail,
      requesterName,
      accounts,
      message,
      status: 'new',            // new → working → done
      createdAt: new Date(),
      ip,
    });
  } catch (err) {
    console.error('[setup-request] DB write failed:', err.message);
    return res.status(500).json({ error: 'Could not save your request — please try again.' });
  }

  // Email Scott + write the platform_events feed (best-effort, non-blocking).
  notifyAdmin({
    type: 'contact',
    app: 'slab',
    email: requesterEmail,
    name: requesterName || domain,
    data: {
      request: 'Account wire-up help',
      brandName,
      domain,
      accounts: accounts.length ? accounts.join(', ') : '(none specified)',
      message: message || '(no message)',
    },
    ip,
  }).catch(e => console.error('[setup-request] notify failed:', e.message));

  res.json({ ok: true });
});

// ── Custom API Keys (tenant-defined credential vault) ───────────────────────
// A tenant stores arbitrary named API keys/secrets here, encrypted with the same
// AES-256-GCM as provider secrets. Values are surfaced decrypted on
// req.tenant.customKeys (middleware/tenant.js) so any connector can read one by
// name — e.g. getTenantKey(req.tenant, 'indeed_publisher_key').

// Normalize a key name to a safe, stable lookup handle.
function normalizeKeyName(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

// Read a decrypted custom key by name off the resolved tenant (for connectors).
// Returns the value, '' if unset on the entry, or undefined if no such key.
export function getTenantKey(tenant, name) {
  const hit = (tenant?.customKeys || []).find((k) => k.name === normalizeKeyName(name));
  return hit ? hit.value : undefined;
}

// List page.
router.get('/keys', (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.redirect('/admin');
  const keys = (tenant.customKeys || []).map((k) => ({
    id: k.id, name: k.name, note: k.note || '',
    masked: k.value == null ? '(decrypt error)' : ('••••••••' + String(k.value).slice(-4)),
    broken: k.value == null,
    createdAt: k.createdAt, updatedAt: k.updatedAt,
  })).sort((a, b) => a.name.localeCompare(b.name));
  res.render('admin/settings/keys', {
    user: req.adminUser, page: 'settings', title: 'API Keys', keys,
    msg: req.query.msg, err: req.query.err,
  });
});

// Add or update a key (upsert by name).
router.post('/keys', async (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.redirect('/admin');
  const name = normalizeKeyName(req.body.name);
  const value = (req.body.value || '').trim();
  const note = (req.body.note || '').trim().slice(0, 200);
  if (!name) return res.redirect('/admin/settings/keys?err=name');
  if (!value) return res.redirect('/admin/settings/keys?err=value');

  const slab = getSlabDb();
  const canonicalDomain = tenant.wildcardDomain || tenant.domain;
  try {
    const doc = await slab.collection('tenants').findOne({ domain: canonicalDomain }, { projection: { customKeys: 1 } });
    const list = Array.isArray(doc?.customKeys) ? doc.customKeys : [];
    const now = new Date();
    const existing = list.find((k) => k.name === name);
    if (existing) {
      existing.value = encrypt(value);
      existing.note = note;
      existing.updatedAt = now;
    } else {
      list.push({ id: randomBytes(8).toString('hex'), name, note, value: encrypt(value), createdAt: now, updatedAt: now });
    }
    const result = await slab.collection('tenants').updateOne(
      { domain: canonicalDomain }, { $set: { customKeys: list, updatedAt: now } });
    if (result.matchedCount === 0) throw new Error(`No tenant matched "${canonicalDomain}"`);
    for (const d of [canonicalDomain, tenant.domain, tenant.customDomain, tenant.meta?.customDomain]) if (d) bustTenantCache(d);
    logActivity({
      category: 'settings', action: 'custom_key_saved',
      tenantDomain: tenant.domain, tenantId: tenant._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { key: name, isUpdate: !!existing }, ip: req.ip,
    });
    res.redirect(`/admin/settings/keys?msg=${existing ? 'updated' : 'added'}`);
  } catch (err) {
    console.error('[settings/keys] save error:', err);
    res.redirect('/admin/settings/keys?err=save');
  }
});

// Delete a key by id.
router.post('/keys/:id/delete', async (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.redirect('/admin');
  const slab = getSlabDb();
  const canonicalDomain = tenant.wildcardDomain || tenant.domain;
  try {
    const doc = await slab.collection('tenants').findOne({ domain: canonicalDomain }, { projection: { customKeys: 1 } });
    const list = (Array.isArray(doc?.customKeys) ? doc.customKeys : []).filter((k) => k.id !== req.params.id);
    await slab.collection('tenants').updateOne(
      { domain: canonicalDomain }, { $set: { customKeys: list, updatedAt: new Date() } });
    for (const d of [canonicalDomain, tenant.domain, tenant.customDomain, tenant.meta?.customDomain]) if (d) bustTenantCache(d);
    res.redirect('/admin/settings/keys?msg=deleted');
  } catch (err) {
    console.error('[settings/keys] delete error:', err);
    res.redirect('/admin/settings/keys?err=save');
  }
});

export default router;
