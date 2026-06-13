/**
 * Check Asset Coordinates in Database
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function checkCoordinates() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    console.log('🔍 Checking Asset Coordinates\n');

    // Check galaxies
    const galaxies = await db.collection('assets')
      .find({ assetType: 'galaxy' })
      .project({ title: 1, coordinates: 1, isPublished: 1 })
      .toArray();

    console.log('🌌 GALAXIES:');
    galaxies.forEach(g => {
      console.log(`  ${g.title}`);
      console.log(`    Published: ${g.isPublished}`);
      console.log(`    Coords: (${g.coordinates?.x || 0}, ${g.coordinates?.y || 0}, ${g.coordinates?.z || 0})`);
    });

    // Check stars
    const stars = await db.collection('assets')
      .find({ assetType: 'star' })
      .project({ title: 1, coordinates: 1, isPublished: 1, approvalStatus: 1 })
      .toArray();

    console.log('\n⭐ STARS:');
    stars.forEach(s => {
      console.log(`  ${s.title}`);
      console.log(`    Published: ${s.isPublished}, Status: ${s.approvalStatus}`);
      console.log(`    Coords: (${s.coordinates?.x || 0}, ${s.coordinates?.y || 0}, ${s.coordinates?.z || 0})`);
    });

    // Check planets (just count)
    const planetCount = await db.collection('assets').countDocuments({ assetType: 'planet' });
    console.log(`\n🌍 PLANETS: ${planetCount} total`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkCoordinates();
