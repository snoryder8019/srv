/**
 * Create Starship Colony - Mobile space station starting point
 * Place all characters at this colony
 */
import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';

console.log('🛸 Creating Starship Colony...\n');

try {
  await connectDB();
  console.log('✅ Connected to database\n');

  const db = getDb();

  // Create the Starship Colony asset
  const colony = {
    assetType: 'station',
    category: 'starship_colony',
    title: 'Starship Colony',
    description: 'A massive mobile space station serving as the primary hub for explorers and traders. This self-sustaining colony houses thousands and serves as a safe haven in the vastness of space.',

    // Galactic coordinates - place it in neutral space
    coordinates: {
      x: 0,
      y: 0,
      z: 0
    },

    // Station stats
    stats: {
      population: 50000,
      dockingBays: 500,
      services: ['medical', 'trading', 'ship_repair', 'supplies', 'lodging'],
      securityLevel: 'high',
      size: 'massive'
    },

    // Facilities
    facilities: {
      storehouse: true,
      shipyard: true,
      medical: true,
      trading: true,
      resupply: true
    },

    // Physics properties (it's a mobile station)
    physics: {
      mass: 100000000, // Massive
      velocity: { x: 0, y: 0, z: 0 }, // Stationary for now
      canMove: true
    },

    // Docking info
    docking: {
      available: true,
      capacity: 500,
      currentDockedShips: 0
    },

    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Check if colony already exists
  const existing = await db.collection(collections.assets).findOne({
    title: 'Starship Colony'
  });

  let colonyId;
  if (existing) {
    console.log('⏭️  Starship Colony already exists, updating...');
    await db.collection(collections.assets).updateOne(
      { _id: existing._id },
      { $set: colony }
    );
    colonyId = existing._id;
  } else {
    const result = await db.collection(collections.assets).insertOne(colony);
    colonyId = result.insertedId;
    console.log('✅ Created Starship Colony asset');
  }

  // Create a storehouse for the colony
  const storehouseExists = await db.collection(collections.storehouses).findOne({
    galaxyId: colonyId
  });

  if (!storehouseExists) {
    await db.collection(collections.storehouses).insertOne({
      galaxyId: colonyId,
      inventory: {
        fuel: 100000, // Massive supplies
        food: 50000,
        oxygen: 200000,
        medkits: 10000,
        custom: []
      },
      access: {
        public: true,
        allowedUsers: []
      },
      lastUpdated: new Date(),
      createdAt: new Date()
    });
    console.log('✅ Created storehouse for Starship Colony');
  }

  // Move all characters to the colony
  const characters = await db.collection(collections.characters).find({}).toArray();
  console.log(`\n📊 Moving ${characters.length} characters to Starship Colony...\n`);

  let moved = 0;
  for (const char of characters) {
    await db.collection(collections.characters).updateOne(
      { _id: char._id },
      {
        $set: {
          'location.type': 'galactic',
          'location.x': 0,
          'location.y': 0,
          'location.z': 0,
          'location.vx': 0,
          'location.vy': 0,
          'location.vz': 0,
          'location.zone': 'Starship Colony',
          'location.assetId': colonyId.toString(),
          'location.dockedGalaxyId': null, // Not docked at a galaxy, docked at colony
          'location.lastUpdated': new Date(),
          'navigation.destination': null,
          'navigation.isInTransit': false,
          'navigation.eta': null
        }
      }
    );
    moved++;
    console.log(`✅ Moved "${char.name}" to Starship Colony`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Starship Colony setup complete!`);
  console.log(`   Colony ID: ${colonyId}`);
  console.log(`   Location: (0, 0, 0) - Galactic Center`);
  console.log(`   Characters relocated: ${moved}`);
  console.log(`   Storehouse: Fully stocked`);
  console.log(`${'='.repeat(50)}\n`);

  console.log('💡 The Starship Colony is now at the center of the galactic map');
  console.log('💡 All characters start here with access to full supplies\n');

  process.exit(0);

} catch (error) {
  console.error('❌ Error creating Starship Colony:', error);
  process.exit(1);
}
