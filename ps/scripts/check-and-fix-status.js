import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function checkAndFixStatus() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    // Check current status
    const allAssets = await assetsCollection.find({}).toArray();
    console.log(`Total assets: ${allAssets.length}`);

    const withStatus = allAssets.filter(a => a.status);
    const withoutStatus = allAssets.filter(a => !a.status);

    console.log(`Assets with status: ${withStatus.length}`);
    console.log(`Assets without status: ${withoutStatus.length}\n`);

    if (withoutStatus.length > 0) {
      console.log('Fixing assets without status...');

      const result = await assetsCollection.updateMany(
        { status: { $exists: false } },
        { $set: { status: 'approved' } }
      );

      console.log(`✅ Updated ${result.modifiedCount} assets to 'approved' status\n`);
    }

    // Verify
    const sample = await assetsCollection.find({}).limit(5).toArray();
    console.log('Sample assets after fix:');
    sample.forEach(a => {
      console.log(`  ${a.title}: status=${a.status}, assetType=${a.assetType}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('\n✅ Done');
  }
}

checkAndFixStatus();
