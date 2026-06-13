/**
 * Fix Crimson Nebula Stars Status
 * Set status field to 'approved' for all Crimson Nebula stars
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function fixCrimsonStarsStatus() {
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

    console.log('🌟 Fixing Crimson Nebula Stars Status:\n');

    let fixed = 0;
    for (const title of crimsonStars) {
      const result = await db.collection('assets').updateOne(
        { title: title, assetType: 'star' },
        {
          $set: {
            status: 'approved',
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount > 0) {
        console.log(`✅ ${title}: status set to 'approved'`);
        fixed++;
      } else {
        console.log(`❌ ${title}: not found`);
      }
    }

    console.log(`\n✅ Fixed ${fixed} stars!`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

fixCrimsonStarsStatus();
