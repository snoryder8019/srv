/**
 * Seed all existing characters with default ship fittings
 * Adds survival system fittings (fuel, food, oxygen, medkits)
 */
import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';

console.log('🚀 Starting ship fittings seed script...\n');

try {
  await connectDB();
  console.log('✅ Connected to database\n');

  const db = getDb();
  const characters = await db.collection(collections.characters).find({}).toArray();

  console.log(`📊 Found ${characters.length} characters to process\n`);

  const defaultFittings = {
    cargoCapacity: 500,
    cargoUsed: 0,

    lifeSupport: {
      installed: true,
      type: 'Advanced',
      oxygenCapacity: 1000,
      oxygenRemaining: 1000,
      foodCapacity: 100,
      foodRemaining: 100
    },

    fuelTanks: {
      capacity: 1000,
      remaining: 1000,
      type: 'Deuterium'
    },

    medicalBay: {
      installed: true,
      medKitsCapacity: 20,
      medKitsRemaining: 20,
      autoRevive: true
    },

    habitat: {
      type: 'Human',
      installed: true
    },

    shielding: {
      radiation: 50,
      thermal: 30,
      nebula: 0
    },

    specialFittings: []
  };

  let updated = 0;
  let skipped = 0;

  for (const char of characters) {
    // Check if ship exists
    if (!char.ship) {
      // Create basic ship structure
      await db.collection(collections.characters).updateOne(
        { _id: char._id },
        {
          $set: {
            ship: {
              name: 'Explorer',
              class: 'Scout',
              hull: {
                maxHP: 100,
                currentHP: 100,
                armor: 10
              },
              fittings: {
                ...defaultFittings,
                habitat: {
                  type: char.species || 'Human',
                  installed: true
                }
              }
            }
          }
        }
      );
      updated++;
      console.log(`✅ Created ship with fittings for "${char.name}"`);
    } else if (!char.ship.fittings || !char.ship.fittings.fuelTanks) {
      // Ship exists but missing survival fittings - add them
      const fittingsToAdd = {
        ...defaultFittings,
        habitat: {
          type: char.species || char.ship.fittings?.habitat?.type || 'Human',
          installed: true
        }
      };

      // Preserve existing highSlots, midSlots, lowSlots, rigSlots if they exist
      if (char.ship.fittings) {
        if (char.ship.fittings.highSlots) fittingsToAdd.highSlots = char.ship.fittings.highSlots;
        if (char.ship.fittings.midSlots) fittingsToAdd.midSlots = char.ship.fittings.midSlots;
        if (char.ship.fittings.lowSlots) fittingsToAdd.lowSlots = char.ship.fittings.lowSlots;
        if (char.ship.fittings.rigSlots) fittingsToAdd.rigSlots = char.ship.fittings.rigSlots;
      }

      await db.collection(collections.characters).updateOne(
        { _id: char._id },
        {
          $set: {
            'ship.fittings': fittingsToAdd
          }
        }
      );
      updated++;
      console.log(`✅ Added survival fittings to "${char.name}"`);
    } else {
      skipped++;
      console.log(`⏭️  Skipped "${char.name}" (already has fittings)`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Seeding complete!`);
  console.log(`   Updated: ${updated} characters`);
  console.log(`   Skipped: ${skipped} characters (already configured)`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(0);

} catch (error) {
  console.error('❌ Error seeding ship fittings:', error);
  process.exit(1);
}
