/**
 * Reset All Characters to Home Starting Points
 * Moves all characters back to their String Domain space hub
 * Clears navigation and docking status
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { getHubByString, getSpawnPosition } from '../config/spaceHubs.js';

async function resetAllCharacters() {
  try {
    // Initialize database connection
    await connectDB();
    const db = getDb();

    console.log('🔄 Resetting all characters to home starting points...\n');

    // Get all characters
    const characters = await db.collection('characters').find({}).toArray();

    if (characters.length === 0) {
      console.log('⚠️  No characters found in database.');
      process.exit(0);
    }

    console.log(`📊 Found ${characters.length} character(s) to reset:\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const character of characters) {
      try {
        // Get the character's String Domain
        const stringDomain = character.stringDomain || 'Time String';

        // Get home hub for this String Domain
        const homeHub = getHubByString(stringDomain);

        // Get spawn position within the hub
        const spawnPosition = getSpawnPosition(homeHub);

        console.log(`   ${character.name} (${character.stringDomain || 'Unknown'})`);
        console.log(`   Current: (${Math.round(character.location?.x || 0)}, ${Math.round(character.location?.y || 0)})`);
        console.log(`   → Moving to: ${homeHub.name}`);
        console.log(`   → New position: (${Math.round(spawnPosition.x)}, ${Math.round(spawnPosition.y)})`);

        // Reset character to home hub
        const result = await db.collection('characters').updateOne(
          { _id: character._id },
          {
            $set: {
              // Update location to home hub spawn point
              'location.x': spawnPosition.x,
              'location.y': spawnPosition.y,
              'location.vx': 0,
              'location.vy': 0,
              'location.zone': homeHub.name,
              'location.assetId': null, // Not docked, in open space near hub
              'location.lastUpdated': new Date(),

              // Update/ensure home hub is set
              'homeHub': {
                id: homeHub.id,
                name: homeHub.name,
                stringDomain: homeHub.stringDomain,
                location: homeHub.location
              },

              // Clear navigation
              'navigation.destination': null,
              'navigation.isInTransit': false,
              'navigation.eta': null,

              // Update timestamp
              updatedAt: new Date()
            }
          }
        );

        if (result.modifiedCount > 0) {
          console.log(`   ✅ Successfully reset\n`);
          successCount++;
        } else {
          console.log(`   ⚠️  No changes made (already at home?)\n`);
          successCount++;
        }

      } catch (charError) {
        console.error(`   ❌ Error resetting ${character.name}:`, charError.message, '\n');
        errorCount++;
      }
    }

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('📊 Reset Summary:');
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📍 Total: ${characters.length}`);
    console.log('═══════════════════════════════════════\n');

    // Show final state
    console.log('🏠 Characters by Home Hub:\n');

    const updatedCharacters = await db.collection('characters').find({}).toArray();
    const hubGroups = {};

    updatedCharacters.forEach(char => {
      const hubName = char.homeHub?.name || 'Unknown Hub';
      if (!hubGroups[hubName]) {
        hubGroups[hubName] = [];
      }
      hubGroups[hubName].push({
        name: char.name,
        domain: char.stringDomain,
        position: `(${Math.round(char.location.x)}, ${Math.round(char.location.y)})`
      });
    });

    for (const [hubName, chars] of Object.entries(hubGroups)) {
      console.log(`   ${hubName}:`);
      chars.forEach(char => {
        console.log(`      - ${char.name} | ${char.domain} | ${char.position}`);
      });
      console.log('');
    }

    console.log('✨ All characters have been reset to their home starting points!');
    console.log('🚀 Players can now login and will spawn at their String Domain hub.\n');

    process.exit(0);

  } catch (error) {
    console.error('❌ Error resetting characters:', error);
    process.exit(1);
  }
}

// Run the script
resetAllCharacters();
