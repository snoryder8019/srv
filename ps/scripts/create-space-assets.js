#!/usr/bin/env node
/**
 * Create sample space objects (galaxy, orbital, anomaly)
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME || 'projectStringborne';

const spaceAssets = [
  {
    title: 'Andromeda Spiral Galaxy',
    description: 'Massive spiral galaxy with billions of stars',
    assetType: 'galaxy',
    subType: 'spiral',
    status: 'approved',
    userId: new ObjectId(),
    votes: 89,
    voters: [],
    rarity: 'legendary',
    tags: ['galaxy', 'spiral', 'massive'],
    stats: {
      diameter: 220000, // light years
      mass: 1200, // billions of solar masses
      stars: 1000, // billions
      age: 10 // billions of years
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Crimson Nebula Galaxy',
    description: 'Elliptical galaxy with active star formation',
    assetType: 'galaxy',
    subType: 'elliptical',
    status: 'approved',
    userId: new ObjectId(),
    votes: 76,
    voters: [],
    rarity: 'epic',
    tags: ['galaxy', 'elliptical', 'nebula'],
    stats: {
      diameter: 180000,
      mass: 900,
      stars: 800,
      age: 12
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Titan Station',
    description: 'Massive orbital defense platform',
    assetType: 'orbital',
    subType: 'station',
    status: 'approved',
    userId: new ObjectId(),
    votes: 64,
    voters: [],
    rarity: 'epic',
    tags: ['orbital', 'station', 'defense'],
    stats: {
      crew: 15000,
      defense: 950,
      weapons: 200,
      dockingBays: 50
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Mining Ring Alpha',
    description: 'Automated asteroid mining orbital ring',
    assetType: 'orbital',
    subType: 'mining',
    status: 'approved',
    userId: new ObjectId(),
    votes: 52,
    voters: [],
    rarity: 'rare',
    tags: ['orbital', 'mining', 'automated'],
    stats: {
      output: 50000, // tons per day
      efficiency: 85,
      radius: 200, // km
      drones: 500
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Void Rift Anomaly',
    description: 'Mysterious spacetime distortion emitting strange energy',
    assetType: 'anomaly',
    subType: 'rift',
    status: 'approved',
    userId: new ObjectId(),
    votes: 98,
    voters: [],
    rarity: 'legendary',
    tags: ['anomaly', 'rift', 'dangerous'],
    stats: {
      energyOutput: 10000,
      radius: 50, // km
      stability: 25,
      dangerLevel: 10
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Quantum Singularity',
    description: 'Stable quantum phenomenon with FTL properties',
    assetType: 'anomaly',
    subType: 'singularity',
    status: 'approved',
    userId: new ObjectId(),
    votes: 87,
    voters: [],
    rarity: 'legendary',
    tags: ['anomaly', 'quantum', 'ftl'],
    stats: {
      energyOutput: 15000,
      radius: 10,
      stability: 60,
      dangerLevel: 9
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Crystal Lattice Formation',
    description: 'Naturally occurring crystalline structure in space',
    assetType: 'anomaly',
    subType: 'crystal',
    status: 'approved',
    userId: new ObjectId(),
    votes: 71,
    voters: [],
    rarity: 'epic',
    tags: ['anomaly', 'crystal', 'resource'],
    stats: {
      crystalOutput: 5000, // kg per day
      purity: 95,
      size: 500, // meters
      dangerLevel: 3
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Barred Spiral NGC-7843',
    description: 'Beautiful barred spiral galaxy cluster',
    assetType: 'galaxy',
    subType: 'barred-spiral',
    status: 'approved',
    userId: new ObjectId(),
    votes: 82,
    voters: [],
    rarity: 'epic',
    tags: ['galaxy', 'barred', 'cluster'],
    stats: {
      diameter: 150000,
      mass: 750,
      stars: 600,
      age: 8
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Orbital Shipyard Complex',
    description: 'Advanced ship construction and repair facility',
    assetType: 'orbital',
    subType: 'shipyard',
    status: 'approved',
    userId: new ObjectId(),
    votes: 59,
    voters: [],
    rarity: 'rare',
    tags: ['orbital', 'shipyard', 'construction'],
    stats: {
      capacity: 20, // ships at once
      constructionSpeed: 85,
      repairBays: 40,
      workers: 8000
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  },
  {
    title: 'Temporal Vortex',
    description: 'Time-distorting anomaly with unpredictable effects',
    assetType: 'anomaly',
    subType: 'temporal',
    status: 'approved',
    userId: new ObjectId(),
    votes: 94,
    voters: [],
    rarity: 'legendary',
    tags: ['anomaly', 'temporal', 'time'],
    stats: {
      timeDistortion: 150, // percent
      radius: 75,
      stability: 15,
      dangerLevel: 10
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: new ObjectId()
  }
];

async function createSpaceAssets() {
  const client = new MongoClient(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('assets');

    // Insert sample space objects
    const result = await collection.insertMany(spaceAssets);
    console.log(`✅ Created ${result.insertedCount} space assets`);

    // List created assets
    console.log('\n📦 Space Assets Created:');
    spaceAssets.forEach((asset, index) => {
      console.log(`${index + 1}. ${asset.title} (${asset.assetType}) - ${asset.votes} votes`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n✅ Database connection closed');
  }
}

createSpaceAssets();
