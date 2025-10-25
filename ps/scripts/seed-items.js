import { MongoClient } from 'mongodb';

const DB_URL = process.env.DB_URL || 'mongodb://localhost:27017';
const DB_NAME = 'projectStringborne';

const INITIAL_ITEMS = [
  // === CONSUMABLES ===
  {
    name: 'Health Pack',
    description: 'Restores 50 HP instantly',
    itemType: 'consumable',
    category: 'healing',
    stackable: true,
    maxStack: 10,
    volume: 1,
    mass: 0.5,
    rarity: 'common',
    attributes: { healAmount: 50 }
  },
  {
    name: 'Energy Cell',
    description: 'Restores 100 energy',
    itemType: 'consumable',
    category: 'energy',
    stackable: true,
    maxStack: 10,
    volume: 1,
    mass: 0.3,
    rarity: 'common',
    attributes: { energyAmount: 100 }
  },
  {
    name: 'Repair Kit',
    description: 'Repairs ship hull by 25%',
    itemType: 'consumable',
    category: 'repair',
    stackable: true,
    maxStack: 5,
    volume: 2,
    mass: 1.5,
    rarity: 'uncommon',
    attributes: { repairPercent: 25 }
  },

  // === WEAPONS ===
  {
    name: 'Mining Laser Mk1',
    description: 'Basic mining tool for extracting ore',
    itemType: 'weapon',
    category: 'mining',
    stackable: false,
    volume: 5,
    mass: 8,
    rarity: 'common',
    attributes: {
      damage: 15,
      range: 100,
      energyUse: 5,
      miningSpeed: 1.0
    }
  },
  {
    name: 'Plasma Rifle',
    description: 'Standard energy weapon for ship defense',
    itemType: 'weapon',
    category: 'energy_weapon',
    stackable: false,
    volume: 4,
    mass: 6,
    rarity: 'uncommon',
    attributes: {
      damage: 35,
      range: 250,
      energyUse: 10,
      fireRate: 2
    }
  },
  {
    name: 'Salvage Beam',
    description: 'Extracts materials from wreckage',
    itemType: 'weapon',
    category: 'salvaging',
    stackable: false,
    volume: 6,
    mass: 10,
    rarity: 'uncommon',
    attributes: {
      salvageSpeed: 1.5,
      range: 150,
      energyUse: 8
    }
  },

  // === MODULES (Ship Fittings) ===
  {
    name: 'Basic Shield Generator',
    description: 'Provides 100 shield points',
    itemType: 'module',
    category: 'shield',
    stackable: false,
    volume: 10,
    mass: 20,
    rarity: 'common',
    attributes: {
      shieldCapacity: 100,
      rechargeRate: 5,
      energyUse: 3
    }
  },
  {
    name: 'Cargo Expansion Bay',
    description: 'Increases ship cargo capacity by 50',
    itemType: 'module',
    category: 'utility',
    stackable: false,
    volume: 15,
    mass: 25,
    rarity: 'uncommon',
    attributes: {
      cargoBonus: 50
    }
  },
  {
    name: 'Advanced Thruster',
    description: 'Increases ship speed by 20%',
    itemType: 'module',
    category: 'engine',
    stackable: false,
    volume: 12,
    mass: 30,
    rarity: 'rare',
    attributes: {
      speedBonus: 0.2,
      energyUse: 8
    }
  },

  // === RESOURCES ===
  {
    name: 'Iron Ore',
    description: 'Raw iron extracted from asteroids',
    itemType: 'resource',
    category: 'ore',
    stackable: true,
    maxStack: 100,
    volume: 1,
    mass: 2,
    rarity: 'common',
    attributes: { refineValue: 10 }
  },
  {
    name: 'Quantum Crystal',
    description: 'Rare crystalline structure with unique properties',
    itemType: 'resource',
    category: 'crystal',
    stackable: true,
    maxStack: 50,
    volume: 0.5,
    mass: 0.8,
    rarity: 'rare',
    attributes: { refineValue: 100 }
  },
  {
    name: 'Scrap Metal',
    description: 'Salvaged metal components',
    itemType: 'resource',
    category: 'salvage',
    stackable: true,
    maxStack: 100,
    volume: 1,
    mass: 1.5,
    rarity: 'common',
    attributes: { refineValue: 5 }
  },

  // === TRADE GOODS ===
  {
    name: 'Medical Supplies',
    description: 'Valuable pharmaceuticals for trading',
    itemType: 'trade_good',
    category: 'medical',
    stackable: true,
    maxStack: 50,
    volume: 2,
    mass: 1,
    rarity: 'uncommon',
    attributes: { baseValue: 150 }
  },
  {
    name: 'Exotic Spices',
    description: 'Rare culinary ingredients from distant worlds',
    itemType: 'trade_good',
    category: 'luxury',
    stackable: true,
    maxStack: 20,
    volume: 1,
    mass: 0.5,
    rarity: 'rare',
    attributes: { baseValue: 300 }
  },
  {
    name: 'Fusion Cores',
    description: 'High-energy power sources',
    itemType: 'trade_good',
    category: 'technology',
    stackable: true,
    maxStack: 10,
    volume: 3,
    mass: 5,
    rarity: 'rare',
    attributes: { baseValue: 500 }
  },

  // === EQUIPMENT (Character Wearables) ===
  {
    name: 'Explorer Suit',
    description: 'Standard protective gear for space exploration',
    itemType: 'equipment',
    category: 'chest',
    stackable: false,
    volume: 8,
    mass: 12,
    rarity: 'common',
    attributes: {
      armor: 25,
      radiationProtection: 10
    }
  },
  {
    name: 'Combat Helmet',
    description: 'Reinforced headgear with HUD interface',
    itemType: 'equipment',
    category: 'head',
    stackable: false,
    volume: 3,
    mass: 4,
    rarity: 'uncommon',
    attributes: {
      armor: 15,
      sensorRange: 50
    }
  },
  {
    name: 'Magnetic Boots',
    description: 'Allows walking on ship hulls and stations',
    itemType: 'equipment',
    category: 'feet',
    stackable: false,
    volume: 2,
    mass: 3,
    rarity: 'uncommon',
    attributes: {
      armor: 10,
      magneticGrip: true
    }
  }
];

async function seedItems() {
  const client = new MongoClient(DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);

    // Check if items already exist
    const existingCount = await db.collection('items').countDocuments();

    if (existingCount > 0) {
      console.log(`⚠️  Found ${existingCount} existing items`);
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question('Clear existing items and reseed? (yes/no): ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Seeding cancelled');
        return;
      }

      await db.collection('items').deleteMany({});
      console.log('🗑️  Cleared existing items');
    }

    // Add metadata to each item
    const itemsWithMetadata = INITIAL_ITEMS.map(item => ({
      ...item,
      metadata: {
        createdBy: 'system',
        approvalStatus: 'approved',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }));

    const result = await db.collection('items').insertMany(itemsWithMetadata);

    console.log(`\n✅ Seeded ${result.insertedCount} items successfully!\n`);

    // Show summary by type
    const types = {};
    itemsWithMetadata.forEach(item => {
      types[item.itemType] = (types[item.itemType] || 0) + 1;
    });

    console.log('📊 Items by Type:');
    Object.entries(types).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    console.log('\n📦 Sample Items:');
    itemsWithMetadata.slice(0, 5).forEach(item => {
      console.log(`   - ${item.name} (${item.itemType}/${item.category})`);
    });

  } catch (error) {
    console.error('❌ Error seeding items:', error);
  } finally {
    await client.close();
  }
}

seedItems();
