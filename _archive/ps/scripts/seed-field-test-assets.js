/**
 * Seed Field Test Assets
 * Creates built-in starter items for players:
 * - Field Test Ship
 * - Ship Modules (weapons, armor, engines)
 * - Character Equipment (armor, weapons, trinkets)
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_USER_ID = '000000000000000000000000'; // System/built-in assets

const fieldTestAssets = [
  // ===== SHIPS =====
  {
    title: 'Field Test Frigate',
    description: 'A reliable starter frigate designed for field testing and exploration. Balanced stats make it ideal for new pilots.',
    assetType: 'ship',
    rarity: 'common',
    tags: ['ship', 'frigate', 'starter', 'field-test'],
    lore: 'The Field Test Frigate is a mass-produced vessel used by research divisions across the galaxy. Simple, reliable, and easy to repair.',
    backstory: 'Manufactured by the Galactic Research Institute for field operations.',
    flavor: '"Not the fastest, not the strongest, but it\'ll get you there." - Captain\'s Manual',
    stats: {
      hull: 500,
      shield: 300,
      capacitor: 200,
      mass: 1000000,
      speed: 150,
      agility: 20,
      cargoCapacity: 100,
      cpuCapacity: 50,
      powerGridCapacity: 100
    },
    slotLayout: {
      highSlots: 3,
      midSlots: 3,
      lowSlots: 2,
      rigSlots: 2
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  // ===== SHIP MODULES - WEAPONS =====
  {
    title: 'Field Test Pulse Laser',
    description: 'Basic energy weapon with decent tracking and moderate damage output.',
    assetType: 'module',
    moduleType: 'weapon',
    slotType: 'high',
    rarity: 'common',
    tags: ['weapon', 'laser', 'energy', 'field-test'],
    lore: 'Standard-issue pulse laser used for training and field testing operations.',
    flavor: '"Point and shoot. Even you can\'t mess this up." - Training Manual',
    stats: {
      damage: 25,
      optimalRange: 5000,
      tracking: 40,
      rateOfFire: 3,
      cpuUsage: 8,
      powerUsage: 15,
      capacitorUsage: 5
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Missile Launcher',
    description: 'Reliable missile system with good range and alpha damage.',
    assetType: 'module',
    moduleType: 'weapon',
    slotType: 'high',
    rarity: 'common',
    tags: ['weapon', 'missiles', 'explosive', 'field-test'],
    lore: 'Light missile launcher commonly used for training purposes.',
    flavor: '"Fire and forget. Mostly." - Weapons Instructor',
    stats: {
      damage: 50,
      optimalRange: 15000,
      rateOfFire: 1,
      cpuUsage: 10,
      powerUsage: 20,
      ammoType: 'light-missiles'
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  // ===== SHIP MODULES - DEFENSE =====
  {
    title: 'Field Test Shield Booster',
    description: 'Increases shield hit points by a flat amount.',
    assetType: 'module',
    moduleType: 'defense',
    slotType: 'mid',
    rarity: 'common',
    tags: ['defense', 'shield', 'passive', 'field-test'],
    lore: 'Basic shield enhancement module used in training fleets.',
    flavor: '"More shields? Yes please." - Every Pilot Ever',
    stats: {
      shieldBonus: 100,
      cpuUsage: 5,
      powerUsage: 10
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Afterburner',
    description: 'Provides a significant speed boost at the cost of capacitor energy.',
    assetType: 'module',
    moduleType: 'propulsion',
    slotType: 'mid',
    rarity: 'common',
    tags: ['propulsion', 'speed', 'active', 'field-test'],
    lore: 'Emergency thruster system for quick escapes or pursuit.',
    flavor: '"Go fast or go home."',
    stats: {
      speedBonus: 200,
      capacitorUsage: 25,
      activationCost: 50,
      cpuUsage: 5,
      powerUsage: 15
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  // ===== SHIP MODULES - ENGINEERING =====
  {
    title: 'Field Test Armor Plate',
    description: 'Reinforced plating that increases hull integrity.',
    assetType: 'module',
    moduleType: 'armor',
    slotType: 'low',
    rarity: 'common',
    tags: ['armor', 'hull', 'passive', 'field-test'],
    lore: 'Additional armor layer for increased survivability.',
    flavor: '"Better to have it and not need it..."',
    stats: {
      hullBonus: 150,
      cpuUsage: 3,
      powerUsage: 5
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Power Diagnostic',
    description: 'Improves power grid output and capacitor recharge rate.',
    assetType: 'module',
    moduleType: 'engineering',
    slotType: 'low',
    rarity: 'common',
    tags: ['engineering', 'power', 'capacitor', 'field-test'],
    lore: 'Diagnostic system that optimizes power distribution.',
    flavor: '"More power to... everything!"',
    stats: {
      powerGridBonus: 15,
      capacitorRechargeBonus: 10,
      cpuUsage: 2,
      powerUsage: 0
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  // ===== CHARACTER EQUIPMENT - WEAPONS =====
  {
    title: 'Field Test Plasma Rifle',
    description: 'Standard-issue plasma rifle for ground operations.',
    assetType: 'weapon',
    equipSlot: 'weapon',
    rarity: 'common',
    tags: ['weapon', 'rifle', 'plasma', 'field-test'],
    lore: 'The plasma rifle has been the backbone of infantry units for decades.',
    flavor: '"Reliable, deadly, and surprisingly easy to clean."',
    stats: {
      damage: 35,
      accuracy: 75,
      range: 50,
      rateOfFire: 2,
      weight: 8
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Sidearm',
    description: 'Compact energy pistol for close encounters.',
    assetType: 'weapon',
    equipSlot: 'offhand',
    rarity: 'common',
    tags: ['weapon', 'pistol', 'energy', 'field-test'],
    lore: 'Every pilot carries a sidearm. This one actually works.',
    flavor: '"Small but mighty."',
    stats: {
      damage: 15,
      accuracy: 85,
      range: 20,
      rateOfFire: 4,
      weight: 2
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  // ===== CHARACTER EQUIPMENT - ARMOR =====
  {
    title: 'Field Test Combat Helmet',
    description: 'Protective headgear with integrated HUD systems.',
    assetType: 'armor',
    equipSlot: 'head',
    rarity: 'common',
    tags: ['armor', 'helmet', 'protection', 'field-test'],
    lore: 'Standard pilot helmet with heads-up display and life support.',
    flavor: '"Protects what matters most."',
    stats: {
      defense: 10,
      health: 25,
      weight: 3
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Combat Suit',
    description: 'Reinforced body armor for hostile environments.',
    assetType: 'armor',
    equipSlot: 'chest',
    rarity: 'common',
    tags: ['armor', 'suit', 'protection', 'field-test'],
    lore: 'Durable combat suit designed for extended field operations.',
    flavor: '"Your second skin in the void."',
    stats: {
      defense: 25,
      health: 50,
      weight: 15
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Combat Pants',
    description: 'Armored legwear with integrated support systems.',
    assetType: 'armor',
    equipSlot: 'legs',
    rarity: 'common',
    tags: ['armor', 'pants', 'protection', 'field-test'],
    lore: 'Reinforced pants that don\'t sacrifice mobility for protection.',
    flavor: '"Leg day, every day."',
    stats: {
      defense: 15,
      health: 30,
      speed: -2,
      weight: 8
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Combat Boots',
    description: 'Magnetic boots for zero-g and planetary operations.',
    assetType: 'armor',
    equipSlot: 'feet',
    rarity: 'common',
    tags: ['armor', 'boots', 'mobility', 'field-test'],
    lore: 'Magnetic seal boots keep you grounded when you need it.',
    flavor: '"One small step..."',
    stats: {
      defense: 8,
      health: 15,
      speed: 3,
      weight: 4
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Combat Gloves',
    description: 'Tactical gloves with enhanced grip and protection.',
    assetType: 'armor',
    equipSlot: 'hands',
    rarity: 'common',
    tags: ['armor', 'gloves', 'dexterity', 'field-test'],
    lore: 'Precision grip meets armored protection.',
    flavor: '"Handle with care."',
    stats: {
      defense: 5,
      accuracy: 5,
      weight: 1
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  // ===== CHARACTER EQUIPMENT - TRINKETS =====
  {
    title: 'Field Test Shield Generator',
    description: 'Personal shield emitter that provides energy protection.',
    assetType: 'item',
    equipSlot: 'trinket1',
    rarity: 'uncommon',
    tags: ['trinket', 'shield', 'defense', 'field-test'],
    lore: 'Miniaturized shield technology for personal use.',
    flavor: '"Your bubble of safety."',
    stats: {
      shield: 50,
      energy: -10,
      weight: 5
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Scanner Module',
    description: 'Portable scanner for detecting resources and threats.',
    assetType: 'item',
    equipSlot: 'trinket2',
    rarity: 'uncommon',
    tags: ['trinket', 'scanner', 'utility', 'field-test'],
    lore: 'Advanced sensor package in a compact form factor.',
    flavor: '"Knowledge is power."',
    stats: {
      scanRange: 100,
      accuracy: 10,
      energy: -5,
      weight: 3
    },
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  // ===== CONSUMABLES =====
  {
    title: 'Field Test Med Kit',
    description: 'Emergency medical supplies for field operations.',
    assetType: 'consumable',
    rarity: 'common',
    tags: ['consumable', 'healing', 'medical', 'field-test'],
    lore: 'Standard medical kit issued to all field personnel.',
    flavor: '"Patch yourself up and get back out there."',
    stats: {
      healthRestore: 100
    },
    stackable: true,
    maxStack: 10,
    tradeable: true,
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  },

  {
    title: 'Field Test Energy Cell',
    description: 'Rechargeable energy cell for equipment and weapons.',
    assetType: 'consumable',
    rarity: 'common',
    tags: ['consumable', 'energy', 'ammo', 'field-test'],
    lore: 'Universal power cell compatible with most field equipment.',
    flavor: '"Keep them charged, keep them ready."',
    stats: {
      energyRestore: 50
    },
    stackable: true,
    maxStack: 20,
    tradeable: true,
    isBuiltIn: true,
    isPublished: true,
    approvalStatus: 'approved',
    creator: ADMIN_USER_ID
  }
];

async function seedFieldTestAssets() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);

    // Check if field test assets already exist
    const existingCount = await db.collection('assets').countDocuments({
      isBuiltIn: true,
      title: { $regex: /^Field Test/ }
    });

    if (existingCount > 0) {
      console.log(`Found ${existingCount} existing field test assets`);
      console.log('Do you want to replace them? (Delete and re-create)');

      // Delete existing field test assets
      const deleteResult = await db.collection('assets').deleteMany({
        isBuiltIn: true,
        title: { $regex: /^Field Test/ }
      });
      console.log(`Deleted ${deleteResult.deletedCount} existing field test assets`);
    }

    // Insert new field test assets
    const assetsToInsert = fieldTestAssets.map(asset => ({
      ...asset,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const result = await db.collection('assets').insertMany(assetsToInsert);
    console.log(`✅ Created ${result.insertedCount} field test assets!`);

    // List created assets by category
    console.log('\n📦 Created Assets:');
    console.log('\n🚀 Ships (1):');
    console.log('  - Field Test Frigate');

    console.log('\n⚔️  Ship Modules (6):');
    console.log('  - Field Test Pulse Laser (High Slot)');
    console.log('  - Field Test Missile Launcher (High Slot)');
    console.log('  - Field Test Shield Booster (Mid Slot)');
    console.log('  - Field Test Afterburner (Mid Slot)');
    console.log('  - Field Test Armor Plate (Low Slot)');
    console.log('  - Field Test Power Diagnostic (Low Slot)');

    console.log('\n🔫 Character Weapons (2):');
    console.log('  - Field Test Plasma Rifle');
    console.log('  - Field Test Sidearm');

    console.log('\n🛡️  Character Armor (5):');
    console.log('  - Field Test Combat Helmet');
    console.log('  - Field Test Combat Suit');
    console.log('  - Field Test Combat Pants');
    console.log('  - Field Test Combat Boots');
    console.log('  - Field Test Combat Gloves');

    console.log('\n💎 Trinkets (2):');
    console.log('  - Field Test Shield Generator');
    console.log('  - Field Test Scanner Module');

    console.log('\n🧪 Consumables (2):');
    console.log('  - Field Test Med Kit');
    console.log('  - Field Test Energy Cell');

    console.log(`\n✅ Total: ${result.insertedCount} field test assets ready for use!`);

  } catch (error) {
    console.error('Error seeding field test assets:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seedFieldTestAssets();
