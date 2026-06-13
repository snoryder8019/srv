/**
 * Seed the action-card pile (generic + collection) and grant starter
 * collections to existing players. Idempotent.
 *   node scripts/seed-action-cards.js
 */
import mongoose from 'mongoose';
import { connectDb } from '../services/db.js';
import ActionCard from '../api/v1/models/ActionCard.js';
import User from '../api/v1/models/User.js';
import { STARTER_COLLECTION } from '../services/cards/actions.js';

const CARDS = [
  // ---- generic pile (grows with level via minLevel) ----
  { slug: 'overclock',     name: 'Overclock',     icon: '⚡', rarity: 'common', source: 'generic', minLevel: 1,
    description: '+30% fire rate for 12s.',  effect: { kind: 'tower-buff', stat: 'fireRate', mode: 'mult', value: 1.3,  durationMs: 12000 } },
  { slug: 'hardened-rounds', name: 'Hardened Rounds', icon: '✦', rarity: 'common', source: 'generic', minLevel: 1,
    description: '+25% damage for 12s.',     effect: { kind: 'tower-buff', stat: 'damage',  mode: 'mult', value: 1.25, durationMs: 12000 } },
  { slug: 'field-scope',   name: 'Field Scope',   icon: '◎', rarity: 'common', source: 'generic', minLevel: 1,
    description: '+1 range for the rest of the run.', effect: { kind: 'tower-buff', stat: 'range', mode: 'add', value: 1, durationMs: 0 } },
  { slug: 'coolant-flush', name: 'Coolant Flush', icon: '❄', rarity: 'common', source: 'generic', minLevel: 3,
    description: '+20% fire rate for 15s.',  effect: { kind: 'tower-buff', stat: 'fireRate', mode: 'mult', value: 1.2,  durationMs: 15000 } },
  { slug: 'frag-rounds',   name: 'Frag Rounds',   icon: '♨', rarity: 'rare',   source: 'generic', minLevel: 3,
    description: '+1 splash radius for 15s.', effect: { kind: 'tower-buff', stat: 'splash', mode: 'add', value: 1, durationMs: 15000 } },
  { slug: 'base-patch',    name: 'Base Patch',    icon: '✚', rarity: 'common', source: 'generic', minLevel: 5,
    description: 'Repair the base by 20.',   effect: { kind: 'base-heal', mode: 'add', value: 20, durationMs: 0 } },
  { slug: 'high-velocity', name: 'High Velocity', icon: '➶', rarity: 'rare',   source: 'generic', minLevel: 5,
    description: '+35% damage for 14s.',     effect: { kind: 'tower-buff', stat: 'damage', mode: 'mult', value: 1.35, durationMs: 14000 } },

  // ---- collection (earned / chosen pre-game) ----
  { slug: 'surge',          name: 'Surge',          icon: '◈', rarity: 'rare',      source: 'collection', minLevel: 1,
    description: '+60% damage for 10s.',     effect: { kind: 'tower-buff', stat: 'damage', mode: 'mult', value: 1.6, durationMs: 10000 } },
  { slug: 'precision-array', name: 'Precision Array', icon: '⊹', rarity: 'rare',    source: 'collection', minLevel: 1,
    description: '+2 range for the rest of the run.', effect: { kind: 'tower-buff', stat: 'range', mode: 'add', value: 2, durationMs: 0 } },
  { slug: 'chain-lightning', name: 'Chain Lightning', icon: '⟿', rarity: 'epic',    source: 'collection', minLevel: 1,
    description: '+50% fire rate for 12s.',  effect: { kind: 'tower-buff', stat: 'fireRate', mode: 'mult', value: 1.5, durationMs: 12000 } },
  { slug: 'siege-protocol', name: 'Siege Protocol', icon: '⛨', rarity: 'epic',     source: 'collection', minLevel: 1,
    description: '+50% damage for the rest of the run.', effect: { kind: 'tower-buff', stat: 'damage', mode: 'mult', value: 1.5, durationMs: 0 } },
  { slug: 'overdrive-core', name: 'Overdrive Core', icon: '★', rarity: 'legendary', source: 'collection', minLevel: 1,
    description: 'Double fire rate for 10s.', effect: { kind: 'tower-buff', stat: 'fireRate', mode: 'mult', value: 2.0, durationMs: 10000 } },
];

async function main() {
  await connectDb();
  for (const c of CARDS) {
    await ActionCard.findOneAndUpdate({ slug: c.slug }, { $set: c }, { upsert: true, setDefaultsOnInsert: true });
  }
  console.log(`✓ upserted ${CARDS.length} action cards`);

  // Grant starter collection to players who have none yet.
  const users = await User.find({ $or: [{ cardCollection: { $size: 0 } }, { cardCollection: { $exists: false } }] });
  for (const u of users) {
    u.cardCollection = STARTER_COLLECTION.map(slug => ({ slug, count: 1 }));
    if (!u.level) u.level = 1;
    await u.save();
    console.log(`  granted starter collection -> ${u.displayName}`);
  }
  console.log(`✓ starter collections granted to ${users.length} player(s)`);

  await mongoose.disconnect();
  console.log('Action-card seed complete.');
}
main().catch(e => { console.error('Seed failed:', e); process.exit(1); });
