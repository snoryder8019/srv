/**
 * seed-madladslab-products.js
 *
 * Configures the madladslab tenant via existing slab settings only:
 *   1. design.vis_pricing -> 'false'  (hides the subscription pricing block)
 *   2. custom_sections    -> three cards-type sections listing /srv products,
 *                            with slab/opsTrain/games featured and the rest
 *                            grouped under "More from the Lab" / "Also in the Lab".
 *
 * Idempotent: re-running upserts the same docs (matched by `label`).
 *
 * Run from /srv/slab:
 *   node scripts/seed-madladslab-products.js
 */

import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';

const TENANT_DB = 'slab_madladslab';

const FEATURED = {
  label: 'Featured Products',
  fields: {
    heading: 'Built by MadLadsLab',
    subtext: 'Our flagship products — actively developed, in production, and powering real businesses.',
    card1_title: 'Slab',
    card1_body:  'White-label business suite for SMBs. Multi-tenant SaaS platform — branded sites, admin tools, AI-driven design, and onboarding in one stack. slab.madladslab.com',
    card2_title: 'OpsTrain',
    card2_body:  'QR-driven operations training & task management for restaurants. Role-based workflows, delegate referrals, and PayPal-powered SaaS billing. opstrain.madladslab.com',
    card3_title: 'Games',
    card3_body:  'Gaming hub with broadcaster, admin, and player roles. 10-user meeting rooms, live game state streaming, and a custom chat UX built for play. games.madladslab.com',
    card4_title: '',
    card4_body:  '',
  },
};

const ACTIVE = {
  label: 'More from the Lab',
  fields: {
    heading: 'More from the Lab',
    subtext: 'Active products and apps in the MadLadsLab portfolio.',
    card1_title: 'Mobile Meadows',
    card1_body:  'RV & motorhome mobile repair and roof service site for Branson, MO. Tenant-themed, calendar-booked, route-optimized.',
    card2_title: 'Stringborn Universe',
    card2_body:  'Sci-fi MMO with real-time game state streaming over SSE. Persistent worlds, narrative threads, and a live universe under construction.',
    card3_title: 'Triple Twenty',
    card3_body:  'AI-powered darts scoring with live camera input. Computer-vision dart detection, automatic round tracking, and tournament play.',
    card4_title: 'MediaHasher',
    card4_body:  'Electron desktop tool for media fingerprinting and license management. Ships with a Stripe/PayPal storefront for software licensing.',
  },
};

const SUPPORTING = {
  label: 'Also in the Lab',
  fields: {
    heading: 'Also in the Lab',
    subtext: 'Supporting services, infrastructure, and experiments that power the rest of the portfolio.',
    card1_title: 'GreelityTV',
    card1_body:  'Local voices for Greeley, CO. Community media, neighborhood news, and a digital home for local creators.',
    card2_title: 'Graffiti Pasta TV',
    card2_body:  'In-restaurant digital display that cycles media from a Linode bucket. Drop-in signage for hospitality venues.',
    card3_title: 'Piper TTS',
    card3_body:  'Self-hosted text-to-speech HTTP wrapper exposing an OpenAI-compatible /v1/audio/speech endpoint. Powers in-app voice across the lab.',
    card4_title: 'MCP Server',
    card4_body:  'Model Context Protocol server giving Claude structured access to the lab — service control, file ops, and tmux session orchestration.',
  },
};

const SECTIONS = [FEATURED, ACTIVE, SUPPORTING];

async function main() {
  if (!config.DB_URL) {
    console.error('[seed] Missing DB_URL in env');
    process.exit(1);
  }

  const client = new MongoClient(config.DB_URL);
  await client.connect();
  console.log(`[seed] Connected to MongoDB`);

  const db = client.db(TENANT_DB);
  const now = new Date();

  // 1. Hide the pricing section via the design visibility flag.
  await db.collection('design').updateOne(
    { key: 'vis_pricing' },
    { $set: { key: 'vis_pricing', value: 'false', updatedAt: now } },
    { upsert: true }
  );
  console.log(`[seed] design.vis_pricing -> 'false' (pricing block hidden)`);

  // 2. Upsert each products section into custom_sections, matched by label.
  //    Order them so they render in featured -> active -> supporting sequence.
  for (let i = 0; i < SECTIONS.length; i++) {
    const sec = SECTIONS[i];
    const existing = await db.collection('custom_sections').findOne({ label: sec.label });

    if (existing) {
      await db.collection('custom_sections').updateOne(
        { _id: existing._id },
        { $set: {
            type: 'cards',
            label: sec.label,
            visible: true,
            order: i,
            fields: sec.fields,
            updatedAt: now,
        } }
      );
      console.log(`[seed] updated custom_sections "${sec.label}" (order ${i})`);
    } else {
      await db.collection('custom_sections').insertOne({
        type: 'cards',
        label: sec.label,
        visible: true,
        order: i,
        fields: sec.fields,
        images: {},
        createdAt: now,
        updatedAt: now,
      });
      console.log(`[seed] created custom_sections "${sec.label}" (order ${i})`);
    }
  }

  console.log('\n[seed] Done. Edit any of this from the madladslab admin panel:');
  console.log('  /admin/design   — toggle pricing visibility back if needed');
  console.log('  /admin/sections — edit / reorder / hide product cards');

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
