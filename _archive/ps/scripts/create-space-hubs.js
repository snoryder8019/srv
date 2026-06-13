/**
 * Create the 4 corner space hub anomalies
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { getAllHubs } from '../config/spaceHubs.js';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function createSpaceHubs() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const assetsCollection = db.collection('assets');

    const hubs = getAllHubs();

    for (const hub of hubs) {
      // Check if hub already exists
      const existing = await assetsCollection.findOne({ title: hub.name });

      if (existing) {
        console.log(`⊙ ${hub.name} already exists, skipping...`);
        continue;
      }

      // Create hub asset
      const hubAsset = {
        userId: 'system', // System-created asset
        title: hub.name,
        description: hub.description,
        assetType: hub.assetType,
        subType: hub.subType,
        status: 'approved', // Auto-approved

        // Images (can add later)
        images: {
          pixelArt: null,
          fullscreen: null,
          indexCard: null
        },
        pixelData: null,
        animationFrames: [],

        // Lore
        lore: `${hub.name} serves as the primary hub for ${hub.stringDomain} wielders.`,
        backstory: hub.description,
        flavor: `"The ${hub.stringDomain} flows through this place like a river of power."`,

        // Stats
        stats: {
          capacity: 100000,      // Population capacity
          defenseRating: 999,    // Invulnerable
          dockingBays: 500,      // Can dock many ships
          stringAmplification: 10 // Boosts string power
        },

        requirements: {},
        effects: [
          {
            type: 'spawn_location',
            stringDomain: hub.stringDomain
          },
          {
            type: 'safe_zone',
            description: 'No combat allowed'
          },
          {
            type: 'string_boost',
            value: 10,
            stringDomain: hub.stringDomain
          }
        ],

        // Metadata
        tags: ['space-hub', 'starting-location', hub.stringDomain.toLowerCase().replace(/\s+/g, '-')],
        category: 'infrastructure',

        // Community features
        votes: 999,
        voters: [],
        suggestions: [],
        collaborators: [],

        // Hub-specific data
        hubData: {
          stringDomain: hub.stringDomain,
          isStartingLocation: true,
          spawnRadius: hub.spawnRadius,
          primarySpecies: hub.primarySpecies,
          location: hub.location,
          color: hub.color,
          icon: hub.icon
        },

        // Admin
        adminNotes: 'System-generated space hub for character spawning',
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: new Date(),
        approvedBy: 'system'
      };

      const result = await assetsCollection.insertOne(hubAsset);
      console.log(`✓ Created ${hub.name} (${hub.stringDomain}) at (${hub.location.x}, ${hub.location.y})`);
      console.log(`  Asset ID: ${result.insertedId}`);
    }

    console.log('\n✓ All space hubs created successfully!');
    console.log('\nSpace Hub Summary:');
    console.log('  Time String → Temporal Nexus Station (500, 500)');
    console.log('  Tech String → Quantum Forge Complex (4500, 500)');
    console.log('  Faith String → Celestial Sanctum (500, 4500)');
    console.log('  War String → Crimson Bastion (4500, 4500)');

  } catch (error) {
    console.error('Error creating space hubs:', error);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

createSpaceHubs();
