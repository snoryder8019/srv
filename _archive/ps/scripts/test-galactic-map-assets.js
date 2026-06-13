/**
 * Test Galactic Map Asset Loading
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function testAssets() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    const validTypes = ['galaxy', 'star', 'orbital', 'anomaly'];

    const assets = await db.collection('assets')
      .find({ status: 'approved', assetType: { $in: validTypes } })
      .project({ title: 1, assetType: 1, coordinates: 1 })
      .toArray();

    const withCoords = assets.filter(a => {
      const coords = a.coordinates || {};
      return coords.x !== 0 || coords.y !== 0;
    });

    const missing = assets.filter(a => {
      const coords = a.coordinates || {};
      return coords.x === 0 && coords.y === 0;
    });

    console.log('\n🗺️  Galactic Map Asset Analysis\n');
    console.log(`Total galactic map assets: ${assets.length}`);
    console.log(`With coordinates: ${withCoords.length}`);
    console.log(`Missing coordinates: ${missing.length}\n`);

    if (missing.length > 0) {
      console.log('Assets missing coordinates:');
      missing.forEach(a => {
        console.log(`  ❌ ${a.title} (${a.assetType})`);
      });
    } else {
      console.log('✅ All galactic map assets have coordinates!');
    }

    console.log('\n📊 Breakdown by type:\n');
    const byType = {};
    validTypes.forEach(type => {
      const typeAssets = assets.filter(a => a.assetType === type);
      const typeWithCoords = withCoords.filter(a => a.assetType === type);
      byType[type] = {
        total: typeAssets.length,
        withCoords: typeWithCoords.length
      };
      console.log(`${type.padEnd(10)} ${typeAssets.length} total, ${typeWithCoords.length} with coords`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

testAssets();
