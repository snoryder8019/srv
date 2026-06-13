import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MIN_ORBIT_RADIUS = 10; // Minimum orbitRadius to avoid being inside the star (scaled 150x = 1500 units)

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

try {
  await client.connect();
  const db = client.db(process.env.DB_NAME);
  const assetsCollection = db.collection('assets');

  console.log('🔍 Finding planets too close to star...');

  const tooClose = await assetsCollection.find({
    assetType: 'planet',
    orbitRadius: { $lt: MIN_ORBIT_RADIUS }
  }).toArray();

  console.log(`Found ${tooClose.length} planets with orbitRadius < ${MIN_ORBIT_RADIUS}`);

  if (tooClose.length > 0) {
    console.log('\n📝 Planets to update:');
    tooClose.forEach(p => {
      console.log(`  ${p.title}: ${p.orbitRadius.toFixed(2)} → ${MIN_ORBIT_RADIUS} (scaled: ${MIN_ORBIT_RADIUS * 150} units)`);
    });

    console.log('\n🔧 Updating planets...');
    const result = await assetsCollection.updateMany(
      { assetType: 'planet', orbitRadius: { $lt: MIN_ORBIT_RADIUS } },
      { $set: { orbitRadius: MIN_ORBIT_RADIUS } }
    );

    console.log(`✅ Updated ${result.modifiedCount} planets to minimum orbit radius ${MIN_ORBIT_RADIUS}`);
  } else {
    console.log('✅ All planets are at safe distances from the star!');
  }

  await client.close();
  process.exit(0);
} catch (err) {
  console.error('❌ Error:', err);
  await client.close();
  process.exit(1);
}
