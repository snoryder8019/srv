/**
 * Migrate existing characters to space hubs based on their string domain
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { getHubByString, getSpawnPosition } from '../config/spaceHubs.js';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function migrateCharacters() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const charactersCollection = db.collection('characters');

    // Get all characters
    const characters = await charactersCollection.find({}).toArray();
    console.log(`\nFound ${characters.length} characters to migrate`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const character of characters) {
      // Skip if already has homeHub
      if (character.homeHub) {
        console.log(`⊙ ${character.name} already has home hub, skipping...`);
        skippedCount++;
        continue;
      }

      // Get hub based on string domain (or default to Time String)
      const stringDomain = character.stringDomain || 'Time String';
      const homeHub = getHubByString(stringDomain);
      const spawnLocation = getSpawnPosition(homeHub);

      // Update character
      await charactersCollection.updateOne(
        { _id: character._id },
        {
          $set: {
            stringDomain: stringDomain, // Ensure it's set
            homeHub: {
              id: homeHub.id,
              name: homeHub.name,
              stringDomain: homeHub.stringDomain,
              location: homeHub.location
            },
            'location.x': spawnLocation.x,
            'location.y': spawnLocation.y,
            'location.zone': homeHub.name,
            'location.lastUpdated': new Date(),
            updatedAt: new Date()
          }
        }
      );

      console.log(`✓ ${character.name} → ${homeHub.name} (${stringDomain}) at (${Math.round(spawnLocation.x)}, ${Math.round(spawnLocation.y)})`);
      migratedCount++;
    }

    console.log(`\n✓ Migration complete!`);
    console.log(`  Migrated: ${migratedCount}`);
    console.log(`  Skipped: ${skippedCount}`);
    console.log(`  Total: ${characters.length}`);

  } catch (error) {
    console.error('Error migrating characters:', error);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

migrateCharacters();
