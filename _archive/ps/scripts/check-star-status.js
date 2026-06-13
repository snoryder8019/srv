/**
 * Check Star Status Fields
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function checkStarStatus() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    const stars = await db.collection('assets')
      .find({ assetType: 'star' })
      .project({ title: 1, status: 1, approvalStatus: 1, isPublished: 1 })
      .limit(5)
      .toArray();

    console.log('Star Status Fields:\n');
    stars.forEach(s => {
      console.log(`${s.title}:`);
      console.log(`  status: ${s.status}`);
      console.log(`  approvalStatus: ${s.approvalStatus}`);
      console.log(`  isPublished: ${s.isPublished}\n`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkStarStatus();
