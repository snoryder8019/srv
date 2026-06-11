/**
 * Tune NoCo Metal Workz with the new motion / consent features:
 *   - arc (vector) marquee
 *   - gentle scroll-snap
 *   - staggered section reveals
 *   - GDPR cookie consent (modal) with NoCo-voiced copy
 *
 * Run from /srv/slab:  node scripts/tune-noco-motion.js
 * Idempotent — upserts design/copy keys by key. Safe to re-run.
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const DB_URL = process.env.DB_URL;
if (!DB_URL) { console.error('Missing DB_URL in env'); process.exit(1); }

const SLAB_DB = process.env.SLAB_DB || 'slab';
const SUBDOMAIN = 'nocometalworkz';

const DESIGN = {
  // Use the layered parallax band AS the hero/landing top section
  hero_style:             'parallax',
  // Layered parallax marquee band: bg image (z1) / big floating typeface (z2) / copy card (z3)
  ticker_treatment:       'parallax',
  ticker_shape:           'straight',   // clean big display type for the band
  ticker_direction:       'left',
  ticker_parallax_image:  '/images/tenants/nocometalworkz/hero_bg.png',
  ticker_parallax_height: '78vh',
  ticker_parallax_overlay:'55',
  ticker_band_font_size:  '7',
  ticker_text_color:      '#f5f3ef',
  section_animation:      'stagger',
  snap_enabled:           'true',
  snap_strictness:        'proximity',
  cookie_consent_enabled: 'true',
  cookie_consent_style:   'modal',
  cookie_consent_position:'bottom',
  cookie_accent:          '#f97316',
};

const COPY = {
  cookie_title:          'Cookies — straight talk',
  cookie_message:        "We use a few cookies to keep the site running right and to see what's working. You decide on the rest — no fluff.",
  cookie_accept_label:   'Accept all',
  cookie_reject_label:   'Only essentials',
  cookie_save_label:     'Save my choices',
  cookie_settings_label: 'Cookie settings',
  cookie_necessary_desc: 'Keep the site working — forms, security, your preferences. Always on.',
  cookie_analytics_desc: 'Let us see which pages and services folks actually use, so we can sharpen the site.',
  cookie_marketing_desc: 'Used to measure ads and show work relevant to your project. Off unless you allow it.',
  cookie_privacy_link:   '/privacy',
  // Parallax band copy (z3 card)
  ticker_band_heading:   'Steel built. <em>Colorado strong.</em>',
  ticker_band_text:      'Custom welding, fabrication, and fence work across Northern Colorado — built to outlast the weather and the warranty.',
  ticker_band_cta:       'Get a free estimate',
  ticker_band_cta_link:  '#contact',
};

const client = new MongoClient(DB_URL);
try {
  await client.connect();
  const slab = client.db(SLAB_DB);

  // Resolve the tenant's database name from the registry (robust to naming).
  const tenant = await slab.collection('tenants').findOne({
    $or: [{ subdomain: SUBDOMAIN }, { slug: SUBDOMAIN }, { dbName: 'slab_' + SUBDOMAIN }],
  });
  const dbName = (tenant && (tenant.dbName || tenant.db)) || ('slab_' + SUBDOMAIN);
  console.log(`Tenant: ${tenant ? (tenant.name || SUBDOMAIN) : '(registry miss)'}  →  db: ${dbName}`);

  const tdb = client.db(dbName);
  const now = new Date();

  async function upsert(coll, obj) {
    let n = 0;
    for (const [key, value] of Object.entries(obj)) {
      const r = await tdb.collection(coll).updateOne(
        { key },
        { $set: { key, value, updatedAt: now } },
        { upsert: true },
      );
      n++;
      const how = r.upsertedCount ? 'created' : (r.modifiedCount ? 'updated' : 'unchanged');
      console.log(`  ${coll}.${key} = ${JSON.stringify(value)}  [${how}]`);
    }
    return n;
  }

  console.log('\nDesign tokens:');
  await upsert('design', DESIGN);
  console.log('\nCopy:');
  await upsert('copy', COPY);

  console.log('\nDone. Restart slab for the template code to go live, then load nocometalworkz.madladslab.com');
} finally {
  await client.close();
}
