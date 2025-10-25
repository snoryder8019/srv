/**
 * Check Orbitals and Anomalies
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function checkAssets() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    console.log('=== ORBITALS ===\n');
    const orbitals = await db.collection('assets')
      .find({ assetType: 'orbital', status: 'approved' })
      .project({ title: 1, parentStar: 1, parentGalaxy: 1, coordinates: 1, subType: 1 })
      .limit(10)
      .toArray();

    orbitals.forEach(o => {
      console.log(`${o.title}`);
      console.log(`  SubType: ${o.subType || 'none'}`);
      console.log(`  Parent Star: ${o.parentStar ? 'YES' : 'NO'}`);
      console.log(`  Parent Galaxy: ${o.parentGalaxy ? 'YES' : 'NO'}`);
      console.log(`  Coords: (${o.coordinates?.x || 0}, ${o.coordinates?.y || 0})\n`);
    });

    console.log('=== ANOMALIES ===\n');
    const anomalies = await db.collection('assets')
      .find({ assetType: 'anomaly', status: 'approved' })
      .project({ title: 1, description: 1, coordinates: 1, subType: 1, hubData: 1 })
      .limit(10)
      .toArray();

    anomalies.forEach(a => {
      console.log(`${a.title}`);
      console.log(`  SubType: ${a.subType || 'none'}`);
      console.log(`  Is Hub: ${a.hubData?.isStartingLocation ? 'YES' : 'NO'}`);
      console.log(`  Coords: (${a.coordinates?.x || 0}, ${a.coordinates?.y || 0})`);
      console.log(`  Desc: ${a.description?.substring(0, 60)}...\n`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkAssets();
