/**
 * Slab — Brand Builder Wizard
 * /admin/brand-builder        → multi-step brand setup wizard
 * /admin/brand-builder/save   → save brand info + mark complete
 * /admin/brand-builder/preset → apply industry preset
 *
 * Shown after first login when brand.setupComplete is false.
 */

import express from 'express';
import { getSlabDb } from '../../plugins/mongo.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import { DESIGN_DEFAULTS } from './design.js';

const router = express.Router();

// ── Industry presets — seeded defaults for new brands ──────────────────────
export const INDUSTRY_PRESETS = {
  restaurant: {
    label: 'Restaurant / Food Service',
    businessType: 'Restaurant',
    industry: 'Food & Beverage',
    brandVoice: 'Warm, inviting, appetizing',
    targetAudience: 'Local diners, foodies, families',
    services: ['Dine-In', 'Takeout', 'Catering', 'Private Events'],
    design: { color_primary: '#2D1B0E', color_accent: '#C8553D', color_bg: '#FFF8F0', font_heading: 'Playfair Display', font_body: 'Inter' },
    copy: { hero_sub: 'Fresh flavors, warm hospitality' },
    sections: ['Menu', 'Hours & Location', 'Reservations', 'Gallery'],
  },
  agency: {
    label: 'Marketing / Creative Agency',
    businessType: 'Agency',
    industry: 'Marketing & Advertising',
    brandVoice: 'Bold, strategic, results-driven',
    targetAudience: 'Small businesses, startups, brands seeking growth',
    services: ['Brand Strategy', 'Digital Marketing', 'Web Design', 'Social Media', 'Content Creation'],
    design: { color_primary: '#1C2B4A', color_accent: '#C9A848', color_bg: '#F5F3EF', font_heading: 'Cormorant Garamond', font_body: 'Jost' },
    copy: { hero_sub: 'Strategy that moves the needle' },
    sections: ['Services', 'Case Studies', 'Process', 'Testimonials'],
  },
  salon: {
    label: 'Salon / Beauty / Spa',
    businessType: 'Salon',
    industry: 'Beauty & Wellness',
    brandVoice: 'Elegant, relaxing, confident',
    targetAudience: 'Women 25-55, self-care enthusiasts, bridal parties',
    services: ['Haircuts & Styling', 'Color', 'Facials', 'Nails', 'Waxing'],
    design: { color_primary: '#3D2B4A', color_accent: '#D4A373', color_bg: '#FDF6F0', font_heading: 'Playfair Display', font_body: 'Raleway' },
    copy: { hero_sub: 'Where beauty meets confidence' },
    sections: ['Services & Pricing', 'Gallery', 'Book Online', 'Reviews'],
  },
  contractor: {
    label: 'Contractor / Home Services',
    businessType: 'Contractor',
    industry: 'Construction & Home Improvement',
    brandVoice: 'Trustworthy, skilled, straightforward',
    targetAudience: 'Homeowners, property managers, real estate agents',
    services: ['Remodeling', 'Plumbing', 'Electrical', 'Painting', 'Roofing'],
    design: { color_primary: '#1a3a1a', color_accent: '#D4A843', color_bg: '#F5F5F0', font_heading: 'DM Sans', font_body: 'Inter' },
    copy: { hero_sub: 'Quality craftsmanship you can trust' },
    sections: ['Services', 'Gallery', 'Free Estimate', 'Reviews'],
  },
  fitness: {
    label: 'Fitness / Gym / Personal Training',
    businessType: 'Fitness Studio',
    industry: 'Health & Fitness',
    brandVoice: 'Motivating, energetic, supportive',
    targetAudience: 'Health-conscious adults, athletes, beginners',
    services: ['Personal Training', 'Group Classes', 'Nutrition Coaching', 'Online Programs'],
    design: { color_primary: '#0D0D0D', color_accent: '#FF4D4D', color_bg: '#F8F8F8', font_heading: 'Poppins', font_body: 'Inter' },
    copy: { hero_sub: 'Transform your body, elevate your life' },
    sections: ['Programs', 'Schedule', 'Trainers', 'Results'],
  },
  realestate: {
    label: 'Real Estate',
    businessType: 'Real Estate',
    industry: 'Real Estate',
    brandVoice: 'Professional, knowledgeable, personable',
    targetAudience: 'Home buyers, sellers, investors, relocating families',
    services: ['Buyer Representation', 'Seller Representation', 'Market Analysis', 'Investment Properties'],
    design: { color_primary: '#1C2B4A', color_accent: '#B8860B', color_bg: '#FAFAF7', font_heading: 'Cormorant Garamond', font_body: 'Nunito' },
    copy: { hero_sub: 'Your home journey starts here' },
    sections: ['Listings', 'About', 'Market Reports', 'Testimonials'],
  },
  ecommerce: {
    label: 'E-Commerce / Retail',
    businessType: 'Online Store',
    industry: 'Retail & E-Commerce',
    brandVoice: 'Trendy, trustworthy, customer-first',
    targetAudience: 'Online shoppers, bargain hunters, brand loyalists',
    services: ['Online Store', 'Wholesale', 'Gift Cards', 'Subscription Boxes'],
    design: { color_primary: '#111111', color_accent: '#E8A838', color_bg: '#FFFFFF', font_heading: 'DM Sans', font_body: 'Inter' },
    copy: { hero_sub: 'Curated goods, delivered to you' },
    sections: ['Shop', 'New Arrivals', 'About', 'FAQ'],
  },
  consulting: {
    label: 'Consulting / Professional Services',
    businessType: 'Consulting Firm',
    industry: 'Professional Services',
    brandVoice: 'Authoritative, insightful, approachable',
    targetAudience: 'Business owners, executives, growing companies',
    services: ['Strategy Consulting', 'Operations', 'Technology Advisory', 'Workshops'],
    design: { color_primary: '#1C2B4A', color_accent: '#4A90D9', color_bg: '#F7F9FC', font_heading: 'Cormorant Garamond', font_body: 'Inter' },
    copy: { hero_sub: 'Expert guidance for complex challenges' },
    sections: ['Services', 'Industries', 'Case Studies', 'Team'],
  },
};

// ── GET — render wizard ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const tenant = req.tenant || {};
  const brand = tenant.brand || {};

  res.render('admin/brand-builder', {
    user: req.adminUser,
    page: 'brand-builder',
    title: 'Brand Builder',
    brand,
    presets: INDUSTRY_PRESETS,
    tenant: res.locals.tenant,
  });
});

// ── POST /save — save brand profile + mark setup complete ──────────────────
router.post('/save', express.json({ limit: '500kb' }), async (req, res) => {
  try {
    const tenant = req.tenant;
    if (!tenant) return res.status(400).json({ error: 'No tenant context' });

    const {
      name, businessType, industry, tagline, description,
      location, serviceArea, phone, email, ownerName,
      services, pricingNotes, targetAudience, brandVoice,
      socialLinks,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'Business name is required' });
    if (!businessType?.trim()) return res.status(400).json({ error: 'Business type is required' });
    if (!industry?.trim()) return res.status(400).json({ error: 'Industry is required' });

    const slab = getSlabDb();
    const brandUpdate = {
      name: name.trim(),
      businessType: businessType.trim(),
      industry: industry.trim(),
      tagline: (tagline || '').trim(),
      description: (description || '').trim(),
      location: (location || '').trim(),
      serviceArea: (serviceArea || '').trim(),
      phone: (phone || '').trim(),
      email: (email || '').trim(),
      ownerName: (ownerName || '').trim(),
      services: Array.isArray(services) ? services : (services || '').split(',').map(s => s.trim()).filter(Boolean),
      pricingNotes: (pricingNotes || '').trim(),
      targetAudience: (targetAudience || '').trim(),
      brandVoice: (brandVoice || '').trim(),
      socialLinks: socialLinks || {},
    };

    await slab.collection('tenants').updateOne(
      { _id: tenant._id },
      { $set: { brand: brandUpdate, 'meta.brandSetupAt': new Date(), updatedAt: new Date() } },
    );

    bustTenantCache(tenant.domain);
    res.json({ ok: true });
  } catch (err) {
    console.error('[brand-builder] Save error:', err);
    res.status(500).json({ error: 'Failed to save brand profile' });
  }
});

// ── POST /preset — apply an industry preset (design + copy + sections) ─────
router.post('/preset', express.json(), async (req, res) => {
  try {
    const { presetKey } = req.body;
    const preset = INDUSTRY_PRESETS[presetKey];
    if (!preset) return res.status(400).json({ error: 'Unknown preset' });

    const db = req.db;
    const slab = getSlabDb();
    const tenant = req.tenant;
    if (!tenant || !db) return res.status(400).json({ error: 'No tenant context' });

    const ops = [];

    // Apply design settings
    if (preset.design) {
      for (const [key, value] of Object.entries(preset.design)) {
        ops.push(db.collection('design').updateOne(
          { key }, { $set: { key, value, updatedAt: new Date() } }, { upsert: true },
        ));
      }
    }

    // Apply copy
    if (preset.copy) {
      for (const [key, value] of Object.entries(preset.copy)) {
        ops.push(db.collection('copy').updateOne(
          { key }, { $set: { key, value, updatedAt: new Date() } }, { upsert: true },
        ));
      }
    }

    // Seed custom sections from preset
    if (preset.sections?.length) {
      const existingSections = await db.collection('custom_sections').countDocuments();
      if (existingSections === 0) {
        const sectionDocs = preset.sections.map((name, i) => ({
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          order: i,
          visible: true,
          content: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        ops.push(db.collection('custom_sections').insertMany(sectionDocs));
      }
    }

    if (ops.length) await Promise.all(ops);

    bustTenantCache(tenant.domain);
    res.json({ ok: true, preset: presetKey, label: preset.label });
  } catch (err) {
    console.error('[brand-builder] Preset error:', err);
    res.status(500).json({ error: 'Failed to apply preset' });
  }
});

export default router;
