/**
 * Verify distributed assets are in database
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function verifyAssets() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const assets = await db.collection('assets')
      .find({ status: 'published' })
      .project({ title: 1, assetType: 1, subType: 1, initialPosition: 1, 'hubData.isStartingLocation': 1 })
      .toArray();

    console.log('\n✓ Published Assets Count:', assets.length);

    const hubs = assets.filter(a => a.hubData?.isStartingLocation);
    const galaxies = assets.filter(a => a.assetType === 'galaxy');
    const orbitals = assets.filter(a => a.assetType === 'orbital');
    const anomalies = assets.filter(a => a.assetType === 'anomaly' && !a.hubData?.isStartingLocation);

    console.log('\n=== SPACE HUBS ===');
    hubs.forEach(a => {
      console.log(`  ✦ ${a.title} (hub)`);
    });

    console.log('\n=== GALAXIES ===');
    galaxies.forEach(a => {
      const pos = a.initialPosition ? `at (${a.initialPosition.x}, ${a.initialPosition.y})` : '(no position)';
      console.log(`  ⭐ ${a.title} ${pos}`);
    });

    console.log('\n=== ORBITALS ===');
    orbitals.forEach(a => {
      const pos = a.initialPosition ? `at (${a.initialPosition.x}, ${a.initialPosition.y})` : '(no position)';
      console.log(`  🛰  ${a.title} ${pos}`);
    });

    console.log('\n=== ANOMALIES ===');
    anomalies.forEach(a => {
      const pos = a.initialPosition ? `at (${a.initialPosition.x}, ${a.initialPosition.y})` : '(no position)';
      console.log(`  ❓ ${a.title} ${pos}`);
    });

    console.log('\n=== SUMMARY ===');
    console.log(`  Space Hubs: ${hubs.length}`);
    console.log(`  Galaxies: ${galaxies.length}`);
    console.log(`  Orbitals: ${orbitals.length}`);
    console.log(`  Anomalies: ${anomalies.length}`);
    console.log(`  Total: ${assets.length}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

verifyAssets();
