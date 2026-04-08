#!/usr/bin/env node
/**
 * Seed opsTrain as a product entry in slab.tenants
 * so delegates can be attached to it and sell it via their sales sheets.
 *
 * Run once: node scripts/seed-slab-product.js
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const SLAB_DB_URL = process.env.SLAB_DB_URL || 'mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net/slab';

async function main() {
  const client = new MongoClient(SLAB_DB_URL);
  await client.connect();
  const slab = client.db('slab');

  const existing = await slab.collection('tenants').findOne({ domain: 'ops-train.madladslab.com' });
  if (existing) {
    console.log('opsTrain product entry already exists in slab.tenants — updating brand info...');
    await slab.collection('tenants').updateOne(
      { _id: existing._id },
      {
        $set: {
          'brand.name': 'OpsTrain',
          'brand.tagline': 'QR-driven ops management for restaurants & venues',
          'brand.description': 'OpsTrain streamlines restaurant operations with QR-based task checklists, shift management, crew tracking, and real-time analytics. Staff scan in with a PIN — no app download needed.',
          'brand.services': [
            'QR-based task management & sidework checklists',
            'Shift crew tracking & clock-in/out',
            'Real-time live dashboard & analytics',
            'Webhook QR codes for equipment/facility monitoring',
            'Multi-language (English/Spanish) support',
          ],
          'brand.pricingNotes': 'Plans start at $50/month. Quarterly ($120), Annual ($300), Lifetime ($1200). 7-day free trial, 30 days free with delegate referral.',
          'brand.targetAudience': 'Restaurant owners, bar managers, venue operators, food service businesses',
          'brand.businessType': 'SaaS — Operations Management',
          'brand.industry': 'Food Service / Hospitality',
          'brand.phone': '',
          'brand.email': 'support@madladslab.com',
          updatedAt: new Date(),
        },
      }
    );
    console.log('Updated. _id:', existing._id);
  } else {
    const result = await slab.collection('tenants').insertOne({
      domain: 'ops-train.madladslab.com',
      db: null, // not a slab tenant — standalone product
      status: 'active',
      isProduct: true, // flag: this is a standalone product, not a slab tenant
      productKey: 'opsTrain',
      brand: {
        name: 'OpsTrain',
        tagline: 'QR-driven ops management for restaurants & venues',
        description: 'OpsTrain streamlines restaurant operations with QR-based task checklists, shift management, crew tracking, and real-time analytics. Staff scan in with a PIN — no app download needed.',
        services: [
          'QR-based task management & sidework checklists',
          'Shift crew tracking & clock-in/out',
          'Real-time live dashboard & analytics',
          'Webhook QR codes for equipment/facility monitoring',
          'Multi-language (English/Spanish) support',
        ],
        pricingNotes: 'Plans start at $50/month. Quarterly ($120), Annual ($300), Lifetime ($1200). 7-day free trial, 30 days free with delegate referral.',
        targetAudience: 'Restaurant owners, bar managers, venue operators, food service businesses',
        businessType: 'SaaS — Operations Management',
        industry: 'Food Service / Hospitality',
        phone: '',
        email: 'support@madladslab.com',
      },
      meta: {
        subdomain: 'ops-train',
        ownerEmail: 'snoryder8019@gmail.com',
        plan: 'platform',
      },
      public: {},
      secrets: {},
      perks: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('Created opsTrain product entry in slab.tenants. _id:', result.insertedId);
  }

  await client.close();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
