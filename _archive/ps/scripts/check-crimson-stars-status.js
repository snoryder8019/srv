/**
 * Check Crimson Nebula Stars Status
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function checkCrimsonStars() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    const crimsonStars = [
      'Crimson Heart',
      'Ruby Beacon',
      'Scarlet Forge',
      'Bloodstone Binary',
      'Vermillion Outpost',
      'Garnet Prime'
    ];

    console.log('🌟 Crimson Nebula Stars Status:\n');

    for (const title of crimsonStars) {
      const star = await db.collection('assets').findOne(
        { title: title, assetType: 'star' },
        { projection: { title: 1, status: 1, approvalStatus: 1, isPublished: 1, coordinates: 1 } }
      );

      if (star) {
        console.log(`${title}:`);
        console.log(`  status: ${star.status}`);
        console.log(`  approvalStatus: ${star.approvalStatus}`);
        console.log(`  isPublished: ${star.isPublished}`);
        console.log(`  coords: (${star.coordinates?.x || 0}, ${star.coordinates?.y || 0})\n`);
      } else {
        console.log(`${title}: NOT FOUND\n`);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkCrimsonStars();
