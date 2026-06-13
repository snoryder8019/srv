/**
 * Seed a demo map + tower so /play has something to render.
 * Run: node scripts/seed-demo.js
 */
import mongoose from 'mongoose';
import { connectDb } from '../services/db.js';
import GameMap from '../api/v1/models/Map.js';
import Tower from '../api/v1/models/Tower.js';

async function main() {
  await connectDb();

  // Demo map: zigzag path radius 6
  const mapSlug = 'demo-zigzag';
  const existing = await GameMap.findOne({ slug: mapSlug });
  if (existing) {
    console.log(`Map "${mapSlug}" already exists (${existing._id})`);
  } else {
    const path = [
      { q: -6, r: 0 }, { q: -5, r: 0 }, { q: -4, r: 0 },
      { q: -3, r: 0 }, { q: -2, r: 0 }, { q: -1, r: 0 },
      { q: 0, r: 0 },  { q: 1, r: 0 },  { q: 2, r: 0 },
      { q: 3, r: 0 },  { q: 4, r: 0 },  { q: 5, r: 0 },
      { q: 6, r: 0 },
    ];
    const map = await GameMap.create({
      name: 'Demo Zigzag',
      slug: mapSlug,
      description: 'A simple straight-line demo map for testing.',
      authorName: 'system',
      radius: 6,
      spawnHexes: [{ q: -6, r: 0 }],
      baseHexes:  [{ q: 6, r: 0 }],
      pathHexes:  path,
      blockedHexes: [],
      waves: [
        { enemies: [{ type: 'basic', count: 8, delayMs: 1500 }], intermissionMs: 4000 },
        { enemies: [{ type: 'basic', count: 6, delayMs: 1000 }, { type: 'fast', count: 4, delayMs: 800 }], intermissionMs: 4000 },
        { enemies: [{ type: 'tank', count: 3, delayMs: 2000 }, { type: 'basic', count: 10, delayMs: 700 }], intermissionMs: 5000 },
      ],
      status: 'approved',
    });
    console.log(`Created map: ${map._id}`);
  }

  // Demo tower (no GLTF, falls back to primitive)
  const towerSlug = 'starter-cannon';
  const existingT = await Tower.findOne({ slug: towerSlug });
  if (existingT) {
    console.log(`Tower "${towerSlug}" already exists (${existingT._id})`);
  } else {
    const tower = await Tower.create({
      name: 'Starter Cannon',
      slug: towerSlug,
      description: 'A basic kinetic tower. No GLTF needed; renders as primitive.',
      category: 'kinetic',
      authorName: 'system',
      gltfUrl: '', // intentionally blank - client renders fallback
      stats: {
        damage: 8,
        range: 3,
        fireRate: 1.2,
        cost: 50,
        projectileSpeed: 5,
      },
      behavior: {
        targeting: 'first',
        canHitFlying: true,
        splashRadius: 0,
      },
      status: 'approved',
    });
    console.log(`Created tower: ${tower._id}`);
  }

  // A second tower with longer range
  const sniperSlug = 'long-eye';
  const existingS = await Tower.findOne({ slug: sniperSlug });
  if (!existingS) {
    const tower = await Tower.create({
      name: 'Long Eye',
      slug: sniperSlug,
      description: 'Long range, slow fire rate.',
      category: 'energy',
      authorName: 'system',
      gltfUrl: '',
      stats: {
        damage: 25,
        range: 6,
        fireRate: 0.6,
        cost: 120,
        projectileSpeed: 8,
      },
      behavior: { targeting: 'strongest', canHitFlying: true, splashRadius: 0 },
      status: 'approved',
    });
    console.log(`Created tower: ${tower._id}`);
  } else {
    console.log(`Tower "${sniperSlug}" already exists`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
