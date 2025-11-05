/**
 * Create storehouse for each galaxy
 * Provides galaxy-level inventory for ship resupply
 */
import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';

console.log('🏪 Starting galaxy storehouse seed script...\n');

try {
  await connectDB();
  console.log('✅ Connected to database\n');

  const db = getDb();

  // Find all galaxies
  const galaxies = await db.collection(collections.assets)
    .find({ assetType: 'galaxy' })
    .toArray();

  console.log(`📊 Found ${galaxies.length} galaxies to process\n`);

  let created = 0;
  let skipped = 0;

  for (const galaxy of galaxies) {
    // Check if storehouse already exists
    const existing = await db.collection(collections.storehouses).findOne({
      galaxyId: galaxy._id
    });

    if (!existing) {
      // Create new storehouse
      await db.collection(collections.storehouses).insertOne({
        galaxyId: galaxy._id,
        inventory: {
          fuel: 50000,
          food: 20000,
          oxygen: 100000,
          medkits: 5000,
          custom: []
        },
        access: {
          public: true,
          allowedUsers: []
        },
        lastUpdated: new Date(),
        createdAt: new Date()
      });

      created++;
      console.log(`✅ Created storehouse for galaxy "${galaxy.title}"`);
    } else {
      skipped++;
      console.log(`⏭️  Skipped "${galaxy.title}" (storehouse exists)`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Seeding complete!`);
  console.log(`   Created: ${created} storehouses`);
  console.log(`   Skipped: ${skipped} storehouses (already exist)`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(0);

} catch (error) {
  console.error('❌ Error seeding galaxy storehouses:', error);
  process.exit(1);
}
