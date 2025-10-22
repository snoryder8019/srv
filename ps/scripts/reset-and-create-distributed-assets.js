/**
 * Reset assets and create new distributed orbitals and anomalies
 * Keeps space hubs, removes everything else, creates fresh distributed assets
 */
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function resetAndCreateAssets() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const assetsCollection = db.collection('assets');

    // Delete all non-hub assets
    const deleteResult = await assetsCollection.deleteMany({
      'hubData.isStartingLocation': { $ne: true }
    });
    console.log(`🗑️  Deleted ${deleteResult.deletedCount} old assets (kept space hubs)\n`);

    // Create system user ID for assets
    const systemUserId = 'system';

    // Define distributed assets across the 5000x5000 map
    const newAssets = [
      // ===== GALAXIES (moving celestial bodies) =====
      {
        title: 'Andromeda Spiral',
        assetType: 'galaxy',
        subType: 'spiral',
        position: { x: 1200, y: 1500 }, // Near Time hub
        description: 'Ancient spiral galaxy with billions of stars',
        votes: 150
      },
      {
        title: 'Crimson Nebula Galaxy',
        assetType: 'galaxy',
        subType: 'irregular',
        position: { x: 3800, y: 1200 }, // Near Tech hub
        description: 'Red-tinted galaxy formed from stellar collisions',
        votes: 120
      },
      {
        title: 'Elysium Cluster',
        assetType: 'galaxy',
        subType: 'elliptical',
        position: { x: 1100, y: 3700 }, // Near Faith hub
        description: 'Dense elliptical galaxy cluster radiating golden light',
        votes: 135
      },
      {
        title: 'Void Edge Galaxy',
        assetType: 'galaxy',
        subType: 'spiral',
        position: { x: 3900, y: 3800 }, // Near War hub
        description: 'Galaxy at the edge of known space',
        votes: 110
      },
      {
        title: 'Stellar Crown',
        assetType: 'galaxy',
        subType: 'barred-spiral',
        position: { x: 2500, y: 2500 }, // Center of map
        description: 'Majestic barred spiral in the galactic core',
        votes: 180
      },

      // ===== ORBITAL STATIONS =====
      {
        title: 'Trading Post Sigma',
        assetType: 'orbital',
        subType: 'trading-station',
        position: { x: 800, y: 1000 }, // Between Time and center
        description: 'Bustling trade hub connecting multiple sectors',
        votes: 95
      },
      {
        title: 'Forge Outpost Delta',
        assetType: 'orbital',
        subType: 'manufacturing',
        position: { x: 4200, y: 800 }, // Near Tech hub
        description: 'Advanced manufacturing and research facility',
        votes: 85
      },
      {
        title: 'Sanctuary Station',
        assetType: 'orbital',
        subType: 'medical',
        position: { x: 700, y: 4200 }, // Near Faith hub
        description: 'Medical station offering healing to all travelers',
        votes: 100
      },
      {
        title: 'Battle Station Omega',
        assetType: 'orbital',
        subType: 'military',
        position: { x: 4300, y: 4200 }, // Near War hub
        description: 'Heavily armed military installation',
        votes: 105
      },
      {
        title: 'Waypoint Nexus',
        assetType: 'orbital',
        subType: 'waystation',
        position: { x: 2500, y: 1800 }, // Upper center
        description: 'Rest stop for weary travelers',
        votes: 75
      },
      {
        title: 'Mining Platform Beta',
        assetType: 'orbital',
        subType: 'mining',
        position: { x: 1800, y: 3200 }, // Lower left area
        description: 'Asteroid mining operation extracting rare minerals',
        votes: 80
      },
      {
        title: 'Research Habitat Zeta',
        assetType: 'orbital',
        subType: 'research',
        position: { x: 3200, y: 2800 }, // Right center
        description: 'Scientific research station studying anomalies',
        votes: 90
      },

      // ===== ANOMALIES (stationary mysteries) =====
      {
        title: 'Temporal Rift',
        assetType: 'anomaly',
        subType: 'rift',
        position: { x: 1500, y: 1000 }, // Time quadrant
        description: 'Tear in spacetime leaking temporal energy',
        votes: 140
      },
      {
        title: 'Quantum Singularity',
        assetType: 'anomaly',
        subType: 'singularity',
        position: { x: 3500, y: 1500 }, // Tech quadrant
        description: 'Mysterious quantum phenomenon defying physics',
        votes: 130
      },
      {
        title: 'Divine Beacon',
        assetType: 'anomaly',
        subType: 'beacon',
        position: { x: 1300, y: 3500 }, // Faith quadrant
        description: 'Radiant energy source of unknown origin',
        votes: 125
      },
      {
        title: 'Chaos Vortex',
        assetType: 'anomaly',
        subType: 'vortex',
        position: { x: 3700, y: 3500 }, // War quadrant
        description: 'Violent energy storm consuming all nearby matter',
        votes: 115
      },
      {
        title: 'Crystal Lattice Formation',
        assetType: 'anomaly',
        subType: 'crystalline',
        position: { x: 2500, y: 3200 }, // Lower center
        description: 'Massive crystalline structure of alien origin',
        votes: 135
      },
      {
        title: 'Void Gate',
        assetType: 'anomaly',
        subType: 'gateway',
        position: { x: 2000, y: 2000 }, // Northwest of center
        description: 'Portal leading to unknown dimensions',
        votes: 160
      },
      {
        title: 'Nebula Cloud Echo',
        assetType: 'anomaly',
        subType: 'cloud',
        position: { x: 3000, y: 3000 }, // Southeast of center
        description: 'Sentient gas cloud that responds to thought',
        votes: 110
      }
    ];

    console.log('Creating distributed assets across the map...\n');

    for (const asset of newAssets) {
      const fullAsset = {
        userId: systemUserId,
        title: asset.title,
        description: asset.description,
        assetType: asset.assetType,
        subType: asset.subType,
        status: 'approved',

        images: {
          pixelArt: null,
          fullscreen: null,
          indexCard: null
        },

        lore: `${asset.title} - A ${asset.assetType} discovered in the depths of space.`,
        backstory: asset.description,
        flavor: `"${asset.title} awaits the bold and curious."`,

        stats: generateStats(asset.assetType, asset.subType),
        requirements: {},
        effects: [],

        tags: [asset.assetType, asset.subType, 'distributed'],
        category: asset.assetType,

        votes: asset.votes || 0,
        voters: [],
        suggestions: [],
        collaborators: [],

        // Store intended position (will be used by map)
        initialPosition: asset.position,

        adminNotes: `Distributed ${asset.assetType} - Auto-created`,
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: new Date(),
        approvedBy: 'system'
      };

      const result = await assetsCollection.insertOne(fullAsset);
      console.log(`✓ ${asset.title.padEnd(25)} (${asset.assetType.padEnd(10)}) at (${asset.position.x}, ${asset.position.y})`);
    }

    console.log(`\n✓ Created ${newAssets.length} distributed assets!`);
    console.log('\nAsset Distribution:');
    console.log(`  Galaxies: ${newAssets.filter(a => a.assetType === 'galaxy').length}`);
    console.log(`  Orbitals: ${newAssets.filter(a => a.assetType === 'orbital').length}`);
    console.log(`  Anomalies: ${newAssets.filter(a => a.assetType === 'anomaly').length}`);
    console.log(`  Total: ${newAssets.length}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

function generateStats(assetType, subType) {
  const baseStats = {
    galaxy: {
      diameter: Math.floor(Math.random() * 200000 + 100000),
      mass: Math.floor(Math.random() * 2000 + 500),
      stars: Math.floor(Math.random() * 500 + 100),
      age: Math.floor(Math.random() * 10 + 5)
    },
    orbital: {
      capacity: Math.floor(Math.random() * 10000 + 1000),
      defenseRating: Math.floor(Math.random() * 500 + 100),
      dockingBays: Math.floor(Math.random() * 50 + 10),
      crew: Math.floor(Math.random() * 5000 + 500)
    },
    anomaly: {
      energyOutput: Math.floor(Math.random() * 10000 + 1000),
      radius: Math.floor(Math.random() * 100 + 20),
      dangerLevel: Math.floor(Math.random() * 8 + 2),
      stability: Math.floor(Math.random() * 50 + 20)
    }
  };

  return baseStats[assetType] || {};
}

resetAndCreateAssets();
