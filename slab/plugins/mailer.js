import nodemailer from 'nodemailer';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache transporters per zoho user to avoid re-creating
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

/** Send an invoice email to a client */
export async function sendInvoiceEmail(invoice, clientDoc, paymentUrl, tenant) {
  const brandName = tenant?.brand?.name || 'Our Team';
  const zohoUser = tenant?.secrets?.zohoUser || tenant?.public?.zohoUser;
  const zohoPass = tenant?.secrets?.zohoPass;
  if (!zohoUser || !zohoPass) throw new Error('Email not configured. Go to Settings and add your Zoho email credentials before sending.');
  const tmpl = await readFile(path.join(__dirname, '..', 'views', 'emails', 'invoice.html'), 'utf8');

  // Build line items HTML
  let lineItemsHtml = '';
  if (invoice.lineItems?.length) {
    for (const li of invoice.lineItems) {
      const lineTotal = ((parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)).toFixed(2);
      lineItemsHtml += `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #E6E1D6;font-family:'Jost',Helvetica,Arial,sans-serif;font-size:14px;color:#0F1B30;">${li.description || ''}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #E6E1D6;text-align:center;font-family:'Jost',Helvetica,Arial,sans-serif;font-size:14px;color:#6B7380;">${li.quantity}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #E6E1D6;text-align:right;font-family:'Jost',Helvetica,Arial,sans-serif;font-size:14px;color:#6B7380;">$${parseFloat(li.unitPrice).toFixed(2)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #E6E1D6;text-align:right;font-family:'Jost',Helvetica,Arial,sans-serif;font-size:14px;color:#0F1B30;font-weight:500;">$${lineTotal}</td>
      </tr>`;
    }
  } else {
    lineItemsHtml = `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #E6E1D6;font-family:'Jost',Helvetica,Arial,sans-serif;font-size:14px;color:#0F1B30;" colspan="3">${invoice.title}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E6E1D6;text-align:right;font-family:'Jost',Helvetica,Arial,sans-serif;font-size:14px;color:#0F1B30;font-weight:500;">$${invoice.amount.toFixed(2)}</td>
    </tr>`;
  }

  const dueDateStr = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Upon receipt';

  const brandLocation = tenant?.brand?.location || '';

  // Bill-to: prefer the client's business/company name, fall back to contact name
  const contactName = clientDoc.name || '';
  const company = clientDoc.company || clientDoc.businessName || '';
  const billToHtml = company && contactName
    ? `${company}<br><span style="font-weight:400;color:#6B7380;">${contactName}</span>`
    : (company || contactName || 'Client');
  // Greeting: contact name if we have it, otherwise the company
  const clientGreeting = contactName || company || 'there';

  const html = tmpl
    .replace(/\{brandName\}/g, brandName)
    .replace(/\{brandLocation\}/g, brandLocation)
    .replace(/\{clientGreeting\}/g, clientGreeting)
    .replace(/\{clientName\}/g, contactName || company || 'Client')
    .replace(/\{billToHtml\}/g, billToHtml)
    .replace(/\{invoiceNumber\}/g, invoice.invoiceNumber || '—')
    .replace(/\{invoiceTitle\}/g, invoice.title || '')
    .replace(/\{amount\}/g, invoice.amount.toFixed(2))
    .replace(/\{dueDate\}/g, dueDateStr)
    .replace(/\{lineItemsHtml\}/g, lineItemsHtml)
    .replace(/\{paymentUrl\}/g, paymentUrl)
    .replace(/\{notes\}/g, invoice.notes || '');

  await getTransporter(zohoUser, zohoPass).sendMail({
    from: `"${brandName}" <${zohoUser}>`,
    to: clientDoc.email,
    subject: `Invoice ${invoice.invoiceNumber} from ${brandName} — $${invoice.amount.toFixed(2)}`,
    html,
  });
}

/** Send a campaign/marketing email (with open/click tracking) */
export async function sendCampaignEmail(toEmail, toName, subject, preheader, body, campaignId = null, contactId = null, tenant = null) {
  const brandName = tenant?.brand?.name || 'Our Team';
  const domain = tenant?.domain ? `https://${tenant.domain}` : '';
  const zohoUser = tenant?.secrets?.zohoUser || tenant?.public?.zohoUser;
  const zohoPass = tenant?.secrets?.zohoPass;
  if (!zohoUser || !zohoPass) throw new Error('Email not configured. Go to Settings and add your Zoho email credentials before sending.');
  const tmpl = await readFile(path.join(__dirname, '..', 'views', 'emails', 'campaign.html'), 'utf8');

  // Personalize body content
  const personalizedBody = body
    .replace(/\{name\}/gi, toName || 'there')
    .replace(/\{email\}/gi, toEmail);

  const brandLocation = tenant?.brand?.location || '';

  let html = tmpl
    .replace(/\{brandName\}/g, brandName)
    .replace(/\{brandLocation\}/g, brandLocation)
    .replace(/\{preheader\}/g, preheader || '')
    .replace(/\{body\}/g, personalizedBody)
    .replace(/\{unsubscribeUrl\}/g, `${domain}/t/unsubscribe?email=${encodeURIComponent(toEmail)}`);

  // Add tracking if campaign/contact IDs provided
  if (campaignId && contactId) {
    const { encodeTrackingToken } = await import('../routes/tracking.js');
    const cid = campaignId.toString();
    const rid = contactId.toString();

    // Rewrite links for click tracking (skip unsubscribe links)
    html = html.replace(/<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*?)>/gi, (match, pre, url, post) => {
      if (url.includes('/unsubscribe')) return match;
      const token = encodeTrackingToken({ c: cid, r: rid, u: url });
      return `<a ${pre}href="${domain}/t/c/${token}"${post}>`;
    });

    // Inject open tracking pixel before </body>
    const openToken = encodeTrackingToken({ c: cid, r: rid });
    const pixel = `<img src="${domain}/t/o/${openToken}" width="1" height="1" alt="" style="border:0;width:1px;height:1px;overflow:hidden;">`;
    html = html.replace('</body>', `${pixel}</body>`);
  }

  await getTransporter(zohoUser, zohoPass).sendMail({
    from: `"${brandName}" <${zohoUser}>`,
    to: toEmail,
    subject,
    html,
  });
}

/**
 * If body has no block-level HTML, treat it as plain text and convert
 * blank lines → paragraph breaks and single newlines → <br>. Inline tags
 * the user may have inserted (<strong>, <a>, <img>) survive untouched.
 */
function formatEmailBody(body) {
  if (!body) return '';
  const hasBlockHtml = /<(p|div|br|table|ul|ol|h[1-6]|blockquote)[\s>/]/i.test(body);
  if (hasBlockHtml) return body;
  const paragraphs = body.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs
    .map(p => `<p style="margin:0 0 14px;">${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Send a direct email to a client (plain or HTML body, with CC support and threading headers) */
export async function sendClientEmail(to, cc, subject, body, threadHeaders = null, tenant = null) {
  const brandName = tenant?.brand?.name || 'Our Team';
  const zohoUser = tenant?.secrets?.zohoUser || tenant?.public?.zohoUser;
  const zohoPass = tenant?.secrets?.zohoPass;
  if (!zohoUser || !zohoPass) throw new Error('Email not configured. Go to Settings and add your Zoho email credentials before sending.');
  const tmpl = await readFile(path.join(__dirname, '..', 'views', 'emails', 'campaign.html'), 'utf8');

  const brandLocation = tenant?.brand?.location || '';

  const html = tmpl
    .replace(/\{brandName\}/g, brandName)
    .replace(/\{brandLocation\}/g, brandLocation)
    .replace(/\{preheader\}/g, '')
    .replace(/\{body\}/g, formatEmailBody(body))
    .replace(/\{unsubscribeUrl\}/g, '#');

  const mailOpts = {
    from: `"${brandName}" <${zohoUser}>`,
    to,
    subject,
    html,
    replyTo: zohoUser,
  };
  if (cc?.length) mailOpts.cc = cc.join(', ');

  // Thread headers — makes replies appear in the same thread in Gmail/Outlook/etc
  if (threadHeaders?.inReplyTo) mailOpts.inReplyTo = threadHeaders.inReplyTo;
  if (threadHeaders?.references) mailOpts.references = threadHeaders.references;

  const info = await getTransporter(zohoUser, zohoPass).sendMail(mailOpts);
  return info; // contains messageId for threading
}
