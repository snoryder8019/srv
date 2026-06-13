import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function checkGalaxies() {
  await client.connect();
  const db = client.db(process.env.DB_NAME);

  const galaxyCount = await db.collection('assets').countDocuments({assetType: 'galaxy'});
  const starCount = await db.collection('assets').countDocuments({assetType: 'star'});
  const publishedGalaxies = await db.collection('assets').countDocuments({assetType: 'galaxy', isPublished: true});
  const publishedStars = await db.collection('assets').countDocuments({assetType: 'star', isPublished: true});

  console.log('📊 Asset Counts:');
  console.log('  Galaxies (total):', galaxyCount);
  console.log('  Stars (total):', starCount);
  console.log('  Published Galaxies:', publishedGalaxies);
  console.log('  Published Stars:', publishedStars);

  if (galaxyCount === 0) {
    console.log('\n⚠️  No galaxy assets found in assets collection!');
    console.log('Looking for galaxies in other collections...');

    // Check galacticState
    const galacticState = await db.collection('galacticState').findOne({});
    if (galacticState && galacticState.galaxies) {
      console.log('✓ Found galaxies in galacticState collection');
      console.log('  Galaxy names:', Object.keys(galacticState.galaxies));
    }

    // Check for any published assets that might be galaxies
    const anyPublished = await db.collection('assets').find({isPublished: true}).limit(5).toArray();
    console.log('\nSample published assets:', anyPublished.map(a => `${a.title} (${a.assetType})`));
  } else {
    // Show sample galaxies
    const galaxies = await db.collection('assets').find({assetType: 'galaxy'}).limit(5).toArray();
    console.log('\n🌌 Sample Galaxies:');
    galaxies.forEach(g => {
      console.log(`  - ${g.title} (Published: ${g.isPublished || false})`);
    });
  }

  await client.close();
}

checkGalaxies();
