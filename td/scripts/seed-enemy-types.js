/**
 * Seed the data-driven attacker archetypes (EnemyType docs). The engine loads
 * these {enabled:true} at run start for stats; the renderer SPEC (enemy.js)
 * maps each slug to a visual. Colors here MATCH the renderer tints.
 *
 *   node scripts/seed-enemy-types.js
 *
 * Idempotent — upserts by unique slug (findOneAndUpdate, upsert), so it is safe
 * to run repeatedly (re-running updates stats in place, never dupes).
 */
import mongoose from 'mongoose';
import { connectDb } from '../services/db.js';
import EnemyType from '../api/v1/models/EnemyType.js';

// slug, name, hp, speed, reward, color (int, matches SPEC tint), model key.
// Balanced ascending hp; runners/swarmer fast, tanks/brute slow.
const TYPES = [
  { slug: 'basic',       name: 'Scrap Walker',         hp: 20,  speed: 1.5, reward: 5,  color: 0xff5a3c, model: 'robot'  },
  { slug: 'grunt',       name: 'Rust Grunt',           hp: 35,  speed: 1.4, reward: 7,  color: 0xff7a2c, model: 'robot'  },
  { slug: 'fast',        name: 'Razor Runner',         hp: 28,  speed: 3.5, reward: 8,  color: 0xffe04c, model: 'robot'  },
  { slug: 'runner',      name: 'Sprint Drone',         hp: 24,  speed: 3.6, reward: 8,  color: 0xffe04c, model: 'robot'  },
  { slug: 'tank',        name: 'Siege Hull',           hp: 140, speed: 0.9, reward: 22, color: 0xc41f44, model: 'robot'  },
  { slug: 'machine',     name: 'War Machine',          hp: 180, speed: 1.0, reward: 28, color: 0xb01e2a, model: 'robot'  },
  { slug: 'infiltrator', name: 'Phantom Infiltrator',  hp: 45,  speed: 2.4, reward: 12, color: 0xff7a2c, model: 'robot'  },
  { slug: 'flyer',       name: 'Sky Talon',            hp: 60,  speed: 2.0, reward: 15, color: 0x3cf0ff, model: 'stork'  },
  { slug: 'flyer2',      name: 'Storm Parrot',         hp: 70,  speed: 2.2, reward: 17, color: 0x9cff5a, model: 'parrot' },
  { slug: 'swarmer',     name: 'Swarm Mite',           hp: 8,   speed: 3.5, reward: 3,  color: 0xff9a3c, model: 'robot'  },
  { slug: 'brute',       name: 'Iron Brute',           hp: 220, speed: 0.9, reward: 34, color: 0x8a1020, model: 'robot'  },
  { slug: 'gunship',     name: 'Vulture Gunship',      hp: 110, speed: 1.6, reward: 25, color: 0x9b6cff, model: 'stork'  },
];

async function main() {
  await connectDb();
  try {
    const slugs = [];
    for (const t of TYPES) {
      await EnemyType.findOneAndUpdate(
        { slug: t.slug },
        { $set: { ...t, enabled: true } },
        { upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
      slugs.push(t.slug);
    }
    console.log(`[seed-enemy-types] ✓ upserted ${TYPES.length} enemy types: ${slugs.join(', ')}`);
    console.log('[seed-enemy-types] Done. Safe to re-run.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-enemy-types] Seed failed:', err);
  process.exit(1);
});
