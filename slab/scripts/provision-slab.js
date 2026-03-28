#!/usr/bin/env node
/**
 * Slab — Provision the "slab" tenant (platform dogfood)
 * Creates the slab.madladslab.com tenant with slab-dark theme.
 *
 * Usage: node scripts/provision-slab.js
 */

import { connectDB, getTenantDb } from '../plugins/mongo.js';
import { provisionTenant } from '../plugins/provision.js';
import '../config/config.js';

const SLAB_DARK_DESIGN = [
  { key: 'color_primary', value: '#C9A848' },
  { key: 'color_primary_deep', value: '#0a0a0a' },
  { key: 'color_primary_mid', value: '#141414' },
  { key: 'color_accent', value: '#C9A848' },
  { key: 'color_accent_light', value: '#d4b85c' },
  { key: 'color_bg', value: '#0a0a0a' },
  { key: 'font_heading', value: 'Inter' },
  { key: 'font_body', value: 'Inter' },
  { key: 'landing_layout', value: 'dark' },
  { key: 'vis_hero', value: 'true' },
  { key: 'vis_services', value: 'true' },
  { key: 'vis_portfolio', value: 'true' },
  { key: 'vis_about', value: 'true' },
  { key: 'vis_process', value: 'true' },
  { key: 'vis_reviews', value: 'false' },
  { key: 'vis_contact', value: 'true' },
  { key: 'vis_blog', value: 'true' },
  { key: 'agent_name', value: 'Slab' },
  { key: 'agent_greeting', value: 'Welcome to Slab — your white-label SaaS platform.' },
];

const SLAB_COPY = [
  { key: 'hero_heading', value: 'Your Brand. Your Platform. Zero Code.' },
  { key: 'hero_subheading', value: 'Slab gives agencies and entrepreneurs a fully loaded SaaS platform — design, content, invoicing, email marketing, AI agents — all under your own brand.' },
  { key: 'hero_cta', value: 'Get Started Free' },
  { key: 'services_heading', value: 'Everything You Need' },
  { key: 'service1_title', value: 'White-Label Branding' },
  { key: 'service1_description', value: 'Your logo, your colors, your domain. Clients never see Slab — they see you.' },
  { key: 'service2_title', value: 'Client Management' },
  { key: 'service2_description', value: 'Onboard clients, track projects, manage meetings, and handle invoicing in one place.' },
  { key: 'service3_title', value: 'AI-Powered Content' },
  { key: 'service3_description', value: 'Built-in AI agents that write copy, research clients, and generate designs on demand.' },
  { key: 'service4_title', value: 'Email Marketing' },
  { key: 'service4_description', value: 'Campaign builder with open/click tracking, funnel segmentation, and automated follow-ups.' },
  { key: 'about_heading', value: 'Built by Operators, for Operators' },
  { key: 'about_body', value: 'Slab started because we needed it ourselves. We ran agencies and got tired of duct-taping five different tools together. So we built one platform that does it all — and made it white-label so you can too.' },
  { key: 'process_heading', value: 'Go Live in Minutes' },
  { key: 'process_step1_title', value: 'Sign Up' },
  { key: 'process_step1_description', value: 'Create your account and pick your subdomain. Free preview — no card required.' },
  { key: 'process_step2_title', value: 'Brand It' },
  { key: 'process_step2_description', value: 'Set your colors, logo, fonts, and content. The design builder makes it instant.' },
  { key: 'process_step3_title', value: 'Go Live' },
  { key: 'process_step3_description', value: 'Choose a plan, connect your domain, and launch. Your clients see your brand, not ours.' },
  { key: 'contact_heading', value: 'Ready to Launch?' },
  { key: 'contact_subheading', value: 'Start building your platform today — free preview, no credit card.' },
];

await connectDB();

try {
  const result = await provisionTenant({
    subdomain: 'slab',
    brandName: 'Slab',
    brandLocation: '',
    ownerEmail: 'snoryder8019@gmail.com',
  });

  console.log(`\nSlab tenant provisioned: ${result.domain}`);

  // Apply slab-dark design
  const db = getTenantDb(result.dbName);
  const designOps = SLAB_DARK_DESIGN.map(d =>
    db.collection('design').updateOne(
      { key: d.key },
      { $set: { key: d.key, value: d.value, updatedAt: new Date() } },
      { upsert: true }
    )
  );
  await Promise.all(designOps);
  console.log('Slab-dark design applied');

  // Seed copy
  const copyOps = SLAB_COPY.map(c =>
    db.collection('copy').updateOne(
      { key: c.key },
      { $set: { key: c.key, value: c.value, updatedAt: new Date() } },
      { upsert: true }
    )
  );
  await Promise.all(copyOps);
  console.log('Slab copy seeded');

  // Save slab-dark as a reusable theme
  await db.collection('themes').insertOne({
    name: 'Slab Dark',
    settings: Object.fromEntries(
      SLAB_DARK_DESIGN.filter(d => d.key.startsWith('color_') || d.key.startsWith('font_') || d.key === 'landing_layout')
        .map(d => [d.key, d.value])
    ),
    createdAt: new Date(),
  });
  console.log('Slab Dark theme saved');

  // Update brand profile
  const { getSlabDb } = await import('../plugins/mongo.js');
  const slab = getSlabDb();
  await slab.collection('tenants').updateOne(
    { domain: result.domain },
    {
      $set: {
        'brand.tagline': 'Your Brand. Your Platform. Zero Code.',
        'brand.description': 'White-label SaaS platform for agencies and entrepreneurs.',
        'brand.industry': 'SaaS / Technology',
        'brand.businessType': 'Platform',
        'brand.services': ['White-Label Websites', 'Client Management', 'Invoicing', 'Email Marketing', 'AI Content', 'Portfolio Builder'],
        'brand.targetAudience': 'Agencies, freelancers, and entrepreneurs who want their own branded platform',
        'brand.brandVoice': 'Direct, confident, technical but accessible',
        updatedAt: new Date(),
      },
    }
  );
  console.log('Brand profile updated');

  console.log(`\n  Admin:  https://${result.domain}/admin`);
  console.log(`  Site:   https://${result.domain}`);
  console.log(`  Theme:  Slab Dark`);
} catch (err) {
  if (err.message.includes('already exists')) {
    console.log('Slab tenant already exists — skipping provisioning.');
    console.log('To re-provision, delete the tenant first.');
  } else {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}

process.exit(0);
