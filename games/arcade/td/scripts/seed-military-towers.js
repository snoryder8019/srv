/**
 * Seed the MILITARY DEFENDER tower roster — 8 balanced, characterful system
 * towers spanning every category (kinetic / energy / support / special).
 * Idempotent: upserts by unique `slug`, so re-running updates content in place
 * and never creates duplicates.
 *
 *   node scripts/seed-military-towers.js
 *
 * gltfUrl values are coordinated with the art pipeline (models already on disk
 * under /assets/gltf/system/). thumbnailUrl points at /assets/img/towers/<slug>.png
 * where art will be generated separately. All towers are seeded status:'approved'
 * so they are immediately placeable in /play. Only schema-valid fields are set.
 */
import mongoose from 'mongoose';
import { connectDb } from '../services/db.js';
import Tower from '../api/v1/models/Tower.js';

// ---------------------------------------------------------------------------
// ROSTER — 8 military towers. Stats are tuned so each fills a distinct role:
//   cheap rapid-fire ... heavy artillery ... AoE ... anti-air ... long sniper.
// Cost ladder runs ~40 (gatling) up to ~170-180 (railgun / mortar).
// ---------------------------------------------------------------------------
const TOWERS = [
  {
    name: 'Gatling Bunker',
    slug: 'gatling-bunker',
    description:
      'A dug-in autocannon nest that never stops chattering. Low punch per round, ' +
      'but it shreds anything foolish enough to walk the front of the lane.',
    category: 'kinetic',
    gltfUrl: '/assets/gltf/system/bunker.gltf',
    scale: 1.0,
    stats: { damage: 5, range: 4, fireRate: 6.0, cost: 40, projectileSpeed: 9 },
    behavior: { targeting: 'first', canHitFlying: false, splashRadius: 0 },
  },
  {
    name: 'Flak Battery',
    slug: 'flak-battery',
    description:
      'Quad-barrel flak guns that fill the sky with shrapnel. Built to swat ' +
      'flyers out of the air, with a burst wide enough to clip a wingman or two.',
    category: 'kinetic',
    gltfUrl: '/assets/gltf/system/bunker.gltf',
    scale: 1.0,
    stats: { damage: 14, range: 5, fireRate: 1.8, cost: 75, projectileSpeed: 8 },
    behavior: { targeting: 'first', canHitFlying: true, splashRadius: 1 },
  },
  {
    name: 'Bastion Cannon',
    slug: 'bastion-cannon',
    description:
      'A fortress-mounted siege gun that hits like a collapsing wall. Slow to ' +
      'cycle, but it picks the toughest hull on the field and breaks it open.',
    category: 'kinetic',
    gltfUrl: '/assets/gltf/system/bastion.gltf',
    scale: 1.2,
    stats: { damage: 60, range: 6, fireRate: 0.5, cost: 130, projectileSpeed: 7 },
    behavior: { targeting: 'strongest', canHitFlying: false, splashRadius: 1 },
  },
  {
    name: 'Plasma Mortar',
    slug: 'plasma-mortar',
    description:
      'Lobs a globe of superheated plasma over the wall to detonate mid-column. ' +
      'Slow and costly, but one good arc clears a packed lane in a single flash.',
    category: 'special',
    gltfUrl: '/assets/gltf/system/bastion.gltf',
    scale: 1.2,
    stats: { damage: 38, range: 7, fireRate: 0.45, cost: 170, projectileSpeed: 4 },
    behavior: { targeting: 'first', canHitFlying: false, splashRadius: 3 },
  },
  {
    name: 'Arc Coil Tower',
    slug: 'arc-coil-tower',
    description:
      'A humming induction coil that whips lightning at the nearest target. ' +
      'Fast, reliable, and happy to reach up and ground out a passing flyer.',
    category: 'energy',
    gltfUrl: '/assets/gltf/system/arc-coil.gltf',
    scale: 1.0,
    stats: { damage: 18, range: 5, fireRate: 2.5, cost: 90, projectileSpeed: 12 },
    behavior: { targeting: 'nearest', canHitFlying: true, splashRadius: 0 },
  },
  {
    name: 'Tesla Fence',
    slug: 'tesla-fence',
    description:
      'A low-cost array of crackling emitters for close-in area denial. Short ' +
      'reach, brutal tempo — string a few along a choke and nothing crosses clean.',
    category: 'energy',
    gltfUrl: '/assets/gltf/system/arc-coil.gltf',
    scale: 0.9,
    stats: { damage: 7, range: 3, fireRate: 5.0, cost: 55, projectileSpeed: 12 },
    behavior: { targeting: 'nearest', canHitFlying: true, splashRadius: 1 },
  },
  {
    name: 'Spire Railgun',
    slug: 'spire-railgun',
    description:
      'A towering electromagnetic lance that spears the strongest target from ' +
      'across the map. One shot, immense charge time, a slug that arrives instantly.',
    category: 'energy',
    gltfUrl: '/assets/gltf/system/spire.gltf',
    scale: 1.3,
    stats: { damage: 95, range: 12, fireRate: 0.35, cost: 180, projectileSpeed: 20 },
    behavior: { targeting: 'strongest', canHitFlying: true, splashRadius: 0 },
  },
  {
    name: 'Aegis Pylon',
    slug: 'aegis-pylon',
    description:
      'A forward command emplacement that extends the line and steadies the guns ' +
      'around it. It barely fires — its value is presence, reach, and the shield it projects.',
    category: 'support',
    gltfUrl: '/assets/gltf/system/spire.gltf',
    scale: 1.1,
    stats: { damage: 2, range: 8, fireRate: 0.5, cost: 110, projectileSpeed: 6 },
    behavior: { targeting: 'nearest', canHitFlying: true, splashRadius: 0 },
  },
];

async function main() {
  await connectDb();
  try {
    const summary = [];
    for (const t of TOWERS) {
      const doc = {
        ...t,
        authorName: 'system',
        thumbnailUrl: `/assets/img/towers/${t.slug}.png`,
        status: 'approved',
      };
      await Tower.findOneAndUpdate(
        { slug: t.slug },
        { $set: doc },
        { upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
      summary.push({ slug: t.slug, category: t.category, cost: t.stats.cost });
    }

    console.log(`[seed-military-towers] ✓ upserted ${summary.length} towers:`);
    for (const s of summary) {
      console.log(`  ${s.slug.padEnd(16)} ${s.category.padEnd(8)} cost ${s.cost}`);
    }
    console.log('[seed-military-towers] Done. Safe to re-run.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-military-towers] Seed failed:', err);
  process.exit(1);
});
