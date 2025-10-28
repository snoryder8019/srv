import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

// Star radius is 400 units (50 base size * 8 multiplier)
// Safe minimum: planets should be at least 3x star radius away
const STAR_RADIUS = 400;
const SAFE_MULTIPLIER = 3;
const MIN_SAFE_DISTANCE = STAR_RADIUS * SAFE_MULTIPLIER; // 1200 units
const MIN_ORBIT_RADIUS = Math.ceil(MIN_SAFE_DISTANCE / 150); // Convert back to orbitRadius (8)

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

try {
  await client.connect();
  const db = client.db(process.env.DB_NAME);
  const assetsCollection = db.collection('assets');

  console.log('🔍 Checking planet clearance from star...');
  console.log(`   Star radius: ${STAR_RADIUS} units`);
  console.log(`   Safe distance: ${MIN_SAFE_DISTANCE} units (${SAFE_MULTIPLIER}x star radius)`);
  console.log(`   Minimum orbitRadius: ${MIN_ORBIT_RADIUS} (scaled: ${MIN_ORBIT_RADIUS * 150} units)\n`);

  const tooClose = await assetsCollection.find({
    assetType: 'planet',
    orbitRadius: { $lt: MIN_ORBIT_RADIUS }
  }).toArray();

  console.log(`Found ${tooClose.length} planets too close to star (orbitRadius < ${MIN_ORBIT_RADIUS})\n`);

  if (tooClose.length > 0) {
    console.log('Planets to update:');
    tooClose.forEach(p => {
      const currentScaled = p.orbitRadius * 150;
      const newScaled = MIN_ORBIT_RADIUS * 150;
      console.log(`  ${p.title.padEnd(35)} ${p.orbitRadius.toFixed(1).padStart(6)} (${currentScaled.toFixed(0).padStart(5)} units) → ${MIN_ORBIT_RADIUS} (${newScaled} units)`);
    });

    console.log('\n🔧 Updating planets to safe distance...');
    const result = await assetsCollection.updateMany(
      { assetType: 'planet', orbitRadius: { $lt: MIN_ORBIT_RADIUS } },
      { $set: { orbitRadius: MIN_ORBIT_RADIUS } }
    );

    console.log(`✅ Updated ${result.modifiedCount} planets to minimum safe orbit radius ${MIN_ORBIT_RADIUS}`);
    console.log(`   All planets now at least ${MIN_SAFE_DISTANCE} units from star center`);
  } else {
    console.log('✅ All planets are at safe distances!');
  }

  await client.close();
  process.exit(0);
} catch (err) {
  console.error('❌ Error:', err);
  await client.close();
  process.exit(1);
}
