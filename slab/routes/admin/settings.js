import express from 'express';
import { execSync } from 'child_process';
import { getSlabDb } from '../../plugins/mongo.js';
import { encrypt, decrypt } from '../../plugins/crypto.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import { config } from '../../config/config.js';
import { logActivity } from '../../plugins/activityLog.js';

const router = express.Router();

// Fields that get encrypted
const SECRET_FIELDS = [
  'stripeSecret', 'stripeWebhookSecret',
  'paypalSecret',
  'zohoPass',
  'googleOAuthSecret',
];

// Fields stored in plain text (safe to expose to frontend)
const PUBLIC_FIELDS = [
  'stripePublishable',
  'paypalClientId', 'paypalMode',
  'zohoUser',
  'googlePlacesKey', 'googlePlaceId',
  'googleOAuthClientId',
  'customDomain',
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

  // Meta
  settings.domain = tenant.domain;
  settings.status = tenant.status;
  settings.plan = tenant.meta?.plan || 'free';
  settings.customDomain = tenant.meta?.customDomain || '';

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

  // Load What's New from git commits on main
  let whatsNew = [];
  try {
    const gitLog = execSync(
      'git log main --pretty=format:"%H|%h|%s|%ai|%an" -30 -- slab/',
      { encoding: 'utf8', timeout: 5000, cwd: '/srv' }
    ).trim();
    if (gitLog) {
      const lines = gitLog.split('\n');
      for (const line of lines) {
        const [hash, short, message, dateStr, author] = line.split('|');
        if (!message) continue;
        const d = new Date(dateStr);
        whatsNew.push({
          hash, short, message,
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          author,
          // Detect version tags in commit message
          version: message.match(/v\s*[\d.]+/i)?.[0]?.trim() || null,
          env: config.NODE_ENV,
        });
      }
    }
  } catch { /* ignore */ }

  // Also load pinned notes from DB (superadmin annotations on specific versions)
  let pinnedNotes = {};
  try {
    const slab = getSlabDb();
    const notes = await slab.collection('changelog').find({}).toArray();
    for (const n of notes) pinnedNotes[n.commitHash || n.version || ''] = n.notes;
  } catch { /* ignore */ }

  // Read package.json version
  let platformVersion = '1.0.0';
  try {
    const pkg = await import('../../package.json', { assert: { type: 'json' } });
    platformVersion = pkg.default?.version || '1.0.0';
  } catch { /* ignore */ }

  res.render('admin/settings', {
    user: req.adminUser,
    page: 'settings',
    settings,
    brandProfile,
    saved: req.query.saved || null,
    error: req.query.error || null,
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

  try {
    await slab.collection('tenants').updateOne(
      { domain: tenant.domain },
      { $set: updates }
    );
    bustTenantCache(tenant.domain);
    // If there's a custom domain alias, update that too
    if (tenant.meta?.customDomain) {
      await slab.collection('tenants').updateOne(
        { domain: tenant.meta.customDomain },
        { $set: updates }
      );
      bustTenantCache(tenant.meta.customDomain);
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
    res.redirect('/admin/settings?saved=1');
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
    const zohoUser = req.tenant?.public?.zohoUser;
    const zohoPass = req.tenant?.secrets?.zohoPass;
    if (!zohoUser || !zohoPass) return res.json({ ok: false, error: 'Zoho credentials not configured' });
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host: 'smtppro.zoho.com', port: 465, secure: true, authMethod: 'LOGIN',
      auth: { user: zohoUser, pass: zohoPass },
    });
    await transporter.verify();
    logActivity({
      category: 'settings', action: 'email_test',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' }, ip: req.ip,
    });
    res.json({ ok: true });
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

// ── Check DNS records (SPF, DKIM, DMARC, MX) ─────────────────────────────
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
        const hasZoho = /include:zoho\.com/i.test(spfRecord);
        results.spf = {
          found: true,
          value: spfRecord,
          valid: hasZoho,
          message: hasZoho ? 'SPF includes Zoho' : 'SPF found but missing include:zoho.com',
        };
      } else {
        results.spf = { found: false, valid: false, message: 'No SPF record found' };
      }
    } catch {
      results.spf = { found: false, valid: false, message: 'No TXT records found' };
    }

    // DKIM — check zmail._domainkey.domain
    try {
      const dkimRecords = await resolveTxt(`zmail._domainkey.${domain}`);
      const dkimValue = dkimRecords.flat().join('');
      results.dkim = {
        found: true,
        valid: dkimValue.includes('v=DKIM1'),
        value: dkimValue.substring(0, 80) + '…',
        message: dkimValue.includes('v=DKIM1') ? 'DKIM configured' : 'DKIM record found but may be invalid',
      };
    } catch {
      results.dkim = { found: false, valid: false, message: 'No DKIM record at zmail._domainkey' };
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
            target: 'v=spf1 include:zoho.com ~all',
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

export default router;
