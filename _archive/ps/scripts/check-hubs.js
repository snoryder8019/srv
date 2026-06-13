import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

try {
  await client.connect();
  const db = client.db(process.env.DB_NAME);

  const hubs = await db.collection('assets').find({
    'hubData.isStartingLocation': true
  }).toArray();

  console.log(`\nFound ${hubs.length} space hubs:\n`);
  hubs.forEach(h => {
    console.log(`${h.title}:`);
    console.log(`  - Has hubData: ${!!h.hubData}`);
    console.log(`  - Location: ${h.hubData?.location ? `(${h.hubData.location.x}, ${h.hubData.location.y})` : 'MISSING'}`);
    console.log(`  - Status: ${h.status}`);
    console.log(`  - isStartingLocation: ${h.hubData?.isStartingLocation}`);
    console.log('');
  });

  await client.close();
} catch (error) {
  console.error('Error:', error);
  await client.close();
  process.exit(1);
}
