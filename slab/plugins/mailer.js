import nodemailer from 'nodemailer';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTenantDb } from './mongo.js';
import { contrastRatio, mixHex, readableTextColor, enrichDesignContrast } from './colorContrast.js';
import { sanitizeEmailHtml } from './emailHtml.js';
import { getEmailAccessToken, isOAuthProvider } from './emailOAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const transporterCache = new Map();

/* ──────────────────────────────────────────────────────────────────
 * SMTP PROVIDERS — host/port presets per provider. Credentials are the
 * generic SMTP user/pass, still stored under the legacy `zohoUser`/`zohoPass`
 * keys so existing tenants keep working. `emailProvider` selects the host.
 *   - zoho/gmail use implicit TLS on 465
 *   - outlook uses STARTTLS on 587 (Microsoft rejects implicit-TLS 465)
 *   - custom reads host/port from tenant.public.smtpHost / smtpPort
 * Gmail & Outlook personal accounts require an App Password (2FA on); many
 * Microsoft 365 *business* tenants disable SMTP basic-auth and need OAuth —
 * surfaced as an Advanced option in settings.
 * ────────────────────────────────────────────────────────────────── */
const SMTP_PRESETS = {
  zoho:    { host: 'smtppro.zoho.com',      port: 465, secure: true },
  gmail:   { host: 'smtp.gmail.com',        port: 465, secure: true },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false, requireTLS: true },
};

/**
 * Resolve a tenant's outgoing SMTP config from its provider + credentials.
 *
 * `authMode` is 'oauth' only when the provider supports it (gmail/outlook), the
 * tenant selected it, AND a refresh token + client credentials are present —
 * otherwise it degrades to 'password' so a half-finished OAuth setup never
 * silently breaks sending. Returns user/pass/oauth fields possibly null when
 * unconfigured (callers decide whether to throw).
 */
export function resolveSmtp(tenant) {
  const provider = tenant?.public?.emailProvider || 'zoho';
  const pub = tenant?.public || {};
  const sec = tenant?.secrets || {};

  let host, port, secure, requireTLS = false;
  if (provider === 'custom') {
    host = pub.smtpHost || '';
    port = Number(pub.smtpPort) || 587;
    secure = port === 465;
    requireTLS = !secure;
  } else {
    const preset = SMTP_PRESETS[provider] || SMTP_PRESETS.zoho;
    ({ host, port, secure } = preset);
    requireTLS = !!preset.requireTLS;
  }

  // OAuth material (per provider). Only gmail/outlook can do OAuth SMTP.
  const oauth = isOAuthProvider(provider) ? {
    provider,
    clientId:     pub[`${provider}OAuthClientId`] || null,
    clientSecret: sec[`${provider}OAuthSecret`] || null,
    refreshToken: sec[`${provider}OAuthRefreshToken`] || null,
    user:         pub[`${provider}OAuthUser`] || null,
  } : null;

  const wantsOAuth = pub.emailAuthMode === 'oauth';
  const canOAuth = !!(oauth && oauth.clientId && oauth.clientSecret && oauth.refreshToken);
  const authMode = (wantsOAuth && canOAuth) ? 'oauth' : 'password';

  const user = authMode === 'oauth'
    ? (oauth.user || sec.zohoUser || pub.zohoUser || null)
    : (sec.zohoUser || pub.zohoUser || null);
  const pass = sec.zohoPass || null;

  return { provider, authMode, user, pass, host, port, secure, requireTLS, oauth };
}

function getTransporter(smtp) {
  if (smtp.authMode === 'oauth') {
    // Access token already fetched in tenantSmtp(); build a fresh XOAUTH2
    // transport each time (tokens expire, so we don't pool these).
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: smtp.requireTLS || undefined,
      auth: { type: 'OAuth2', user: smtp.user, accessToken: smtp.accessToken },
    });
  }
  // Password mode — key on the full connection identity so a rotated password
  // or a switched provider transparently builds a fresh transporter instead of
  // reusing a stale one (which the server rejects with 535).
  const cacheKey = `${smtp.host}:${smtp.port}|${smtp.user}|${smtp.pass}`;
  if (transporterCache.has(cacheKey)) return transporterCache.get(cacheKey);
  const t = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.requireTLS || undefined,
    authMethod: 'LOGIN',
    auth: { user: smtp.user, pass: smtp.pass },
  });
  transporterCache.set(cacheKey, t);
  return t;
}

/** Build a transporter for a tenant; throws when unconfigured. */
export async function getTenantTransporter(tenant) {
  return getTransporter(await tenantSmtp(tenant));
}

/* ──────────────────────────────────────────────────────────────────
 * THEME — map tenant design tokens to a complete email theme.
 * Falls back to slab defaults (navy/gold/cream) when missing.
 * ────────────────────────────────────────────────────────────────── */

const FALLBACK_THEME = {
  c_primary:        '#1C2B4A',
  c_primary_deep:   '#0F1B30',
  c_primary_mid:    '#2E4270',
  c_accent:         '#C9A848',
  c_accent_light:   '#E8D08A',
  c_bg:             '#F5F3EF',
  c_white:          '#FDFCFA',
  c_text:           '#0F1B30',
  c_text_muted:     '#6B7380',
  c_border:         '#E6E1D6',
  c_success:        '#15803D',
  c_danger:         '#8B1C1C',
  font_heading:     'Georgia',
  font_body:        'Jost',
};

function googleFontParam(family) {
  if (!family) return 'Jost';
  return family.trim().replace(/\s+/g, '+');
}

/**
 * Build a theme object that templates can interpolate.
 *
 * Uses the shared `enrichDesignContrast` helper from colorContrast.js (the same
 * code that drives the admin/site contrast) so emails stay in lockstep with the
 * tenant's site styling.
 *
 * Email-specific additions:
 *   - accent_on_primary  – brand accent if it contrasts against primary, else
 *                          on_primary_muted (prevents gold-on-orange muddiness)
 *   - badge_bg/badge_text – auto-swap to cream-on-primary when accent vs primary
 *                          fails the 3:1 large-text bar
 *   - button_bg/button_text – the Pay button always sits on a white/surface row
 *                             so we keep the brand accent here regardless
 */
export function themeFromDesign(design = {}) {
  const t = { ...FALLBACK_THEME };
  const map = {
    color_primary:       'c_primary',
    color_primary_deep:  'c_primary_deep',
    color_primary_mid:   'c_primary_mid',
    color_accent:        'c_accent',
    color_accent_light:  'c_accent_light',
    color_bg:            'c_bg',
    color_white:         'c_white',
    color_text:          'c_text',
    color_muted:         'c_text_muted',
    color_border:        'c_border',
    color_success:       'c_success',
    color_danger:        'c_danger',
    font_heading:        'font_heading',
    font_body:           'font_body',
  };
  for (const [src, dst] of Object.entries(map)) {
    const v = design[src];
    if (v) t[dst] = v;
  }
  for (const k of Object.keys(t)) {
    if (typeof t[k] === 'string' && /^#[0-9a-f]{6}$/i.test(t[k])) t[k] = t[k].toUpperCase();
  }
  t.font_heading_url = googleFontParam(t.font_heading);
  t.font_body_url    = googleFontParam(t.font_body);

  // ── Reuse the platform-wide contrast helper ────────────────
  const enriched = enrichDesignContrast({
    color_primary:       t.c_primary,
    color_primary_deep:  t.c_primary_deep,
    color_primary_mid:   t.c_primary_mid,
    color_accent:        t.c_accent,
    color_accent_light:  t.c_accent_light,
    color_bg:            t.c_bg,
  });

  t.on_primary       = enriched._on_primary;
  t.on_accent        = enriched._on_accent;
  t.on_bg            = enriched._on_bg;
  t.on_bg_muted      = enriched._on_bg_muted;
  // softer variant of on_primary for eyebrows/locations
  t.on_primary_muted = mixHex(t.on_primary, t.c_primary, 0.65);
  // body text inside the white content area
  t.on_white         = readableTextColor(t.c_white);

  // Email-only derived tokens for the header-on-primary surfaces
  const accentVsPrimary = contrastRatio(t.c_primary, t.c_accent);
  t.accent_on_primary = accentVsPrimary >= 3.5
    ? t.c_accent
    : (contrastRatio(t.c_primary, t.c_accent_light) >= 3.5 ? t.c_accent_light : t.on_primary_muted);

  // Badge: brand accent if it stands out from primary, else cream-with-primary
  const accentReadableOnPrimary = accentVsPrimary >= 3;
  t.badge_bg   = accentReadableOnPrimary ? t.c_accent : t.c_white;
  t.badge_text = readableTextColor(t.badge_bg);

  // Button always sits on a white content row → keep the brand accent here
  t.button_bg   = t.c_accent;
  t.button_text = readableTextColor(t.c_accent);

  return t;
}

/** Load and assemble the design tokens for a tenant from its `design` collection. */
export async function loadTenantTheme(tenant) {
  if (!tenant?.db) return themeFromDesign({});
  try {
    const docs = await getTenantDb(tenant.db).collection('design').find({}).toArray();
    const design = {};
    for (const d of docs) {
      if (d.key) design[d.key] = d.value;
      else Object.assign(design, d); // single-doc fallback
    }
    return themeFromDesign(design);
  } catch {
    return themeFromDesign({});
  }
}

/**
 * Load the tenant's brand logo URLs from the `brand_images` collection.
 * Returns a map keyed by slot (logo_white, logo_primary, logo_icon). The email
 * header sits on the dark primary surface, so callers should prefer logo_white.
 */
export async function loadTenantBrandImages(tenant) {
  if (!tenant?.db) return {};
  try {
    const rows = await getTenantDb(tenant.db).collection('brand_images')
      .find({ slot: { $in: ['logo_white', 'logo_primary', 'logo_icon'] } }).toArray();
    const out = {};
    for (const r of rows) if (r.slot && r.url) out[r.slot] = r.url;
    return out;
  } catch {
    return {};
  }
}

/* ──────────────────────────────────────────────────────────────────
 * TEMPLATE — read, interpolate {tokens}, return rendered HTML
 * ────────────────────────────────────────────────────────────────── */

const tmplCache = new Map();
async function loadTemplate(name) {
  if (tmplCache.has(name)) return tmplCache.get(name);
  const tmpl = await readFile(path.join(__dirname, '..', 'views', 'emails', name), 'utf8');
  if (process.env.NODE_ENV === 'production') tmplCache.set(name, tmpl);
  return tmpl;
}

function interpolate(tmpl, tokens) {
  let out = tmpl;
  for (const [key, val] of Object.entries(tokens)) {
    out = out.replaceAll(`{${key}}`, val == null ? '' : String(val));
  }
  return out;
}

/**
 * Build the email header lockup. When the tenant has uploaded a logo we render
 * it as an image (white logo preferred — it sits on the dark primary header);
 * otherwise we fall back to the brand name set in the heading font. The
 * `{headerLogoHtml}` token is interpolated into every template's header.
 */
function logoImgHtml(brandName, logos = {}) {
  const alt = String(brandName).replace(/"/g, '&quot;');
  // A white/transparent logo is made for the dark header band — drop it straight on.
  if (logos?.logo_white) {
    return `<img src="${logos.logo_white}" alt="${alt}" style="display:inline-block;max-height:50px;max-width:240px;width:auto;height:auto;border:0;">`;
  }
  // Otherwise the logo is likely dark/coloured (logo_primary/icon). On the dark
  // header it would vanish, so we seat it on a light chip that keeps it readable
  // regardless of the logo's own colours.
  const url = logos?.logo_primary || logos?.logo_icon || '';
  if (!url) return '';
  return `<span style="display:inline-block;background:#FFFFFF;border-radius:8px;padding:9px 14px;line-height:0;">`
    + `<img src="${url}" alt="${alt}" style="display:inline-block;max-height:42px;max-width:200px;width:auto;height:auto;border:0;">`
    + `</span>`;
}

function headerLogoHtml(brandName, theme, logos = {}) {
  const img = logoImgHtml(brandName, logos);
  if (img) return img;
  return `<div style="font-family:'${theme.font_heading}',Georgia,serif;font-size:24px;color:${theme.on_primary};font-weight:500;letter-spacing:0.6px;line-height:1.1;">${brandName}</div>`;
}

function brandTokens(tenant, theme, logos = {}) {
  const brandName = tenant?.brand?.name || 'Our Team';
  return {
    ...theme,
    brandName,
    brandLocation: tenant?.brand?.location || '',
    supportEmail:  tenant?.public?.zohoUser || tenant?.public?.email || tenant?.brand?.email || '',
    year:          new Date().getFullYear(),
    logoUrl:       logos?.logo_white || logos?.logo_primary || '',
    headerLogoHtml: headerLogoHtml(brandName, theme, logos),
    logoImgHtml:    logoImgHtml(brandName, logos),
  };
}

/* ──────────────────────────────────────────────────────────────────
 * RENDER — return {subject, html} per template type
 * ────────────────────────────────────────────────────────────────── */

export async function renderInvoiceEmail({ invoice, clientDoc, paymentUrl, tenant, theme, logos }) {
  theme = theme || await loadTenantTheme(tenant);
  logos = logos || await loadTenantBrandImages(tenant);
  const tmpl = await loadTemplate('invoice.html');

  let lineItemsHtml = '';
  if (invoice.lineItems?.length) {
    for (const li of invoice.lineItems) {
      const lineTotal = ((parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)).toFixed(2);
      lineItemsHtml += `<tr class="row-border">
        <td style="padding:14px 8px 14px 0;border-bottom:1px solid ${theme.c_border};font-family:'${theme.font_body}',Helvetica,Arial,sans-serif;font-size:14px;color:${theme.c_text};line-height:1.5;">${li.description || ''}</td>
        <td align="center" style="padding:14px 8px;border-bottom:1px solid ${theme.c_border};font-family:'${theme.font_body}',Helvetica,Arial,sans-serif;font-size:14px;color:${theme.c_text_muted};">${li.quantity}</td>
        <td align="right" style="padding:14px 8px;border-bottom:1px solid ${theme.c_border};font-family:'${theme.font_body}',Helvetica,Arial,sans-serif;font-size:14px;color:${theme.c_text_muted};">$${parseFloat(li.unitPrice).toFixed(2)}</td>
        <td align="right" style="padding:14px 0 14px 8px;border-bottom:1px solid ${theme.c_border};font-family:'${theme.font_body}',Helvetica,Arial,sans-serif;font-size:14px;color:${theme.c_text};font-weight:600;">$${lineTotal}</td>
      </tr>`;
    }
  } else {
    lineItemsHtml = `<tr class="row-border">
      <td colspan="3" style="padding:14px 8px 14px 0;border-bottom:1px solid ${theme.c_border};font-family:'${theme.font_body}',Helvetica,Arial,sans-serif;font-size:14px;color:${theme.c_text};">${invoice.title || 'Services'}</td>
      <td align="right" style="padding:14px 0 14px 8px;border-bottom:1px solid ${theme.c_border};font-family:'${theme.font_body}',Helvetica,Arial,sans-serif;font-size:14px;color:${theme.c_text};font-weight:600;">$${invoice.amount.toFixed(2)}</td>
    </tr>`;
  }

  const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
  const dueDateStr = dueDate
    ? dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Upon receipt';
  let dueRelative = '';
  let statusBadge = 'Invoice';
  if (dueDate) {
    const days = Math.round((dueDate - new Date()) / 86400000);
    if (days < 0) { dueRelative = `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`; statusBadge = 'Past Due'; }
    else if (days === 0) { dueRelative = 'Due today'; statusBadge = 'Due Today'; }
    else if (days <= 7) { dueRelative = `Due in ${days} day${days === 1 ? '' : 's'}`; statusBadge = 'Due Soon'; }
    else { dueRelative = `Due in ${days} days`; statusBadge = 'Invoice'; }
  }

  const contactName = clientDoc.name || '';
  const company = clientDoc.company || clientDoc.businessName || '';
  const billToHtml = company && contactName
    ? `${company}<br><span style="font-weight:400;color:${theme.c_text_muted};">${contactName}</span>`
    : (company || contactName || 'Client');
  const clientGreeting = contactName || company || 'there';

  const tokens = {
    ...brandTokens(tenant, theme, logos),
    clientGreeting,
    clientName:    contactName || company || 'Client',
    billToHtml,
    invoiceNumber: invoice.invoiceNumber || '—',
    invoiceTitle:  invoice.title || '',
    amount:        invoice.amount.toFixed(2),
    dueDate:       dueDateStr,
    dueRelative,
    statusBadge,
    lineItemsHtml,
    paymentUrl,
    notes:         invoice.notes || 'Thanks again for your business — we appreciate it.',
  };

  return {
    html:    interpolate(tmpl, tokens),
    subject: `Invoice ${tokens.invoiceNumber} from ${tokens.brandName} — $${tokens.amount}`,
  };
}

export async function renderCampaignEmail({ toEmail, toName, subject, preheader, body, brandDomain, tenant, theme, logos }) {
  theme = theme || await loadTenantTheme(tenant);
  logos = logos || await loadTenantBrandImages(tenant);
  const tmpl = await loadTemplate('campaign.html');
  const personalizedBody = (body || '')
    .replace(/\{name\}/gi, toName || 'there')
    .replace(/\{email\}/gi, toEmail || '');
  const domain = brandDomain || (tenant?.domain ? `https://${tenant.domain}` : '');
  const tokens = {
    ...brandTokens(tenant, theme, logos),
    preheader:      preheader || '',
    body:           personalizedBody,
    unsubscribeUrl: `${domain}/t/unsubscribe?email=${encodeURIComponent(toEmail || '')}`,
  };
  return { html: interpolate(tmpl, tokens), subject };
}

export async function renderWelcomeEmail({ user, dashboardUrl, tagline, tenant, theme, logos }) {
  theme = theme || await loadTenantTheme(tenant);
  logos = logos || await loadTenantBrandImages(tenant);
  const tmpl = await loadTemplate('welcome.html');
  const firstName = (user?.name || user?.firstName || user?.email || 'there').split(' ')[0].split('@')[0];
  const tokens = {
    ...brandTokens(tenant, theme, logos),
    firstName,
    tagline: tagline || `We're glad to have you. Here's everything you need to make the most of your new account.`,
    dashboardUrl: dashboardUrl || (tenant?.domain ? `https://${tenant.domain}/admin` : '#'),
  };
  return {
    html: interpolate(tmpl, tokens),
    subject: `Welcome to ${tokens.brandName}, ${firstName}`,
  };
}

export async function renderPaymentReceiptEmail({ payment, clientDoc, tenant, theme, viewUrl, logos }) {
  theme = theme || await loadTenantTheme(tenant);
  logos = logos || await loadTenantBrandImages(tenant);
  const tmpl = await loadTemplate('payment-receipt.html');
  const paidDate = payment.paidOn ? new Date(payment.paidOn) : new Date();
  const paidOn = paidDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const contactName = clientDoc?.name || '';
  const company = clientDoc?.company || clientDoc?.businessName || '';
  const clientGreeting = contactName || company || 'there';
  const tokens = {
    ...brandTokens(tenant, theme, logos),
    clientGreeting,
    receiptNumber: payment.receiptNumber || `RCT-${Date.now().toString(36).toUpperCase()}`,
    invoiceNumber: payment.invoiceNumber || '—',
    description:   payment.description || 'Professional services',
    paymentMethod: payment.method || 'Card',
    amount:        Number(payment.amount).toFixed(2),
    paidOn,
    viewUrl:       viewUrl || (tenant?.domain ? `https://${tenant.domain}` : '#'),
  };
  return {
    html: interpolate(tmpl, tokens),
    subject: `Receipt — $${tokens.amount} paid to ${tokens.brandName}`,
  };
}

export async function renderBookingConfirmationEmail({ booking, tenant, theme, logos }) {
  theme = theme || await loadTenantTheme(tenant);
  logos = logos || await loadTenantBrandImages(tenant);
  const tmpl = await loadTemplate('booking-confirmation.html');
  const start = booking.start ? new Date(booking.start) : new Date();
  const tokens = {
    ...brandTokens(tenant, theme, logos),
    appointmentTitle: booking.title || 'Your appointment',
    providerName:    booking.providerName || tenant?.brand?.name || 'our team',
    monthShort:      start.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
    dayNum:          start.getDate(),
    weekday:         start.toLocaleString('en-US', { weekday: 'short' }),
    dateLong:        start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    timeLong:        start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    location:        booking.location || tenant?.brand?.location || 'Online',
    prepNotes:       booking.prepNotes || `We'll send a reminder 24 hours before. If anything changes on your end, just reply to this email and we'll work it out.`,
    googleCalUrl:    booking.googleCalUrl || '#',
    icsUrl:          booking.icsUrl || '#',
    manageUrl:       booking.manageUrl || '#',
  };
  return {
    html: interpolate(tmpl, tokens),
    subject: `Confirmed: ${tokens.appointmentTitle} on ${tokens.dateLong}`,
  };
}

export async function renderPasswordResetEmail({ userEmail, resetUrl, expiresIn, tenant, theme, logos }) {
  theme = theme || await loadTenantTheme(tenant);
  logos = logos || await loadTenantBrandImages(tenant);
  const tmpl = await loadTemplate('password-reset.html');
  const tokens = {
    ...brandTokens(tenant, theme, logos),
    userEmail,
    resetUrl,
    expiresIn: expiresIn || '30 minutes',
  };
  return {
    html: interpolate(tmpl, tokens),
    subject: `Reset your ${tokens.brandName} password`,
  };
}

/* ──────────────────────────────────────────────────────────────────
 * SEND — production endpoints that wire render + transporter
 * ────────────────────────────────────────────────────────────────── */

async function tenantSmtp(tenant) {
  const cfg = resolveSmtp(tenant);
  if (cfg.authMode === 'oauth') {
    if (!cfg.user) {
      throw new Error('Email OAuth not connected. Go to Settings → Email and connect your mailbox.');
    }
    // Exchange the stored refresh token for a fresh (cached) access token.
    cfg.accessToken = await getEmailAccessToken(cfg.oauth);
    return cfg;
  }
  if (!cfg.user || !cfg.pass) {
    throw new Error('Email not configured. Go to Settings and add your email provider credentials before sending.');
  }
  return cfg;
}

export async function sendInvoiceEmail(invoice, clientDoc, paymentUrl, tenant) {
  const smtp = await tenantSmtp(tenant);
  const { html, subject } = await renderInvoiceEmail({ invoice, clientDoc, paymentUrl, tenant });
  await getTransporter(smtp).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${smtp.user}>`,
    to: clientDoc.email,
    subject,
    html,
  });
}

export async function sendCampaignEmail(toEmail, toName, subject, preheader, body, campaignId = null, contactId = null, tenant = null) {
  const smtp = await tenantSmtp(tenant);
  const domain = tenant?.domain ? `https://${tenant.domain}` : '';
  let { html } = await renderCampaignEmail({ toEmail, toName, subject, preheader, body, brandDomain: domain, tenant });

  if (campaignId && contactId) {
    const { encodeTrackingToken } = await import('../routes/tracking.js');
    const cid = campaignId.toString();
    const rid = contactId.toString();
    html = html.replace(/<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*?)>/gi, (match, pre, url, post) => {
      if (url.includes('/unsubscribe')) return match;
      const token = encodeTrackingToken({ c: cid, r: rid, u: url });
      return `<a ${pre}href="${domain}/t/c/${token}"${post}>`;
    });
    const openToken = encodeTrackingToken({ c: cid, r: rid });
    const pixel = `<img src="${domain}/t/o/${openToken}" width="1" height="1" alt="" style="border:0;width:1px;height:1px;overflow:hidden;">`;
    html = html.replace('</body>', `${pixel}</body>`);
  }

  await getTransporter(smtp).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${smtp.user}>`,
    to: toEmail,
    subject,
    html,
  });
}

/**
 * Double opt-in confirmation email. Throws (via tenantSmtp) when the tenant has
 * no mailbox configured — the caller uses that to degrade to single opt-in.
 */
export async function sendConfirmEmail({ to, confirmUrl, tenant }) {
  const smtp = await tenantSmtp(tenant);
  const theme = await loadTenantTheme(tenant);
  const brandName = tenant?.brand?.name || 'Our Newsletter';
  const body = `
    <h2 style="margin:0 0 12px;">Confirm your subscription</h2>
    <p style="margin:0 0 18px;">Thanks for signing up to hear from ${brandName}. Tap the button below to confirm your email address and start receiving updates.</p>
    <p style="margin:0 0 22px;"><a href="${confirmUrl}" style="display:inline-block;padding:13px 30px;background:${theme.button_bg};color:${theme.button_text};text-decoration:none;font-weight:600;border-radius:4px;">Confirm subscription</a></p>
    <p style="margin:0;font-size:13px;color:${theme.c_text_muted};">If you didn't request this, you can safely ignore this email — no subscription will be created.</p>`;
  const { html } = await renderCampaignEmail({
    toEmail: to, toName: '', subject: `Confirm your subscription to ${brandName}`,
    preheader: 'One quick click to confirm your email', body, tenant, theme,
  });
  await getTransporter(smtp).sendMail({
    from: `"${brandName}" <${smtp.user}>`,
    to,
    subject: `Confirm your subscription to ${brandName}`,
    html,
  });
}

/** Welcome / autoresponder email fired after a signup is confirmed. */
export async function sendFormWelcomeEmail({ to, name, subject, body, tenant }) {
  const smtp = await tenantSmtp(tenant);
  const { html } = await renderCampaignEmail({
    toEmail: to, toName: name, subject: subject || 'Welcome',
    preheader: '', body: body || '', tenant,
  });
  await getTransporter(smtp).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${smtp.user}>`,
    to,
    subject: subject || `Welcome to ${tenant?.brand?.name || 'our newsletter'}`,
    html,
  });
}

export function formatEmailBody(body, opts = {}) {
  if (!body) return '';
  // Rich-text / pasted HTML → run it through the email-safe sanitizer so the
  // markup that reaches the recipient renders consistently across clients.
  const hasHtml = /<(p|div|br|table|ul|ol|h[1-6]|blockquote|strong|em|a|img|span)[\s>/]/i.test(body);
  if (hasHtml) return sanitizeEmailHtml(body, opts);
  // Plain text → paragraph-wrap (already safe).
  const paragraphs = body.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs
    .map(p => `<p style="margin:0 0 14px;">${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export async function sendClientEmail(to, cc, subject, body, threadHeaders = null, tenant = null, attachments = null) {
  const smtp = await tenantSmtp(tenant);
  const theme = await loadTenantTheme(tenant);
  const { html } = await renderCampaignEmail({
    toEmail: to,
    body: formatEmailBody(body, { accent: theme.c_accent }),
    preheader: '',
    brandDomain: '',
    tenant,
    theme,
  });

  const mailOpts = {
    from: `"${tenant?.brand?.name || 'Our Team'}" <${smtp.user}>`,
    to,
    subject,
    html,
    replyTo: smtp.user,
  };
  if (cc?.length) mailOpts.cc = cc.join(', ');
  if (threadHeaders?.inReplyTo) mailOpts.inReplyTo = threadHeaders.inReplyTo;
  if (threadHeaders?.references) mailOpts.references = threadHeaders.references;
  // attachments: [{ filename, href|path, contentType }] — nodemailer fetches
  // href URLs (our S3 objects) itself, so we never buffer them in this process.
  if (attachments?.length) mailOpts.attachments = attachments;

  return getTransporter(smtp).sendMail(mailOpts);
}

export async function sendWelcomeEmail({ to, user, dashboardUrl, tagline, tenant }) {
  const smtp = await tenantSmtp(tenant);
  const { html, subject } = await renderWelcomeEmail({ user, dashboardUrl, tagline, tenant });
  await getTransporter(smtp).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${smtp.user}>`,
    to,
    subject,
    html,
  });
}

export async function sendPaymentReceiptEmail({ payment, clientDoc, viewUrl, tenant }) {
  const smtp = await tenantSmtp(tenant);
  const { html, subject } = await renderPaymentReceiptEmail({ payment, clientDoc, viewUrl, tenant });
  await getTransporter(smtp).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${smtp.user}>`,
    to: clientDoc.email,
    subject,
    html,
  });
}

export async function sendBookingConfirmationEmail({ booking, to, tenant }) {
  const smtp = await tenantSmtp(tenant);
  const { html, subject } = await renderBookingConfirmationEmail({ booking, tenant });
  await getTransporter(smtp).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${smtp.user}>`,
    to,
    subject,
    html,
  });
}

export async function sendPasswordResetEmail({ to, resetUrl, expiresIn, tenant }) {
  const smtp = await tenantSmtp(tenant);
  const { html, subject } = await renderPasswordResetEmail({ userEmail: to, resetUrl, expiresIn, tenant });
  await getTransporter(smtp).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${smtp.user}>`,
    to,
    subject,
    html,
  });
}
