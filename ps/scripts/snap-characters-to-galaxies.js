/**
 * Snap Characters to Galaxy Positions
 *
 * This migration script moves all characters to their docked galaxy's position.
 * Previously, characters were stored at their own independent coordinates which
 * could be thousands of units away from their docked galaxy.
 *
 * Now, characters should be AT their galaxy's position and move with it through space.
 */

import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function snapCharactersToGalaxies() {
  try {
    await client.connect();
    console.log('✅ Connected to database');

    const db = client.db(process.env.DB_NAME);
    const charactersCollection = db.collection('characters');
    const assetsCollection = db.collection('assets');

    // Get all characters with galactic positions
    const characters = await charactersCollection.find({
      'location.type': 'galactic'
    }).toArray();

    console.log(`\n📍 Found ${characters.length} characters with galactic positions\n`);

    let snappedCount = 0;
    let skippedCount = 0;

    for (const character of characters) {
      // Skip characters in transit
      if (character.navigation?.isInTransit) {
        console.log(`⏩ Skipping "${character.name}" (in transit)`);
        skippedCount++;
        continue;
      }

      // Character must have a docked galaxy
      if (!character.location.dockedGalaxyId) {
        console.log(`⚠️  "${character.name}" has no docked galaxy - skipping`);
        skippedCount++;
        continue;
      }

      // Find the galaxy
      const galaxy = await assetsCollection.findOne({
        _id: new ObjectId(character.location.dockedGalaxyId)
      });

      if (!galaxy) {
        console.log(`❌ Galaxy not found for "${character.name}" (${character.location.dockedGalaxyId})`);
        skippedCount++;
        continue;
      }

      // Calculate current distance
      const oldDist = Math.sqrt(
        Math.pow(character.location.x - galaxy.coordinates.x, 2) +
        Math.pow(character.location.y - galaxy.coordinates.y, 2) +
        Math.pow(character.location.z - galaxy.coordinates.z, 2)
      );

      console.log(`📌 "${character.name}" @ ${galaxy.title}`);
      console.log(`   Old position: (${character.location.x.toFixed(1)}, ${character.location.y.toFixed(1)}, ${character.location.z.toFixed(1)})`);
      console.log(`   Galaxy position: (${galaxy.coordinates.x.toFixed(1)}, ${galaxy.coordinates.y.toFixed(1)}, ${galaxy.coordinates.z.toFixed(1)})`);
      console.log(`   Distance: ${oldDist.toFixed(2)} units`);

      // Update character position to match galaxy
      await charactersCollection.updateOne(
        { _id: character._id },
        {
          $set: {
            'location.x': galaxy.coordinates.x,
            'location.y': galaxy.coordinates.y,
            'location.z': galaxy.coordinates.z,
            'location.lastUpdated': new Date()
          }
        }
      );

      console.log(`   ✅ Snapped to galaxy position\n`);
      snappedCount++;
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   - Snapped: ${snappedCount} characters`);
    console.log(`   - Skipped: ${skippedCount} characters`);

  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migration
snapCharactersToGalaxies()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
