/**
 * Create Sample Approved Assets
 * Adds test assets to the database for map visualization
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME || 'projectStringborne';

const sampleAssets = [
  {
    title: 'Plasma Rifle MK-II',
    description: 'Advanced energy weapon with rapid-fire capability',
    assetType: 'weapon',
    subType: 'energy',
    status: 'approved',
    userId: new ObjectId(),
    votes: 42,
    voters: [],
    rarity: 'rare',
    tags: ['weapon', 'energy', 'rifle'],
    stats: {
      damage: 85,
      range: 150,
      fireRate: 3.5
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Quantum Shield Generator',
    description: 'Provides temporary invulnerability shield',
    assetType: 'armor',
    subType: 'shield',
    status: 'approved',
    userId: new ObjectId(),
    votes: 38,
    voters: [],
    rarity: 'epic',
    tags: ['armor', 'shield', 'defense'],
    stats: {
      defense: 120,
      duration: 15,
      cooldown: 45
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Starforge Mining Drill',
    description: 'Heavy-duty mining equipment for resource extraction',
    assetType: 'item',
    subType: 'tool',
    status: 'approved',
    userId: new ObjectId(),
    votes: 29,
    voters: [],
    rarity: 'uncommon',
    tags: ['tool', 'mining', 'resource'],
    stats: {
      miningSpeed: 200,
      efficiency: 95
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Nebula Starfighter',
    description: 'Fast and agile combat spacecraft',
    assetType: 'ship',
    subType: 'fighter',
    status: 'approved',
    userId: new ObjectId(),
    votes: 67,
    voters: [],
    rarity: 'legendary',
    tags: ['ship', 'fighter', 'combat'],
    stats: {
      speed: 450,
      maneuverability: 8,
      armor: 75,
      weaponSlots: 4
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Hyper-Drive Module v3',
    description: 'Advanced FTL propulsion system',
    assetType: 'module',
    subType: 'propulsion',
    status: 'approved',
    userId: new ObjectId(),
    votes: 51,
    voters: [],
    rarity: 'epic',
    tags: ['module', 'ftl', 'propulsion'],
    stats: {
      ftlSpeed: 500,
      fuelEfficiency: 85,
      range: 10000
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Photon Torpedo',
    description: 'High-explosive anti-ship munition',
    assetType: 'ammo',
    subType: 'explosive',
    status: 'approved',
    userId: new ObjectId(),
    votes: 34,
    voters: [],
    rarity: 'rare',
    tags: ['ammo', 'explosive', 'torpedo'],
    stats: {
      damage: 300,
      blastRadius: 50,
      speed: 600
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Crystalline Asteroid Field',
    description: 'Rich in rare minerals and energy crystals',
    assetType: 'environment',
    subType: 'asteroid',
    status: 'approved',
    userId: new ObjectId(),
    votes: 23,
    voters: [],
    rarity: 'uncommon',
    tags: ['environment', 'resource', 'hazard'],
    stats: {
      resourceDensity: 180,
      dangerLevel: 6
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'AI Combat Drone',
    description: 'Autonomous combat support unit',
    assetType: 'item',
    subType: 'drone',
    status: 'approved',
    userId: new ObjectId(),
    votes: 45,
    voters: [],
    rarity: 'rare',
    tags: ['drone', 'ai', 'support'],
    stats: {
      damage: 60,
      health: 150,
      duration: 120
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  }
];

async function createSampleAssets() {
  const client = new MongoClient(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('assets');

    // Clear existing approved assets (optional)
    // await collection.deleteMany({ status: 'approved' });

    // Insert sample assets
    const result = await collection.insertMany(sampleAssets);
    console.log(`✅ Created ${result.insertedCount} sample approved assets`);

    // List the created assets
    const assets = await collection.find({ status: 'approved' }).toArray();
    console.log('\n📦 Sample Assets Created:');
    assets.forEach((asset, index) => {
      console.log(`${index + 1}. ${asset.title} (${asset.assetType}) - ${asset.votes} votes`);
    });

  } catch (error) {
    console.error('❌ Error creating sample assets:', error);
  } finally {
    await client.close();
    console.log('\n✅ Database connection closed');
  }
}

createSampleAssets();
