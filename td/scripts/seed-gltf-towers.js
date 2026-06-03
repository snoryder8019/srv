/**
 * Seed the four procedurally-generated GLTF system towers.
 * Idempotent: upserts by slug. Run after gen-gltf-towers.js.
 *   node scripts/seed-gltf-towers.js
 */
import mongoose from 'mongoose';
import { connectDb } from '../services/db.js';
import Tower from '../api/v1/models/Tower.js';

const TOWERS = [
  {
    slug: 'sys-bastion', name: 'Bastion', category: 'kinetic',
    description: 'Crenellated stone keep. Solid splash damage at close range.',
    gltfUrl: '/assets/gltf/system/bastion.gltf', scale: 1.0,
    stats: { damage: 14, range: 3, fireRate: 1.0, cost: 90, projectileSpeed: 5 },
    behavior: { targeting: 'nearest', canHitFlying: true, splashRadius: 1 },
  },
  {
    slug: 'sys-arc-coil', name: 'Arc Coil', category: 'energy',
    description: 'Humming tesla emitter. Rapid fire, short reach.',
    gltfUrl: '/assets/gltf/system/arc-coil.gltf', scale: 1.0,
    stats: { damage: 7, range: 4, fireRate: 2.5, cost: 110, projectileSpeed: 9 },
    behavior: { targeting: 'first', canHitFlying: true, splashRadius: 0 },
  },
  {
    slug: 'sys-spire', name: 'Spire', category: 'special',
    description: 'Crystal lance. Long range, devastating single shots.',
    gltfUrl: '/assets/gltf/system/spire.gltf', scale: 0.85,
    stats: { damage: 40, range: 7, fireRate: 0.4, cost: 160, projectileSpeed: 12 },
    behavior: { targeting: 'strongest', canHitFlying: true, splashRadius: 0 },
  },
  {
    slug: 'sys-bunker', name: 'Bunker', category: 'support',
    description: 'Dug-in turret. Cheap, reliable, picks off stragglers.',
    gltfUrl: '/assets/gltf/system/bunker.gltf', scale: 1.0,
    stats: { damage: 10, range: 3, fireRate: 1.4, cost: 70, projectileSpeed: 6 },
    behavior: { targeting: 'last', canHitFlying: true, splashRadius: 0 },
  },
];

async function main() {
  await connectDb();
  for (const t of TOWERS) {
    const doc = await Tower.findOneAndUpdate(
      { slug: t.slug },
      { $set: { ...t, authorName: 'system', status: 'featured' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`✓ ${t.name.padEnd(10)} -> ${doc._id}  (${t.gltfUrl})`);
  }
  await mongoose.disconnect();
  console.log('GLTF tower seed complete.');
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1); });
