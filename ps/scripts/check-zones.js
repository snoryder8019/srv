/**
 * Check existing zones in database
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function checkZones() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const zones = await db.collection('zones').find({}).toArray();

    console.log('\n=== EXISTING ZONES ===');
    console.log(`Total: ${zones.length}\n`);

    zones.forEach(z => {
      console.log(`- ${z.zoneName || z.displayName}`);
      if (z.type) console.log(`  Type: ${z.type}`);
      if (z.orbitalBodyId) console.log(`  Orbital: ${z.orbitalBodyId}`);
    });

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

checkZones();
