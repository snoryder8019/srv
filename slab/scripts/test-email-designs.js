#!/usr/bin/env node
/**
 * test-email-designs.js
 *
 * Sends one of every email template, rendered for two different tenant brands,
 * to a single test inbox. Uses the slab .env Zoho creds (not tenant secrets).
 *
 * Usage:  node scripts/test-email-designs.js
 */

import 'dotenv/config';
import nodemailer from 'nodemailer';
import { connectDB, getSlabDb } from '../plugins/mongo.js';
import {
  loadTenantTheme,
  renderInvoiceEmail,
  renderCampaignEmail,
  renderWelcomeEmail,
  renderPaymentReceiptEmail,
  renderBookingConfirmationEmail,
  renderPasswordResetEmail,
} from '../plugins/mailer.js';

const TO = 'scott@madladslab.com';
// Pick brands whose design tokens actually differ, so the per-tenant theming is visible
const BRANDS = [
  'madladslab.madladslab.com',       // navy + gold, Oswald/Jost      — refined
  'nocometalworkz.com',              // navy + orange, Bebas/Inter    — industrial
  'mobilemeadows.madladslab.com',    // orange primary, Garamond/Jost — warm
];

const SAMPLE_INVOICE = {
  invoiceNumber: 'INV-1042',
  title: 'Monthly retainer — May 2026',
  amount: 1850.00,
  dueDate: new Date(Date.now() + 5 * 86400000),
  notes: 'Net 15. Payment via Stripe or ACH. Thanks again for the continued partnership — May was a great month.',
  lineItems: [
    { description: 'Site hosting + monitoring (May)',         quantity: 1, unitPrice: 149.00 },
    { description: 'Content updates & blog posts (4 articles)', quantity: 4, unitPrice: 175.00 },
    { description: 'SEO audit & on-page improvements',         quantity: 1, unitPrice: 450.00 },
    { description: 'Strategy call (60 min)',                   quantity: 1, unitPrice: 151.00 },
  ],
};

const SAMPLE_CLIENT = {
  name:    'Casey Morgan',
  company: 'Front Range Outfitters',
  email:   TO,
};

const SAMPLE_PAYMENT = {
  receiptNumber: 'RCT-7741X',
  invoiceNumber: 'INV-1042',
  description:   'Monthly retainer — May 2026',
  method:        'Visa ending 4242',
  amount:        1850.00,
  paidOn:        new Date(),
};

const SAMPLE_BOOKING = {
  title:        'Discovery call & site walkthrough',
  providerName: null,                            // falls back to brand name
  start:        new Date(Date.now() + 3 * 86400000 + 14.5 * 3600000),
  location:     '917 9th St, Downtown Greeley (or Zoom — link in calendar invite)',
  prepNotes:    "Bring a list of the top 3 things you want visitors to do on your site. We'll review your current analytics, sketch the structure, and have a build estimate by end of call.",
  googleCalUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Discovery+call',
  icsUrl:       'https://example.com/booking/12345/ics',
  manageUrl:    'https://example.com/booking/12345/manage',
};

async function main() {
  const zohoUser = process.env.ZOHO_USER;
  const zohoPass = process.env.ZOHO_PASS;
  if (!zohoUser || !zohoPass) {
    console.error('Missing ZOHO_USER / ZOHO_PASS in /srv/slab/.env');
    process.exit(1);
  }

  await connectDB();
  const slab = getSlabDb();

  const transporter = nodemailer.createTransport({
    host: 'smtppro.zoho.com',
    port: 465,
    secure: true,
    authMethod: 'LOGIN',
    auth: { user: zohoUser, pass: zohoPass },
  });

  for (const domain of BRANDS) {
    const tenant = await slab.collection('tenants').findOne({ domain });
    if (!tenant) {
      console.warn(`  skip — no tenant found for ${domain}`);
      continue;
    }
    const theme = await loadTenantTheme(tenant);
    const tag = `[${tenant.brand?.name || tenant.domain}]`;
    console.log(`\n── ${tag} (${tenant.domain}) ──`);
    console.log(`   theme: primary=${theme.c_primary} accent=${theme.c_accent} bg=${theme.c_bg}`);

    const renders = [
      { name: 'invoice',              ...(await renderInvoiceEmail({ invoice: SAMPLE_INVOICE, clientDoc: SAMPLE_CLIENT, paymentUrl: `https://${tenant.domain}/pay/inv-1042`, tenant, theme })) },
      { name: 'welcome',              ...(await renderWelcomeEmail({ user: { name: 'Casey Morgan', email: TO }, dashboardUrl: `https://${tenant.domain}/admin`, tagline: `Your white-label platform is ready. Build a site, launch in days, and own every byte of it.`, tenant, theme })) },
      { name: 'payment-receipt',      ...(await renderPaymentReceiptEmail({ payment: SAMPLE_PAYMENT, clientDoc: SAMPLE_CLIENT, viewUrl: `https://${tenant.domain}/receipt/7741x`, tenant, theme })) },
      { name: 'booking-confirmation', ...(await renderBookingConfirmationEmail({ booking: SAMPLE_BOOKING, tenant, theme })) },
      { name: 'password-reset',       ...(await renderPasswordResetEmail({ userEmail: TO, resetUrl: `https://${tenant.domain}/auth/reset?token=abc123XYZdef456`, expiresIn: '30 minutes', tenant, theme })) },
      { name: 'campaign',             ...(await renderCampaignEmail({
        toEmail: TO,
        toName: 'Casey',
        subject: `A few quick wins for you, {name}`,
        preheader: 'Three things we noticed about your site that could double your inquiries.',
        body: `Hi {name},\n\nWe've been keeping an eye on the way prospects move through your site over the last 30 days. A few patterns jumped out — and they're easy fixes.\n\n<strong>1. The contact form is a scroll away.</strong> 64% of mobile visitors never reach it. Pulling it up to the hero would change that.\n\n<strong>2. Your reviews section is underselling you.</strong> You've got real testimonials buried below the fold. They belong near the top, with the names attached.\n\n<strong>3. The "About" page is the second-most-visited page on the site.</strong> People want to know who you are. Let's give them more to read.\n\nIf any of this resonates, hit reply and we'll put a short proposal together. No charge for the audit itself.`,
        brandDomain: `https://${tenant.domain}`,
        tenant, theme,
      })) },
    ];

    for (const r of renders) {
      const subjectTagged = `${tag} ${r.subject}`;
      try {
        await transporter.sendMail({
          from: `"${tenant.brand?.name || 'Slab Test'}" <${zohoUser}>`,
          to: TO,
          subject: subjectTagged,
          html: r.html,
        });
        console.log(`   ✓ ${r.name.padEnd(22)} → ${TO}`);
      } catch (err) {
        console.error(`   ✗ ${r.name.padEnd(22)} FAILED: ${err.message}`);
      }
    }
  }

  console.log(`\nDone. Check ${TO} — ${BRANDS.length * 6} messages expected.`);
  process.exit(0);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
