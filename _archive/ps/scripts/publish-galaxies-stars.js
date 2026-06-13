import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function publishGalaxiesAndStars() {
  await client.connect();
  const db = client.db(process.env.DB_NAME);

  console.log('Publishing all galaxies and stars...\n');

  // Publish all galaxies
  const galaxyResult = await db.collection('assets').updateMany(
    { assetType: 'galaxy' },
    {
      $set: {
        isPublished: true,
        approvalStatus: 'approved',
        updatedAt: new Date()
      }
    }
  );

  console.log(`✅ Published ${galaxyResult.modifiedCount} galaxies`);

  // Publish all stars
  const starResult = await db.collection('assets').updateMany(
    { assetType: 'star' },
    {
      $set: {
        isPublished: true,
        approvalStatus: 'approved',
        updatedAt: new Date()
      }
    }
  );

  console.log(`✅ Published ${starResult.modifiedCount} star systems`);

  // Show what was published
  const galaxies = await db.collection('assets').find({ assetType: 'galaxy', isPublished: true }).toArray();
  const stars = await db.collection('assets').find({ assetType: 'star', isPublished: true }).toArray();

  console.log('\n🌌 Published Galaxies:');
  galaxies.forEach(g => console.log(`  - ${g.title}`));

  console.log('\n⭐ Published Star Systems:');
  stars.forEach(s => console.log(`  - ${s.title} (in ${s.parentGalaxyName || 'unknown galaxy'})`));

  console.log('\n✅ All galaxies and stars are now published and available in the asset builder!');

  await client.close();
}

publishGalaxiesAndStars();
