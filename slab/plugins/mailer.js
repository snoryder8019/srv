import nodemailer from 'nodemailer';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTenantDb } from './mongo.js';
import { contrastRatio, mixHex, readableTextColor, enrichDesignContrast } from './colorContrast.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const transporterCache = new Map();

function getTransporter(zohoUser, zohoPass) {
  if (transporterCache.has(zohoUser)) return transporterCache.get(zohoUser);
  const t = nodemailer.createTransport({
    host: 'smtppro.zoho.com',
    port: 465,
    secure: true,
    authMethod: 'LOGIN',
    auth: { user: zohoUser, pass: zohoPass },
  });
  transporterCache.set(zohoUser, t);
  return t;
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

function brandTokens(tenant, theme) {
  return {
    ...theme,
    brandName:     tenant?.brand?.name || 'Our Team',
    brandLocation: tenant?.brand?.location || '',
    supportEmail:  tenant?.public?.zohoUser || tenant?.public?.email || tenant?.brand?.email || '',
    year:          new Date().getFullYear(),
  };
}

/* ──────────────────────────────────────────────────────────────────
 * RENDER — return {subject, html} per template type
 * ────────────────────────────────────────────────────────────────── */

export async function renderInvoiceEmail({ invoice, clientDoc, paymentUrl, tenant, theme }) {
  theme = theme || await loadTenantTheme(tenant);
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
    ...brandTokens(tenant, theme),
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

export async function renderCampaignEmail({ toEmail, toName, subject, preheader, body, brandDomain, tenant, theme }) {
  theme = theme || await loadTenantTheme(tenant);
  const tmpl = await loadTemplate('campaign.html');
  const personalizedBody = (body || '')
    .replace(/\{name\}/gi, toName || 'there')
    .replace(/\{email\}/gi, toEmail || '');
  const domain = brandDomain || (tenant?.domain ? `https://${tenant.domain}` : '');
  const tokens = {
    ...brandTokens(tenant, theme),
    preheader:      preheader || '',
    body:           personalizedBody,
    unsubscribeUrl: `${domain}/t/unsubscribe?email=${encodeURIComponent(toEmail || '')}`,
  };
  return { html: interpolate(tmpl, tokens), subject };
}

export async function renderWelcomeEmail({ user, dashboardUrl, tagline, tenant, theme }) {
  theme = theme || await loadTenantTheme(tenant);
  const tmpl = await loadTemplate('welcome.html');
  const firstName = (user?.name || user?.firstName || user?.email || 'there').split(' ')[0].split('@')[0];
  const tokens = {
    ...brandTokens(tenant, theme),
    firstName,
    tagline: tagline || `We're glad to have you. Here's everything you need to make the most of your new account.`,
    dashboardUrl: dashboardUrl || (tenant?.domain ? `https://${tenant.domain}/admin` : '#'),
  };
  return {
    html: interpolate(tmpl, tokens),
    subject: `Welcome to ${tokens.brandName}, ${firstName}`,
  };
}

export async function renderPaymentReceiptEmail({ payment, clientDoc, tenant, theme, viewUrl }) {
  theme = theme || await loadTenantTheme(tenant);
  const tmpl = await loadTemplate('payment-receipt.html');
  const paidDate = payment.paidOn ? new Date(payment.paidOn) : new Date();
  const paidOn = paidDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const contactName = clientDoc?.name || '';
  const company = clientDoc?.company || clientDoc?.businessName || '';
  const clientGreeting = contactName || company || 'there';
  const tokens = {
    ...brandTokens(tenant, theme),
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

export async function renderBookingConfirmationEmail({ booking, tenant, theme }) {
  theme = theme || await loadTenantTheme(tenant);
  const tmpl = await loadTemplate('booking-confirmation.html');
  const start = booking.start ? new Date(booking.start) : new Date();
  const tokens = {
    ...brandTokens(tenant, theme),
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

export async function renderPasswordResetEmail({ userEmail, resetUrl, expiresIn, tenant, theme }) {
  theme = theme || await loadTenantTheme(tenant);
  const tmpl = await loadTemplate('password-reset.html');
  const tokens = {
    ...brandTokens(tenant, theme),
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

function tenantCreds(tenant) {
  const zohoUser = tenant?.secrets?.zohoUser || tenant?.public?.zohoUser;
  const zohoPass = tenant?.secrets?.zohoPass;
  if (!zohoUser || !zohoPass) {
    throw new Error('Email not configured. Go to Settings and add your Zoho email credentials before sending.');
  }
  return { zohoUser, zohoPass };
}

export async function sendInvoiceEmail(invoice, clientDoc, paymentUrl, tenant) {
  const { zohoUser, zohoPass } = tenantCreds(tenant);
  const { html, subject } = await renderInvoiceEmail({ invoice, clientDoc, paymentUrl, tenant });
  await getTransporter(zohoUser, zohoPass).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${zohoUser}>`,
    to: clientDoc.email,
    subject,
    html,
  });
}

export async function sendCampaignEmail(toEmail, toName, subject, preheader, body, campaignId = null, contactId = null, tenant = null) {
  const { zohoUser, zohoPass } = tenantCreds(tenant);
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

  await getTransporter(zohoUser, zohoPass).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${zohoUser}>`,
    to: toEmail,
    subject,
    html,
  });
}

function formatEmailBody(body) {
  if (!body) return '';
  const hasBlockHtml = /<(p|div|br|table|ul|ol|h[1-6]|blockquote)[\s>/]/i.test(body);
  if (hasBlockHtml) return body;
  const paragraphs = body.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs
    .map(p => `<p style="margin:0 0 14px;">${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export async function sendClientEmail(to, cc, subject, body, threadHeaders = null, tenant = null) {
  const { zohoUser, zohoPass } = tenantCreds(tenant);
  const { html } = await renderCampaignEmail({
    toEmail: to,
    body: formatEmailBody(body),
    preheader: '',
    brandDomain: '',
    tenant,
  });

  const mailOpts = {
    from: `"${tenant?.brand?.name || 'Our Team'}" <${zohoUser}>`,
    to,
    subject,
    html,
    replyTo: zohoUser,
  };
  if (cc?.length) mailOpts.cc = cc.join(', ');
  if (threadHeaders?.inReplyTo) mailOpts.inReplyTo = threadHeaders.inReplyTo;
  if (threadHeaders?.references) mailOpts.references = threadHeaders.references;

  return getTransporter(zohoUser, zohoPass).sendMail(mailOpts);
}

export async function sendWelcomeEmail({ to, user, dashboardUrl, tagline, tenant }) {
  const { zohoUser, zohoPass } = tenantCreds(tenant);
  const { html, subject } = await renderWelcomeEmail({ user, dashboardUrl, tagline, tenant });
  await getTransporter(zohoUser, zohoPass).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${zohoUser}>`,
    to,
    subject,
    html,
  });
}

export async function sendPaymentReceiptEmail({ payment, clientDoc, viewUrl, tenant }) {
  const { zohoUser, zohoPass } = tenantCreds(tenant);
  const { html, subject } = await renderPaymentReceiptEmail({ payment, clientDoc, viewUrl, tenant });
  await getTransporter(zohoUser, zohoPass).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${zohoUser}>`,
    to: clientDoc.email,
    subject,
    html,
  });
}

export async function sendBookingConfirmationEmail({ booking, to, tenant }) {
  const { zohoUser, zohoPass } = tenantCreds(tenant);
  const { html, subject } = await renderBookingConfirmationEmail({ booking, tenant });
  await getTransporter(zohoUser, zohoPass).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${zohoUser}>`,
    to,
    subject,
    html,
  });
}

export async function sendPasswordResetEmail({ to, resetUrl, expiresIn, tenant }) {
  const { zohoUser, zohoPass } = tenantCreds(tenant);
  const { html, subject } = await renderPasswordResetEmail({ userEmail: to, resetUrl, expiresIn, tenant });
  await getTransporter(zohoUser, zohoPass).sendMail({
    from: `"${tenant?.brand?.name || 'Our Team'}" <${zohoUser}>`,
    to,
    subject,
    html,
  });
}
