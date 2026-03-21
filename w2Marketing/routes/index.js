import express from 'express';
import { getDb } from '../plugins/mongo.js';
import { getReviews } from '../plugins/reviews.js';

const router = express.Router();

const COPY_DEFAULTS = {
  hero_eyebrow: 'Greeley, Colorado — Digital Marketing Agency',
  hero_heading: 'Grow your brand',
  hero_heading_em: 'online.',
  hero_sub: "Social media management, website design, and content creation — built for local businesses ready to stand out in Greeley and beyond.",
  hero_badge: 'Greeley, CO · Local Business First',
  services_label: 'What We Do',
  services_heading: 'Our',
  services_heading_em: 'Services',
  services_sub: 'Everything your business needs to build a powerful presence — from pixels to posts.',
  service1_title: 'Social Media Management',
  service1_desc: 'Strategy, scheduling, and engagement across all major platforms. We handle the day-to-day so you can focus on running your business.',
  service2_title: 'Website Design & Development',
  service2_desc: 'Custom, responsive websites that convert visitors into customers. Built for speed, SEO, and your brand identity.',
  service3_title: 'Content & Branding',
  service3_desc: "Photography, graphics, copy, and full brand identity systems — everything you need to tell your story with confidence.",
  about_quote: '"No fluff — just digital marketing that actually works for local businesses."',
  about_desc: "We're a Greeley-based marketing team that partners with local businesses to make digital marketing simple, effective, and actually enjoyable.",
  about_sig: 'W2 Marketing',
  process_label: 'How It Works',
  process_heading: 'Simple',
  process_heading_em: 'Process',
  contact_sub: "Ready to grow your brand? Tell us a bit about your business and we'll be in touch within one business day.",
  contact_location: 'Greeley, Colorado',
  contact_serving: 'Northern Colorado & surrounding areas',
};

router.get('/', async (_req, res) => {
  try {
    const db = getDb();
    const [rawCopy, reviews, portfolio] = await Promise.all([
      db.collection('w2_copy').find({}).toArray(),
      getReviews(),
      db.collection('w2_portfolio').find({}).sort({ order: 1, createdAt: -1 }).toArray(),
    ]);
    const copy = { ...COPY_DEFAULTS };
    for (const item of rawCopy) copy[item.key] = item.value;
    res.render('index', { copy, reviews, portfolio });
  } catch (err) {
    console.error(err);
    res.render('index', { copy: COPY_DEFAULTS, reviews: null, portfolio: [] });
  }
});

export default router;
