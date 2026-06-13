/**
 * Add Missing Character Locations
 *
 * This script checks all characters and adds default spawn locations
 * to any that don't have one.
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { getHubByString, getSpawnPosition } from '../config/spaceHubs.js';

async function addMissingLocations() {
  try {
    console.log('🔍 Connecting to database...');
    await connectDB();
    const db = getDb();

    console.log('📊 Fetching all characters...');
    const characters = await db.collection('characters').find({}).toArray();

    console.log(`\n✅ Found ${characters.length} characters\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const character of characters) {
      const hasLocation = character.location &&
                          typeof character.location.x === 'number' &&
                          typeof character.location.y === 'number';

      if (hasLocation) {
        console.log(`✓ ${character.name} - Already has location (${character.location.x}, ${character.location.y})`);
        skippedCount++;
      } else {
        // Character missing location - add default spawn
        const stringDomain = character.stringDomain || 'Time String';
        const homeHub = getHubByString(stringDomain);
        const spawnPosition = getSpawnPosition(homeHub);

        console.log(`⚠️  ${character.name} - Missing location! Adding spawn at ${homeHub.name}...`);

        const updateResult = await db.collection('characters').updateOne(
          { _id: character._id },
          {
            $set: {
              location: {
                x: spawnPosition.x,
                y: spawnPosition.y,
                vx: 0,
                vy: 0,
                assetId: null
              },
              navigation: {
                destination: null,
                isInTransit: false,
                path: [],
                progress: 0
              },
              homeHub: {
                id: homeHub.id,
                name: homeHub.name,
                stringDomain: homeHub.stringDomain,
                location: homeHub.location
              },
              updatedAt: new Date()
            }
          }
        );

        if (updateResult.modifiedCount > 0) {
          console.log(`   ✅ Added location: (${spawnPosition.x}, ${spawnPosition.y})`);
          updatedCount++;
        } else {
          console.log(`   ❌ Failed to update ${character.name}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📈 Summary:');
    console.log('='.repeat(60));
    console.log(`Total characters:        ${characters.length}`);
    console.log(`Already had locations:   ${skippedCount}`);
    console.log(`Locations added:         ${updatedCount}`);
    console.log('='.repeat(60));

    if (updatedCount > 0) {
      console.log('\n✅ All characters now have locations!');
    } else {
      console.log('\n✅ All characters already had locations!');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding missing locations:', error);
    process.exit(1);
  }
}

// Run the script
addMissingLocations();
