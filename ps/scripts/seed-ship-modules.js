/**
 * Seed ship module items as inventory items
 * Creates equipable ship parts: engines, weapons, shields, hull components
 */
import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';

console.log('🚀 Starting ship modules seed script...\n');

try {
  await connectDB();
  console.log('✅ Connected to database\n');

  const db = getDb();

  // Define ship module templates
  const shipModules = [
    // === ENGINES (Low Slots) ===
    {
      itemType: 'ship_module',
      category: 'engine',
      slot: 'low',
      name: 'Mark I Ion Engine',
      description: 'Basic ion propulsion engine',
      stats: { thrust: 100, fuelEfficiency: 1.0, fuelType: 'deuterium' },
      mass: 50,
      powerUsage: 10
    },
    {
      itemType: 'ship_module',
      category: 'engine',
      slot: 'low',
      name: 'Mark II Plasma Engine',
      description: 'Advanced plasma drive',
      stats: { thrust: 150, fuelEfficiency: 0.8, fuelType: 'helium-3' },
      mass: 60,
      powerUsage: 15
    },

    // === WEAPONS (High Slots) ===
    {
      itemType: 'ship_module',
      category: 'weapon',
      slot: 'high',
      subtype: 'front_cannon',
      name: 'Front Laser Cannon',
      description: 'Forward-mounted energy weapon',
      stats: { damage: 50, range: 1000, ammoType: 'energy_cell', fireRate: 1.0 },
      mass: 30,
      powerUsage: 20
    },
    {
      itemType: 'ship_module',
      category: 'weapon',
      slot: 'high',
      subtype: 'rear_cannon',
      name: 'Rear Defense Turret',
      description: 'Rear-mounted auto-targeting turret',
      stats: { damage: 35, range: 800, ammoType: 'kinetic_rounds', fireRate: 1.5 },
      mass: 25,
      powerUsage: 15
    },
    {
      itemType: 'ship_module',
      category: 'weapon',
      slot: 'high',
      subtype: 'heavy_left',
      name: 'Port Heavy Cannon',
      description: 'Left-side heavy weapon mount',
      stats: { damage: 100, range: 1200, ammoType: 'plasma_charge', fireRate: 0.5 },
      mass: 50,
      powerUsage: 30
    },
    {
      itemType: 'ship_module',
      category: 'weapon',
      slot: 'high',
      subtype: 'heavy_right',
      name: 'Starboard Heavy Cannon',
      description: 'Right-side heavy weapon mount',
      stats: { damage: 100, range: 1200, ammoType: 'plasma_charge', fireRate: 0.5 },
      mass: 50,
      powerUsage: 30
    },

    // === SHIELDS (Mid Slots) ===
    {
      itemType: 'ship_module',
      category: 'shield',
      slot: 'mid',
      subtype: 'front',
      name: 'Forward Shield Generator',
      description: 'Front-facing energy shield',
      stats: { capacity: 500, rechargeRate: 10, resistance: { kinetic: 0.2, energy: 0.3 } },
      mass: 40,
      powerUsage: 25
    },
    {
      itemType: 'ship_module',
      category: 'shield',
      slot: 'mid',
      subtype: 'rear',
      name: 'Aft Shield Generator',
      description: 'Rear-facing energy shield',
      stats: { capacity: 400, rechargeRate: 8, resistance: { kinetic: 0.2, energy: 0.3 } },
      mass: 35,
      powerUsage: 20
    },

    // === THRUSTERS (Mid Slots) ===
    {
      itemType: 'ship_module',
      category: 'thruster',
      slot: 'mid',
      name: 'Maneuvering Thruster',
      description: 'Provides lateral movement',
      stats: { thrust: 50, agility: 1.5 },
      mass: 20,
      powerUsage: 8
    },

    // === HULL COMPONENTS (Low Slots) ===
    {
      itemType: 'ship_module',
      category: 'hull',
      slot: 'low',
      subtype: 'fuselage_front',
      name: 'Reinforced Front Hull',
      description: 'Forward hull plating',
      stats: { armor: 100, hp: 500 },
      mass: 100,
      powerUsage: 0
    },
    {
      itemType: 'ship_module',
      category: 'hull',
      slot: 'low',
      subtype: 'fuselage_rear',
      name: 'Reinforced Rear Hull',
      description: 'Aft hull plating',
      stats: { armor: 80, hp: 400 },
      mass: 90,
      powerUsage: 0
    }
  ];

  // Define consumables
  const consumables = [
    // === FUEL ===
    { itemType: 'consumable', category: 'fuel', name: 'Deuterium Fuel Cell', description: 'Standard ion engine fuel', stackSize: 1000 },
    { itemType: 'consumable', category: 'fuel', name: 'Helium-3 Canister', description: 'Plasma engine fuel', stackSize: 500 },
    { itemType: 'consumable', category: 'fuel', name: 'Antimatter Pod', description: 'High-energy fuel for advanced drives', stackSize: 100 },

    // === AMMO ===
    { itemType: 'consumable', category: 'ammo', name: 'Energy Cell', description: 'Laser weapon ammunition', stackSize: 500 },
    { itemType: 'consumable', category: 'ammo', name: 'Kinetic Rounds', description: 'Ballistic weapon ammunition', stackSize: 1000 },
    { itemType: 'consumable', category: 'ammo', name: 'Plasma Charge', description: 'Heavy weapon ammunition', stackSize: 200 },

    // === REPAIR ===
    { itemType: 'consumable', category: 'repair', name: 'Hull Repair Nanites', description: 'Repairs hull damage', stackSize: 100 },
    { itemType: 'consumable', category: 'repair', name: 'Shield Capacitor', description: 'Restores shield capacity', stackSize: 50 },

    // === LIFE SUPPORT ===
    { itemType: 'consumable', category: 'life_support', name: 'Oxygen Cartridge', description: 'Life support oxygen', stackSize: 100 },
    { itemType: 'consumable', category: 'life_support', name: 'Food Ration', description: 'Crew food supplies', stackSize: 200 }
  ];

  console.log('📦 Creating ship module and consumable item definitions...\n');

  // Create items collection entries (item catalog)
  const allItems = [...shipModules, ...consumables].map(item => ({
    ...item,
    createdAt: new Date(),
    updatedAt: new Date()
  }));

  // Check if items collection exists, create item definitions
  const itemsCollection = db.collection('items');

  // Clear existing ship modules to avoid duplicates
  await itemsCollection.deleteMany({
    itemType: { $in: ['ship_module', 'consumable'] }
  });

  const itemsResult = await itemsCollection.insertMany(allItems);
  console.log(`✅ Created ${itemsResult.insertedCount} item definitions\n`);

  // Now equip characters with basic loadout
  const characters = await db.collection(collections.characters).find({}).toArray();
  console.log(`📊 Found ${characters.length} characters to equip\n`);

  // Get item IDs for basic loadout
  const basicEngine = await itemsCollection.findOne({ name: 'Mark I Ion Engine' });
  const frontCannon = await itemsCollection.findOne({ name: 'Front Laser Cannon' });
  const frontShield = await itemsCollection.findOne({ name: 'Forward Shield Generator' });
  const thruster = await itemsCollection.findOne({ name: 'Maneuvering Thruster' });
  const frontHull = await itemsCollection.findOne({ name: 'Reinforced Front Hull' });
  const deuterium = await itemsCollection.findOne({ name: 'Deuterium Fuel Cell' });
  const energyCell = await itemsCollection.findOne({ name: 'Energy Cell' });
  const hullRepair = await itemsCollection.findOne({ name: 'Hull Repair Nanites' });

  let equipped = 0;
  for (const char of characters) {
    // Equip basic modules in ship fittings
    await db.collection(collections.characters).updateOne(
      { _id: char._id },
      {
        $set: {
          'ship.fittings.highSlots': [
            frontCannon ? { itemId: frontCannon._id, ...frontCannon } : null,
            null,
            null
          ],
          'ship.fittings.midSlots': [
            frontShield ? { itemId: frontShield._id, ...frontShield } : null,
            thruster ? { itemId: thruster._id, ...thruster } : null,
            null,
            null
          ],
          'ship.fittings.lowSlots': [
            basicEngine ? { itemId: basicEngine._id, ...basicEngine } : null,
            basicEngine ? { itemId: basicEngine._id, ...basicEngine } : null,
            basicEngine ? { itemId: basicEngine._id, ...basicEngine } : null,
            frontHull ? { itemId: frontHull._id, ...frontHull } : null
          ]
        }
      }
    );

    // Add consumables to ship cargo
    const cargoItems = [];
    if (deuterium) cargoItems.push({ itemId: deuterium._id, itemDetails: deuterium, quantity: 1000 });
    if (energyCell) cargoItems.push({ itemId: energyCell._id, itemDetails: energyCell, quantity: 500 });
    if (hullRepair) cargoItems.push({ itemId: hullRepair._id, itemDetails: hullRepair, quantity: 50 });

    await db.collection(collections.characters).updateOne(
      { _id: char._id },
      { $set: { 'ship.cargoHold.items': cargoItems } }
    );

    equipped++;
    console.log(`✅ Equipped "${char.name}" with basic ship loadout + consumables`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Seeding complete!`);
  console.log(`   Item definitions created: ${allItems.length}`);
  console.log(`   Characters equipped: ${equipped}`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(0);

} catch (error) {
  console.error('❌ Error seeding ship modules:', error);
  process.exit(1);
}
